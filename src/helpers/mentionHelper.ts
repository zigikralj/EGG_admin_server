import { prisma } from "../db";
import { stripHtmlToText } from "./htmlUtils";
import { USER_STATUSES } from "../constants";

interface ActiveUserMentionCandidate {
  id: string;
  name: string;
  email: string | null;
}

export async function extractMentionedUserIds(
  content: string | null | undefined,
  preloadedUsers?: ActiveUserMentionCandidate[]
): Promise<string[]> {
  if (!content) return [];
  const userIds = new Set<string>();

  // 1. Match data-user-id or data-id attributes
  const dataAttrRegex = /data-(?:user-)?id=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = dataAttrRegex.exec(content)) !== null) {
    if (match[1]) {
      userIds.add(match[1].trim());
    }
  }

  // 2. Also match @Name in plain text if content contains '@'
  const plainText = stripHtmlToText(content);
  if (!plainText.includes("@")) {
    return Array.from(userIds);
  }

  const allUsers =
    preloadedUsers ??
    (await prisma.user.findMany({
      where: { isApproved: true, status: { not: USER_STATUSES.BLOCKED } },
      select: { id: true, name: true, email: true },
    }));

  const lowerPlain = plainText.toLowerCase();
  for (const u of allUsers) {
    if (!userIds.has(u.id)) {
      if (u.name && lowerPlain.includes("@" + u.name.toLowerCase())) {
        userIds.add(u.id);
      } else if (u.email && lowerPlain.includes("@" + u.email.toLowerCase())) {
        userIds.add(u.id);
      }
    }
  }

  return Array.from(userIds);
}

export async function handleProjectNotesMentions(
  projectId: string,
  projectName: string,
  notes: string | null | undefined,
  previousNotes: string | null | undefined,
  author: { id: string; name: string }
): Promise<void> {
  if (!notes) return;

  const needsUserLookup =
    notes.includes("@") || Boolean(previousNotes && previousNotes.includes("@"));
  const activeUsers = needsUserLookup
    ? await prisma.user.findMany({
        where: { isApproved: true, status: { not: USER_STATUSES.BLOCKED } },
        select: { id: true, name: true, email: true },
      })
    : [];

  const currentMentionIds = await extractMentionedUserIds(notes, activeUsers);
  if (currentMentionIds.length === 0) return;

  const previousMentionIds = new Set(
    await extractMentionedUserIds(previousNotes, activeUsers)
  );

  // Determine newly mentioned users
  const newMentionUserIds = currentMentionIds.filter(
    (userId) => !previousMentionIds.has(userId)
  );

  if (newMentionUserIds.length === 0) return;

  // Validate that users exist
  const targetUsers = await prisma.user.findMany({
    where: {
      id: { in: newMentionUserIds },
      isApproved: true,
      status: { not: USER_STATUSES.BLOCKED },
    },
    select: { id: true, name: true },
  });

  if (targetUsers.length === 0) return;

  // Create notifications for all valid newly mentioned users
  const notificationsData = targetUsers.map((targetUser) => ({
    userId: targetUser.id,
    type: "MENTION",
    title: "Mentioned in " + projectName,
    message: author.name + " mentioned you in project notes: " + projectName,
    projectId,
    authorId: author.id,
    authorName: author.name,
    read: false,
  }));

  await prisma.notification.createMany({
    data: notificationsData,
  });
}
