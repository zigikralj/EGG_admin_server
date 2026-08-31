import { prisma } from "../db";

export async function extractMentionedUserIds(content: string | null | undefined): Promise<string[]> {
  if (!content) return [];
  const userIds = new Set<string>();

  // 1. Match data-user-id attributes
  const dataAttrRegex = /data-user-id=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = dataAttrRegex.exec(content)) !== null) {
    if (match[1]) {
      userIds.add(match[1].trim());
    }
  }

  // 2. Also match @Name in plain text if data-user-id wasn't present
  // Fetch active users to match names
  const allUsers = await prisma.user.findMany({
    where: { isApproved: true, status: { not: "BLOCKED" } },
    select: { id: true, name: true, email: true },
  });

  const plainText = content.replace(/<[^>]*>/g, " ");
  for (const u of allUsers) {
    if (!userIds.has(u.id)) {
      if (u.name && plainText.toLowerCase().includes("@" + u.name.toLowerCase())) {
        userIds.add(u.id);
      } else if (u.email && plainText.toLowerCase().includes("@" + u.email.toLowerCase())) {
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

  const currentMentionIds = await extractMentionedUserIds(notes);
  const previousMentionIds = new Set(await extractMentionedUserIds(previousNotes));

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
      status: { not: "BLOCKED" },
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
