import { Router, Request, Response } from 'express';
import { basePrisma as prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { chatSSEHub } from '../services/chat/sseHub';
import { enqueueActivityLog } from '../helpers/activityLogger';
import { hasPermission } from '../types';

export const chatRouter = Router();

chatRouter.use(requireAuth);

/**
 * GET /api/chat/stream
 * SSE connection endpoint. Holds connection open for live chat events & tracks presence.
 */
chatRouter.get('/stream', (req: Request, res: Response) => {
  const userId = req.authUser!.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  chatSSEHub.addClient(userId, res);

  // Send initial connected acknowledgement with online user list
  const onlineUserIds = chatSSEHub.getOnlineUserIds();
  res.write(`event: CONNECTED\ndata: ${JSON.stringify({ onlineUserIds })}\n\n`);

  req.on('close', () => {
    chatSSEHub.removeClient(userId, res);
  });
});

/**
 * GET /api/chat/unread-summary
 * Returns lightweight unread message counters: totalUnread, byConversation, and byProject.
 * Highly optimized: only queries ChatParticipant for current user without joining users or messages.
 */
chatRouter.get('/unread-summary', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;

  const participants = await prisma.chatParticipant.findMany({
    where: {
      userId,
      isArchived: false,
    },
    select: {
      conversationId: true,
      lastReadSeq: true,
      isManuallyUnread: true,
      conversation: {
        select: {
          id: true,
          contextType: true,
          contextId: true,
          messageSeq: true,
        },
      },
    },
  });

  let totalUnread = 0;
  const byConversation: Record<string, number> = {};
  const byProject: Record<string, number> = {};

  for (const p of participants) {
    const diff = Math.max(0, (p.conversation.messageSeq || 0) - (p.lastReadSeq || 0));
    const count = p.isManuallyUnread ? Math.max(1, diff) : diff;

    if (count > 0) {
      totalUnread += count;
      byConversation[p.conversationId] = count;
      if (p.conversation.contextType === 'PROJECT' && p.conversation.contextId) {
        byProject[p.conversation.contextId] = (byProject[p.conversation.contextId] || 0) + count;
      }
    }
  }

  res.json({ totalUnread, byConversation, byProject });
}));

/**
 * GET /api/chat/conversations
 * Returns active conversations for current user with snippet of last message & unread count.
 * Optimized with bounded limit, field-level selection, and stripping redundant user data
 * (client resolves participant details from /users directory).
 */
chatRouter.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 100);

  const participants = await prisma.chatParticipant.findMany({
    where: {
      userId,
      isArchived: false,
      OR: [
        { conversation: { lastMessageAt: { not: null } } },
        { conversation: { type: 'GROUP' } },
      ],
    },
    take: limit,
    select: {
      lastReadSeq: true,
      lastReadAt: true,
      isManuallyUnread: true,
      conversation: {
        select: {
          id: true,
          type: true,
          title: true,
          contextType: true,
          contextId: true,
          messageSeq: true,
          lastMessageText: true,
          lastMessageSenderId: true,
          lastMessageSenderName: true,
          lastMessageAt: true,
          updatedAt: true,
          participants: {
            select: {
              userId: true,
            },
          },
        },
      },
    },
    orderBy: { conversation: { updatedAt: 'desc' } },
  });

  const formatted = participants.map((p) => {
    const conv = p.conversation;
    const messageSeq = conv.messageSeq || 0;
    const lastReadSeq = p.lastReadSeq || 0;
    const diff = Math.max(0, messageSeq - lastReadSeq);
    const unreadCount = p.isManuallyUnread ? Math.max(1, diff) : diff;

    const lastMessage = conv.lastMessageText && conv.lastMessageAt
      ? {
          id: `last-${conv.id}-${messageSeq}`,
          content: conv.lastMessageText,
          createdAt: conv.lastMessageAt.toISOString(),
          sender: {
            id: conv.lastMessageSenderId || '',
            name: conv.lastMessageSenderName || 'Unknown',
          },
        }
      : null;

    const participantIds = conv.participants.map((cp: any) => cp.userId || cp.user?.id || cp.id);

    return {
      id: conv.id,
      type: conv.type,
      title: conv.title,
      contextType: conv.contextType,
      contextId: conv.contextId,
      messageSeq,
      lastReadSeq,
      updatedAt: conv.lastMessageAt || conv.updatedAt,
      lastReadAt: p.lastReadAt,
      unreadCount,
      participantIds,
      lastMessage,
    };
  });

  formatted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json(formatted);
}));

/**
 * POST /api/chat/conversations
 * Create a 1-to-1 or group conversation.
 * Body: { type: 'DIRECT' | 'GROUP', participantIds: string[], title?: string }
 */
chatRouter.post('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const { type = 'DIRECT', participantIds = [], title } = req.body;

  const allParticipantIds = Array.from(new Set([userId, ...participantIds]));

  if (type === 'DIRECT') {
    if (allParticipantIds.length !== 2) {
      return res.status(400).json({ error: 'Direct conversation requires exactly 2 participants' });
    }
    const otherUserId = allParticipantIds.find((id) => id !== userId)!;

    // Check if 1-1 conversation already exists
    const existing = await prisma.chatConversation.findFirst({
      where: {
        type: 'DIRECT',
        contextType: null,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true, role: true } },
          },
        },
      },
    });

    if (existing) {
      return res.json(existing);
    }
  }

  const conversation = await prisma.chatConversation.create({
    data: {
      type,
      title: type === 'GROUP' ? title || 'Group Chat' : null,
      participants: {
        create: allParticipantIds.map((pid) => ({
          userId: pid,
        })),
      },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      },
    },
  });

  // Notify participants via SSE
  chatSSEHub.sendToUsers(allParticipantIds, {
    type: 'CONVERSATION_UPDATED',
    payload: conversation,
  });

  res.status(201).json(conversation);
}));

/**
 * GET /api/chat/conversations/context/:type/:id
 * Fetches or creates on-the-fly a contextual conversation (e.g. PROJECT + projectId).
 */
chatRouter.get('/conversations/context/:type/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const contextType = (req.params.type as string).toUpperCase();
  const contextId = req.params.id as string;

  let title = `${contextType} Chat`;
  if (contextType === 'PROJECT') {
    const project = await prisma.project.findUnique({
      where: { id: contextId },
      select: { id: true, name: true },
    });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    title = project.name;
  }

  let conversation = await prisma.chatConversation.findUnique({
    where: {
      contextType_contextId: { contextType, contextId },
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      },
    },
  });

  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        type: 'CONTEXTUAL',
        contextType,
        contextId,
        title,
        participants: {
          create: [{ userId }],
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true, role: true } },
          },
        },
      },
    });
  } else {
    // Ensure current user is in participants list so unread counts work
    const isParticipant = conversation.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      const createdParticipant = await prisma.chatParticipant.create({
        data: {
          conversationId: conversation.id,
          userId,
          lastReadSeq: conversation.messageSeq || 0,
        },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      });
      if (createdParticipant) {
        conversation.participants.push(createdParticipant);
      }
    }
  }

  res.json(conversation);
}));

/**
 * GET /api/chat/conversations/:id
 * Fetches details of a specific conversation (participants, type, title, etc.).
 */
chatRouter.get('/conversations/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const conversationId = req.params.id as string;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true, role: true, email: true },
          },
        },
      },
    },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const isParticipant = conversation.participants.some((p) => p.userId === userId);
  const isAdmin = hasPermission(req.authUser!, 'projects', 'edit') || req.authUser!.isSystemAdmin;

  if (conversation.type !== 'CONTEXTUAL' && !isParticipant && !isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    contextType: conversation.contextType,
    contextId: conversation.contextId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    participants: conversation.participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.name,
      role: p.user?.role,
      avatarUrl: p.user?.avatarUrl,
      lastReadAt: p.lastReadAt,
      isArchived: p.isArchived,
      user: p.user,
    })),
  });
}));

/**
 * PATCH /api/chat/conversations/:id
 * Rename group chat (or update conversation title).
 */
chatRouter.patch('/conversations/:id', asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const conversationId = req.params.id as string;
  const { title } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title cannot be empty' });
  }
  const cleanTitle = title.trim();

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true, email: true } },
        },
      },
    },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const isParticipant = conversation.participants.some((p) => p.userId === authUser.id);
  const isAdmin = hasPermission(authUser, 'projects', 'edit') || authUser.isSystemAdmin;

  if (!isParticipant && !isAdmin) {
    return res.status(403).json({ error: 'Only participants can rename this conversation' });
  }

  const oldTitle = conversation.title;
  const titleChanged = oldTitle !== cleanTitle;
  const now = new Date();
  const nextSeq = titleChanged ? (conversation.messageSeq || 0) + 1 : (conversation.messageSeq || 0);
  const systemContent = `renamed the group to "${cleanTitle}"`;

  const updated = await prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      title: cleanTitle,
      updatedAt: now,
      ...(titleChanged
        ? {
            messageSeq: nextSeq,
            lastMessageText: systemContent.slice(0, 160),
            lastMessageSenderId: authUser.id,
            lastMessageSenderName: authUser.name,
            lastMessageAt: now,
          }
        : {}),
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true, email: true } },
        },
      },
    },
  });

  // Create system announcement message in conversation
  let systemMessage: any = null;
  if (titleChanged) {
    systemMessage = await prisma.chatMessage.create({
      data: {
        conversationId,
        seq: nextSeq,
        senderId: authUser.id,
        content: systemContent,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
      },
    });
    await prisma.chatParticipant.updateMany({
      where: { conversationId, userId: authUser.id },
      data: { lastReadSeq: nextSeq, lastReadAt: now, isManuallyUnread: false },
    });
  }

  const participantUserIds = updated.participants.map((p) => p.userId);

  chatSSEHub.sendToUsers(participantUserIds, {
    type: 'CONVERSATION_UPDATED',
    payload: updated,
  });

  if (systemMessage) {
    chatSSEHub.sendToUsers(participantUserIds, {
      type: 'MESSAGE_CREATED',
      payload: { conversationId, message: systemMessage, conversation: updated },
    });
  }

  res.json({
    id: updated.id,
    type: updated.type,
    title: updated.title,
    contextType: updated.contextType,
    contextId: updated.contextId,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    participants: updated.participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.name,
      role: p.user?.role,
      avatarUrl: p.user?.avatarUrl,
      user: p.user,
    })),
  });
}));

/**
 * POST /api/chat/conversations/:id/participants
 * Add member(s) to a group conversation.
 * Body: { userIds: string[] }
 */
chatRouter.post('/conversations/:id/participants', asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const conversationId = req.params.id as string;
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds array is required' });
  }

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true, email: true } },
        },
      },
    },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (conversation.type !== 'GROUP' && conversation.type !== 'CONTEXTUAL') {
    return res.status(400).json({ error: 'Cannot add participants to a direct 1-on-1 conversation' });
  }

  const isParticipant = conversation.participants.some((p) => p.userId === authUser.id);
  const isAdmin = hasPermission(authUser, 'projects', 'edit') || authUser.isSystemAdmin;

  if (!isParticipant && !isAdmin) {
    return res.status(403).json({ error: 'Only participants can add members' });
  }

  const existingUserIds = new Set(conversation.participants.map((p) => p.userId));
  const toAddUserIds = userIds.filter((uid: string) => typeof uid === 'string' && !existingUserIds.has(uid));

  if (toAddUserIds.length === 0) {
    return res.json({
      message: 'All specified users are already in the conversation',
      conversation,
    });
  }

  const foundUsers = await prisma.user.findMany({
    where: { id: { in: toAddUserIds } },
    select: { id: true, name: true, avatarUrl: true, role: true, email: true },
  });

  if (foundUsers.length === 0) {
    return res.status(400).json({ error: 'No valid users to add' });
  }

  const baseSeq = conversation.messageSeq || 0;
  const nextSeq = baseSeq + 1;
  const now = new Date();
  const addedNames = foundUsers.map((u) => u.name).join(', ');
  const systemContent = `added ${addedNames} to the group`;

  await prisma.$transaction(
    foundUsers.map((u) =>
      prisma.chatParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId: u.id } },
        create: {
          conversationId,
          userId: u.id,
          isArchived: false,
          lastReadSeq: baseSeq,
          lastReadAt: new Date(0),
        },
        update: { isArchived: false, lastReadSeq: baseSeq },
      })
    )
  );

  const updatedConv = await prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      messageSeq: nextSeq,
      lastMessageText: systemContent.slice(0, 160),
      lastMessageSenderId: authUser.id,
      lastMessageSenderName: authUser.name,
      lastMessageAt: now,
      updatedAt: now,
    },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true, email: true } },
        },
      },
    },
  });

  const systemMessage = await prisma.chatMessage.create({
    data: {
      conversationId,
      seq: nextSeq,
      senderId: authUser.id,
      content: systemContent,
    },
    include: {
      sender: {
        select: { id: true, name: true, avatarUrl: true, role: true },
      },
    },
  });

  await prisma.chatParticipant.updateMany({
    where: { conversationId, userId: authUser.id },
    data: { lastReadSeq: nextSeq, lastReadAt: now, isManuallyUnread: false },
  });

  const allParticipantIds = updatedConv.participants.map((p) => p.userId);

  chatSSEHub.sendToUsers(allParticipantIds, {
    type: 'CONVERSATION_UPDATED',
    payload: updatedConv,
  });

  chatSSEHub.sendToUsers(allParticipantIds, {
    type: 'MESSAGE_CREATED',
    payload: { conversationId, message: systemMessage, conversation: updatedConv },
  });

  res.status(201).json({
    conversation: {
      id: updatedConv.id,
      type: updatedConv.type,
      title: updatedConv.title,
      contextType: updatedConv.contextType,
      contextId: updatedConv.contextId,
      createdAt: updatedConv.createdAt,
      updatedAt: updatedConv.updatedAt,
      participants: updatedConv.participants.map((p) => ({
        id: p.id,
        userId: p.userId,
        name: p.user?.name,
        role: p.user?.role,
        avatarUrl: p.user?.avatarUrl,
        user: p.user,
      })),
    },
    addedUsers: foundUsers,
  });
}));

/**
 * DELETE /api/chat/conversations/:id/participants/:targetUserId
 * Remove a member from group chat or leave group.
 */
chatRouter.delete('/conversations/:id/participants/:targetUserId', asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const conversationId = req.params.id as string;
  const targetUserId = req.params.targetUserId as string;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true, email: true } },
        },
      },
    },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (conversation.type !== 'GROUP') {
    return res.status(400).json({ error: 'Only group conversations support removing participants' });
  }

  const isLeaving = targetUserId === authUser.id;
  const isParticipant = conversation.participants.some((p) => p.userId === authUser.id);
  const isAdmin = hasPermission(authUser, 'projects', 'edit') || authUser.isSystemAdmin;

  if (!isLeaving && !isParticipant && !isAdmin) {
    return res.status(403).json({ error: 'Only participants or admin can remove members' });
  }

  const targetParticipant = conversation.participants.find((p) => p.userId === targetUserId);
  if (!targetParticipant) {
    return res.status(404).json({ error: 'User is not a participant in this conversation' });
  }

  await prisma.chatParticipant.delete({
    where: {
      conversationId_userId: { conversationId, userId: targetUserId },
    },
  });

  const remainingParticipants = conversation.participants.filter((p) => p.userId !== targetUserId);
  const nextSeq = (conversation.messageSeq || 0) + 1;
  const now = new Date();

  const systemContent = isLeaving
    ? `left the group`
    : `removed ${targetParticipant.user.name} from the group`;

  await prisma.chatConversation.update({
    where: { id: conversationId },
    data: {
      messageSeq: nextSeq,
      lastMessageText: systemContent.slice(0, 160),
      lastMessageSenderId: authUser.id,
      lastMessageSenderName: authUser.name,
      lastMessageAt: now,
      updatedAt: now,
    },
  });

  const systemMessage = await prisma.chatMessage.create({
    data: {
      conversationId,
      seq: nextSeq,
      senderId: authUser.id,
      content: systemContent,
    },
    include: {
      sender: {
        select: { id: true, name: true, avatarUrl: true, role: true },
      },
    },
  });

  if (!isLeaving) {
    await prisma.chatParticipant.updateMany({
      where: { conversationId, userId: authUser.id },
      data: { lastReadSeq: nextSeq, lastReadAt: now, isManuallyUnread: false },
    });
  }

  const remainingUserIds = remainingParticipants.map((p) => p.userId);
  const updatedConversationPayload = {
    ...conversation,
    messageSeq: nextSeq,
    lastMessageText: systemContent.slice(0, 160),
    lastMessageSenderId: authUser.id,
    lastMessageSenderName: authUser.name,
    lastMessageAt: now,
    updatedAt: now,
    participants: remainingParticipants,
  };

  chatSSEHub.sendToUsers(remainingUserIds, {
    type: 'CONVERSATION_UPDATED',
    payload: updatedConversationPayload,
  });

  chatSSEHub.sendToUsers(remainingUserIds, {
    type: 'MESSAGE_CREATED',
    payload: {
      conversationId,
      message: systemMessage,
      conversation: updatedConversationPayload,
    },
  });

  chatSSEHub.sendToUser(targetUserId, {
    type: 'REMOVED_FROM_CONVERSATION',
    payload: { conversationId },
  });

  res.json({ success: true, removedUserId: targetUserId, isLeaving });
}));

/**
 * GET /api/chat/conversations/:id/messages
 * Cursor-based paginated message history and forward delta sync.
 * Supports:
 * - ?beforeSeq=<number> for backward lazy scroll history
 * - ?afterSeq=<number>&sinceUpdatedAt=<ISO> for forward delta sync
 */
chatRouter.get('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const conversationId = req.params.id as string;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const beforeSeq = req.query.beforeSeq ? Number(req.query.beforeSeq) : undefined;
  const afterSeq = req.query.afterSeq !== undefined ? Number(req.query.afterSeq) : undefined;
  const sinceUpdatedAtStr = req.query.sinceUpdatedAt as string | undefined;

  // Verify membership or admin
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: { participants: true },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const isMember = conversation.participants.some((p) => p.userId === userId);
  const isAdmin = hasPermission(req.authUser!, 'projects', 'edit') || req.authUser!.isSystemAdmin;

  // Contextual chats can be viewed by all users who have access; private chats only members or admin
  if (conversation.type !== 'CONTEXTUAL' && !isMember && !isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // 1. Forward Delta Sync Mode: Client has local messages up to afterSeq and wants new + modified messages
  if (afterSeq !== undefined) {
    const newMessages = await prisma.chatMessage.findMany({
      where: {
        conversationId,
        seq: { gt: afterSeq },
      },
      orderBy: { seq: 'asc' },
      take: 100,
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            isDeleted: true,
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });

    let updatedMessages: any[] = [];
    if (sinceUpdatedAtStr) {
      const parsedSince = new Date(sinceUpdatedAtStr);
      if (!isNaN(parsedSince.getTime())) {
        updatedMessages = await prisma.chatMessage.findMany({
          where: {
            conversationId,
            seq: { lte: afterSeq },
            updatedAt: { gt: parsedSince },
          },
          orderBy: { seq: 'asc' },
          take: 50,
          include: {
            sender: {
              select: { id: true, name: true, avatarUrl: true, role: true },
            },
            replyTo: {
              select: {
                id: true,
                content: true,
                isDeleted: true,
                sender: { select: { id: true, name: true } },
              },
            },
          },
        });
      }
    }

    return res.json({
      delta: true,
      newMessages,
      updatedMessages,
      currentSeq: conversation.messageSeq,
      syncedAt: new Date().toISOString(),
    });
  }

  // 2. Standard / Backward Pagination Mode (seq cursor)
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      ...(beforeSeq !== undefined ? { seq: { lt: beforeSeq } } : {}),
    },
    take: limit,
    orderBy: { seq: 'desc' },
    include: {
      sender: {
        select: { id: true, name: true, avatarUrl: true, role: true },
      },
      replyTo: {
        select: {
          id: true,
          content: true,
          isDeleted: true,
          sender: { select: { id: true, name: true } },
        },
      },
    },
  });

  res.json(messages.reverse());
}));

/**
 * POST /api/chat/conversations/:id/messages
 * Send message in conversation, support @mentions and replies.
 */
chatRouter.post('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const conversationId = req.params.id as string;
  const { content, replyToId, mentionedUserIds = [] } = req.body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Message content cannot be empty' });
  }

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    include: { participants: true },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Ensure sender is a participant
  if (!conversation.participants.some((p) => p.userId === authUser.id)) {
    await prisma.chatParticipant.create({
      data: { conversationId, userId: authUser.id },
    });
  }

  const snippet = content.trim().slice(0, 160);
  const nextSeq = conversation.messageSeq + 1;

  // Atomic batch: increment sequence, store message with seq, update conversation & participant lastReadSeq
  const [message, updatedConv] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId,
        seq: nextSeq,
        senderId: authUser.id,
        content: content.trim(),
        replyToId: replyToId || null,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            isDeleted: true,
            sender: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        messageSeq: nextSeq,
        lastMessageText: snippet,
        lastMessageSenderId: authUser.id,
        lastMessageSenderName: authUser.name,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, avatarUrl: true, role: true } },
          },
        },
      },
    }),
    prisma.chatParticipant.updateMany({
      where: { conversationId, userId: authUser.id },
      data: { lastReadSeq: nextSeq, lastReadAt: new Date(), isManuallyUnread: false },
    }),
  ]);

  // 1. Audit log if it's a contextual project chat
  if (conversation.contextType === 'PROJECT' && conversation.contextId) {
    enqueueActivityLog({
      userId: authUser.id,
      userName: authUser.name,
      type: 'PROJECT_CHAT_MESSAGE',
      path: `/projects/${conversation.contextId}`,
      details: JSON.stringify({
        messageId: message.id,
        projectId: conversation.contextId,
        snippet: content.substring(0, 80),
      }),
    });
  }

  // 2. Process @mentions -> create notifications and add mentioned users as participants to contextual conversation
  if (Array.isArray(mentionedUserIds) && mentionedUserIds.length > 0) {
    const validMentionIds = Array.from(
      new Set(
        mentionedUserIds.filter(
          (mId: string) => typeof mId === 'string' && mId !== authUser.id
        )
      )
    );

    if (validMentionIds.length > 0) {
      const existingParticipantIds = new Set(conversation.participants.map((p) => p.userId));
      const missingMentionIds = validMentionIds.filter((id) => !existingParticipantIds.has(id));

      // Ensure all newly mentioned users are participants so the conversation appears in their unread list
      if (missingMentionIds.length > 0) {
        await Promise.all(
          missingMentionIds.map((targetUserId: string) =>
            prisma.chatParticipant.upsert({
              where: {
                conversationId_userId: { conversationId, userId: targetUserId },
              },
              create: {
                conversationId,
                userId: targetUserId,
                lastReadSeq: Math.max(0, nextSeq - 1),
                lastReadAt: new Date(0),
              },
              update: {},
            })
          )
        );
      }

      await Promise.all(
        validMentionIds.map(async (targetUserId: string) => {
          const notif = await prisma.notification.create({
            data: {
              userId: targetUserId,
              type: 'MENTION',
              title: `${authUser.name} mentioned you in chat`,
              message: content.substring(0, 120),
              projectId: conversation.contextType === 'PROJECT' ? conversation.contextId : null,
              authorId: authUser.id,
              authorName: authUser.name,
              link:
                conversation.contextType === 'PROJECT'
                  ? `/projects?highlight=${conversation.contextId}&tab=chat`
                  : undefined,
            },
          });

          // Dispatch notification event over SSE
          chatSSEHub.sendToUser(targetUserId, {
            type: 'NOTIFICATION',
            payload: notif,
          });
        })
      );
    }
  }

  // 3. Broadcast message to all conversation participants (or all online users for project chat)
  if (conversation.type === 'CONTEXTUAL') {
    chatSSEHub.broadcastAll({
      type: 'MESSAGE_CREATED',
      payload: { conversationId, message, conversation: updatedConv },
    });
  } else {
    const recipientIds = updatedConv.participants.map((p) => p.userId);
    chatSSEHub.sendToUsers(recipientIds, {
      type: 'MESSAGE_CREATED',
      payload: { conversationId, message, conversation: updatedConv },
    });
  }

  res.status(201).json(message);
}));

/**
 * PATCH /api/chat/messages/:id
 * Edit message (author only).
 */
chatRouter.patch('/messages/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const messageId = req.params.id as string;
  const { content } = req.body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content cannot be empty' });
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { participants: true } } },
  });

  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  if (message.senderId !== userId) {
    return res.status(403).json({ error: 'Only author can edit this message' });
  }

  const trimmedContent = content.trim();

  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: {
      content: trimmedContent,
      isEdited: true,
      editedAt: new Date(),
    },
    include: {
      sender: {
        select: { id: true, name: true, avatarUrl: true, role: true },
      },
      replyTo: {
        select: {
          id: true,
          content: true,
          isDeleted: true,
          sender: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (message.seq && message.seq === message.conversation.messageSeq) {
    await prisma.chatConversation.update({
      where: { id: message.conversationId },
      data: { lastMessageText: trimmedContent.slice(0, 160) },
    });
  }

  const eventPayload = {
    type: 'MESSAGE_UPDATED' as const,
    payload: { conversationId: message.conversationId, message: updated },
  };
  if (message.conversation.type === 'CONTEXTUAL') {
    chatSSEHub.broadcastAll(eventPayload);
  } else {
    const participantIds = message.conversation.participants.map((p) => p.userId);
    chatSSEHub.sendToUsers(participantIds, eventPayload);
  }

  res.json(updated);
}));

/**
 * DELETE /api/chat/messages/:id
 * Hybrid Delete: Hard delete if no replies; soft delete (isDeleted=true, content="") if replies exist.
 */
chatRouter.delete('/messages/:id', asyncHandler(async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const messageId = req.params.id as string;

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    include: {
      conversation: { include: { participants: true } },
      replies: { select: { id: true } },
    },
  });

  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const isAuthor = message.senderId === authUser.id;
  const isAdmin = hasPermission(authUser, 'projects', 'edit') || authUser.isSystemAdmin;

  if (!isAuthor && !isAdmin) {
    return res.status(403).json({ error: 'Permission denied to delete this message' });
  }

  const replyCount = message.replies.length;
  let finalMessage: any;

  if (replyCount > 0) {
    // Soft delete to maintain reply thread context
    finalMessage = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        content: '',
      },
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            isDeleted: true,
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });
  } else {
    // Hard delete
    await prisma.chatMessage.delete({
      where: { id: messageId },
    });
    finalMessage = { id: messageId, isDeleted: true, hardDeleted: true };
  }

  if (message.seq && message.seq === message.conversation.messageSeq) {
    await prisma.chatConversation.update({
      where: { id: message.conversationId },
      data: { lastMessageText: 'This message was deleted' },
    });
  }

  const deleteEventPayload = {
    type: 'MESSAGE_DELETED' as const,
    payload: {
      conversationId: message.conversationId,
      messageId,
      hardDeleted: replyCount === 0,
      updatedMessage: replyCount > 0 ? finalMessage : null,
    },
  };
  if (message.conversation.type === 'CONTEXTUAL') {
    chatSSEHub.broadcastAll(deleteEventPayload);
  } else {
    const participantIds = message.conversation.participants.map((p) => p.userId);
    chatSSEHub.sendToUsers(participantIds, deleteEventPayload);
  }

  res.json({ success: true, hardDeleted: replyCount === 0 });
}));

/**
 * POST /api/chat/conversations/:id/read
 * Mark conversation as read up to current conversation sequence (O(1) watermark).
 */
chatRouter.post('/conversations/:id/read', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const conversationId = req.params.id as string;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { messageSeq: true },
  });

  const targetSeq = conversation?.messageSeq || 0;
  const now = new Date();

  await prisma.chatParticipant.upsert({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    create: {
      conversationId,
      userId,
      lastReadSeq: targetSeq,
      lastReadAt: now,
      isManuallyUnread: false,
    },
    update: {
      lastReadSeq: targetSeq,
      lastReadAt: now,
      isManuallyUnread: false,
    },
  });

  // Notify clients via SSE of read status update
  chatSSEHub.sendToUser(userId, {
    type: 'READ_RECEIPT',
    payload: { conversationId, userId, lastReadSeq: targetSeq, lastReadAt: now },
  });

  res.json({ success: true, lastReadSeq: targetSeq, lastReadAt: now });
}));

/**
 * POST /api/chat/conversations/:id/unread
 * Marks conversation as unread by setting isManuallyUnread flag and rewinding watermark.
 */
chatRouter.post('/conversations/:id/unread', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser!.id;
  const conversationId = req.params.id as string;

  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { messageSeq: true },
  });

  const targetSeq = Math.max(0, (conversation?.messageSeq || 1) - 1);
  const now = new Date();

  await prisma.chatParticipant.upsert({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    create: {
      conversationId,
      userId,
      lastReadSeq: targetSeq,
      lastReadAt: now,
      isManuallyUnread: true,
    },
    update: {
      lastReadSeq: targetSeq,
      isManuallyUnread: true,
    },
  });

  // Notify user via SSE
  chatSSEHub.sendToUser(userId, {
    type: 'UNREAD_STATUS',
    payload: { conversationId, userId, lastReadSeq: targetSeq, unreadCount: 1 },
  });

  res.json({ success: true, lastReadSeq: targetSeq, unreadCount: 1 });
}));
