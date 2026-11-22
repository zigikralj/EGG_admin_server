-- Rename enum and tables safely preserving all data
ALTER TYPE "ChatType" RENAME TO "ConversationType";

ALTER TABLE "ChatConversation" RENAME TO "Conversation";
ALTER TABLE "ChatParticipant" RENAME TO "ConversationParticipant";
ALTER TABLE "ChatMessage" RENAME TO "Message";

-- Rename constraints
ALTER TABLE "Conversation" RENAME CONSTRAINT "ChatConversation_pkey" TO "Conversation_pkey";
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "ChatParticipant_pkey" TO "ConversationParticipant_pkey";
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "ChatParticipant_conversationId_fkey" TO "ConversationParticipant_conversationId_fkey";
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "ChatParticipant_userId_fkey" TO "ConversationParticipant_userId_fkey";
ALTER TABLE "Message" RENAME CONSTRAINT "ChatMessage_pkey" TO "Message_pkey";
ALTER TABLE "Message" RENAME CONSTRAINT "ChatMessage_conversationId_fkey" TO "Message_conversationId_fkey";
ALTER TABLE "Message" RENAME CONSTRAINT "ChatMessage_senderId_fkey" TO "Message_senderId_fkey";
ALTER TABLE "Message" RENAME CONSTRAINT "ChatMessage_replyToId_fkey" TO "Message_replyToId_fkey";

-- Rename indexes
ALTER INDEX "ChatConversation_contextType_contextId_idx" RENAME TO "Conversation_contextType_contextId_idx";
ALTER INDEX "ChatConversation_lastMessageAt_idx" RENAME TO "Conversation_lastMessageAt_idx";
ALTER INDEX "ChatConversation_updatedAt_idx" RENAME TO "Conversation_updatedAt_idx";
ALTER INDEX "ChatConversation_contextType_contextId_key" RENAME TO "Conversation_contextType_contextId_key";
ALTER INDEX "ChatParticipant_userId_idx" RENAME TO "ConversationParticipant_userId_idx";
ALTER INDEX "ChatParticipant_conversationId_userId_key" RENAME TO "ConversationParticipant_conversationId_userId_key";
ALTER INDEX "ChatMessage_conversationId_seq_key" RENAME TO "Message_conversationId_seq_key";
ALTER INDEX "ChatMessage_conversationId_updatedAt_idx" RENAME TO "Message_conversationId_updatedAt_idx";
ALTER INDEX "ChatMessage_senderId_idx" RENAME TO "Message_senderId_idx";

-- Data backfill: Role.permissions JSONB key 'chat' -> 'messaging'
UPDATE "Role"
SET "permissions" = (
  CASE
    WHEN NOT ("permissions" ? 'messaging') THEN jsonb_set("permissions", '{messaging}', "permissions"->'chat', true)
    ELSE "permissions"
  END
) - 'chat'
WHERE "permissions" IS NOT NULL AND "permissions" ? 'chat';

-- Data backfill: UserPreference keys
DELETE FROM "UserPreference" old_p
WHERE old_p."key" = 'chat_mute_map'
  AND EXISTS (
    SELECT 1 FROM "UserPreference" new_p
    WHERE new_p."userId" = old_p."userId" AND new_p."key" = 'messaging_mute_map'
  );
UPDATE "UserPreference" SET "key" = 'messaging_mute_map' WHERE "key" = 'chat_mute_map';

DELETE FROM "UserPreference" old_p
WHERE old_p."key" = 'chat_dnd_until'
  AND EXISTS (
    SELECT 1 FROM "UserPreference" new_p
    WHERE new_p."userId" = old_p."userId" AND new_p."key" = 'messaging_dnd_until'
  );
UPDATE "UserPreference" SET "key" = 'messaging_dnd_until' WHERE "key" = 'chat_dnd_until';

-- Data backfill: ActivityLog types and paths
UPDATE "ActivityLog" SET "type" = 'MESSAGE_DIRECT' WHERE "type" = 'CHAT_MESSAGE_DIRECT';
UPDATE "ActivityLog" SET "type" = 'MESSAGE_PROJECT' WHERE "type" IN ('CHAT_MESSAGE_PROJECT', 'PROJECT_CHAT_MESSAGE');
UPDATE "ActivityLog" SET "type" = 'MESSAGE_GROUP' WHERE "type" = 'CHAT_MESSAGE_GROUP';

UPDATE "ActivityLog" SET "path" = '/messages/direct' WHERE "path" = '/chat/direct';
UPDATE "ActivityLog" SET "path" = '/messages/project' WHERE "path" = '/chat/project';
UPDATE "ActivityLog" SET "path" = '/messages/group' WHERE "path" = '/chat/group';

-- Data backfill: Notification links and titles
UPDATE "Notification"
SET "link" = REPLACE("link", '&tab=chat', '&tab=messages')
WHERE "link" LIKE '%&tab=chat%';

UPDATE "Notification"
SET "title" = REPLACE("title", 'mentioned you in chat', 'mentioned you in messages')
WHERE "title" LIKE '%mentioned you in chat%';
