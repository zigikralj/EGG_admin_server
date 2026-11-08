import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Chat Routes (GET, POST, PATCH, DELETE)', () => {
  const app = createApp();

  describe('GET /api/chat/unread-summary', () => {
    it('returns unread summary partitioned by conversation and project', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatParticipant.findMany.mockResolvedValueOnce([
        {
          conversationId: 'conv-1',
          lastReadSeq: 2,
          isManuallyUnread: false,
          conversation: {
            id: 'conv-1',
            contextType: 'PROJECT',
            contextId: 'proj-123',
            messageSeq: 5,
          },
        },
        {
          conversationId: 'conv-2',
          lastReadSeq: 10,
          isManuallyUnread: true,
          conversation: {
            id: 'conv-2',
            contextType: null,
            contextId: null,
            messageSeq: 10,
          },
        },
        {
          conversationId: 'conv-3',
          lastReadSeq: 4,
          isManuallyUnread: false,
          conversation: {
            id: 'conv-3',
            contextType: 'PROJECT',
            contextId: 'proj-123',
            messageSeq: 4,
          },
        },
      ]);

      const res = await request(app)
        .get('/api/chat/unread-summary')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        totalUnread: 4, // 3 from conv-1 (5-2), 1 from conv-2 (manual), 0 from conv-3
        byConversation: {
          'conv-1': 3,
          'conv-2': 1,
        },
        byProject: {
          'proj-123': 3,
        },
      });
    });
  });

  describe('GET /api/chat/conversations', () => {
    it('returns conversations with unread counts for current user', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const mockConversation = {
        id: 'conv-1',
        type: 'DIRECT',
        title: null,
        contextType: null,
        contextId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        participants: [
          { user: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User' } },
          { user: { id: 'u2', name: 'Bob', avatarUrl: null, role: 'User' } },
        ],
        messages: [
          { id: 'm1', content: 'Hello Bob', sender: { id: 'u1', name: 'Alice' } },
        ],
      };

      mockPrisma.chatParticipant.findMany.mockResolvedValueOnce([
        {
          id: 'cp1',
          conversationId: 'conv-1',
          userId: 'u1',
          lastReadAt: new Date(),
          isArchived: false,
          conversation: mockConversation,
        },
      ]);

      mockPrisma.chatMessage.count.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/chat/conversations')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe('conv-1');
      expect(res.body[0].unreadCount).toBe(0);
    });
  });

  describe('POST /api/chat/conversations/:id/messages', () => {
    it('creates message and returns 201', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-1',
        type: 'DIRECT',
        contextType: null,
        contextId: null,
        participants: [{ userId: 'u1' }, { userId: 'u2' }],
      });

      const createdMsg = {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u1',
        content: 'Hi there',
        replyToId: null,
        createdAt: new Date(),
        isEdited: false,
        isDeleted: false,
        sender: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User' },
        replyTo: null,
        readReceipts: [],
      };
      mockPrisma.chatMessage.create.mockResolvedValueOnce(createdMsg);
      mockPrisma.chatConversation.update.mockResolvedValueOnce({
        id: 'conv-1',
        participants: [
          { userId: 'u1', user: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User' } },
          { userId: 'u2', user: { id: 'u2', name: 'Bob', avatarUrl: null, role: 'User' } },
        ],
      });

      const res = await request(app)
        .post('/api/chat/conversations/conv-1/messages')
        .set('Authorization', createAuthHeader(user))
        .send({ content: 'Hi there' });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('Hi there');
      expect(mockPrisma.chatMessage.create).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/chat/messages/:id (Hybrid Delete)', () => {
    it('hard deletes when message has no replies', async () => {
      const user = createTestUser({ id: 'u1' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-no-replies',
        senderId: 'u1',
        conversationId: 'conv-1',
        conversation: { participants: [{ userId: 'u1' }] },
        replies: [],
      });
      mockPrisma.chatMessage.delete.mockResolvedValueOnce({ id: 'msg-no-replies' });

      const res = await request(app)
        .delete('/api/chat/messages/msg-no-replies')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.hardDeleted).toBe(true);
      expect(mockPrisma.chatMessage.delete).toHaveBeenCalledWith({
        where: { id: 'msg-no-replies' },
      });
    });

    it('soft deletes (isDeleted=true, content="") when message has replies', async () => {
      const user = createTestUser({ id: 'u1' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-with-replies',
        senderId: 'u1',
        conversationId: 'conv-1',
        conversation: { participants: [{ userId: 'u1' }] },
        replies: [{ id: 'reply-1' }],
      });
      mockPrisma.chatMessage.update.mockResolvedValueOnce({
        id: 'msg-with-replies',
        isDeleted: true,
        content: '',
      });

      const res = await request(app)
        .delete('/api/chat/messages/msg-with-replies')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.hardDeleted).toBe(false);
      expect(mockPrisma.chatMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-with-replies' },
          data: expect.objectContaining({ isDeleted: true, content: '' }),
        })
      );
    });
  });

  describe('GET /api/chat/conversations/:id', () => {
    it('returns conversation details for participants', async () => {
      const user = createTestUser({ id: 'u1' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Project Alpha Team',
        contextType: null,
        contextId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        participants: [
          {
            id: 'cp-1',
            userId: 'u1',
            lastReadAt: new Date(),
            isArchived: false,
            user: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User', email: 'alice@test.com' },
          },
          {
            id: 'cp-2',
            userId: 'u2',
            lastReadAt: new Date(),
            isArchived: false,
            user: { id: 'u2', name: 'Bob', avatarUrl: null, role: 'Manager', email: 'bob@test.com' },
          },
        ],
      });

      const res = await request(app)
        .get('/api/chat/conversations/conv-123')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('conv-123');
      expect(res.body.title).toBe('Project Alpha Team');
      expect(res.body.participants.length).toBe(2);
      expect(res.body.participants[0].user.name).toBe('Alice');
    });

    it('returns 403 if user is not participant or admin', async () => {
      const user = createTestUser({ id: 'u-intruder', role: 'User', isSystemAdmin: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Private Group',
        contextType: null,
        contextId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        participants: [
          {
            id: 'cp-1',
            userId: 'u1',
            user: { id: 'u1', name: 'Alice' },
          },
        ],
      });

      const res = await request(app)
        .get('/api/chat/conversations/conv-123')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/chat/conversations/:id (Rename Group)', () => {
    it('renames group and broadcasts system message', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Old Name',
        participants: [
          { userId: 'u1', user: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User', email: 'alice@test.com' } },
        ],
      });

      mockPrisma.chatConversation.update.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'New Renovated Name',
        updatedAt: new Date(),
        participants: [
          { id: 'cp-1', userId: 'u1', user: { id: 'u1', name: 'Alice', avatarUrl: null, role: 'User', email: 'alice@test.com' } },
        ],
      });

      mockPrisma.chatMessage.create.mockResolvedValueOnce({
        id: 'sys-msg-1',
        conversationId: 'conv-123',
        senderId: 'u1',
        content: 'renamed the group to "New Renovated Name"',
        createdAt: new Date(),
      });

      const res = await request(app)
        .patch('/api/chat/conversations/conv-123')
        .set('Authorization', createAuthHeader(user))
        .send({ title: 'New Renovated Name' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('New Renovated Name');
      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-123',
            content: 'renamed the group to "New Renovated Name"',
          }),
        })
      );
    });
  });

  describe('POST /api/chat/conversations/:id/participants (Add Member)', () => {
    it('adds participants to group and broadcasts announcement', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Alpha Team',
        participants: [
          { userId: 'u1', user: { id: 'u1', name: 'Alice' } },
        ],
      });

      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'u2', name: 'Bob', avatarUrl: null, role: 'Manager', email: 'bob@test.com' },
      ]);

      mockPrisma.chatParticipant.upsert.mockResolvedValueOnce({
        id: 'cp-2',
        conversationId: 'conv-123',
        userId: 'u2',
      });

      mockPrisma.chatConversation.update.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Alpha Team',
        participants: [
          { id: 'cp-1', userId: 'u1', user: { id: 'u1', name: 'Alice' } },
          { id: 'cp-2', userId: 'u2', user: { id: 'u2', name: 'Bob' } },
        ],
      });

      mockPrisma.chatMessage.create.mockResolvedValueOnce({
        id: 'sys-msg-2',
        conversationId: 'conv-123',
        senderId: 'u1',
        content: 'added Bob to the group',
      });

      const res = await request(app)
        .post('/api/chat/conversations/conv-123/participants')
        .set('Authorization', createAuthHeader(user))
        .send({ userIds: ['u2'] });

      expect(res.status).toBe(201);
      expect(res.body.addedUsers.length).toBe(1);
      expect(res.body.addedUsers[0].name).toBe('Bob');
      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-123',
            content: 'added Bob to the group',
          }),
        })
      );
    });
  });

  describe('DELETE /api/chat/conversations/:id/participants/:targetUserId (Remove or Leave)', () => {
    it('removes member or lets member leave and creates announcement', async () => {
      const user = createTestUser({ id: 'u1', name: 'Alice' });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      mockPrisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'GROUP',
        title: 'Alpha Team',
        participants: [
          { userId: 'u1', user: { id: 'u1', name: 'Alice' } },
          { userId: 'u2', user: { id: 'u2', name: 'Bob' } },
        ],
      });

      mockPrisma.chatParticipant.delete.mockResolvedValueOnce({
        id: 'cp-2',
      });

      mockPrisma.chatMessage.create.mockResolvedValueOnce({
        id: 'sys-msg-3',
        conversationId: 'conv-123',
        senderId: 'u1',
        content: 'removed Bob from the group',
      });

      const res = await request(app)
        .delete('/api/chat/conversations/conv-123/participants/u2')
        .set('Authorization', createAuthHeader(user));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.removedUserId).toBe('u2');
      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-123',
            content: 'removed Bob from the group',
          }),
        })
      );
    });
  });
});
