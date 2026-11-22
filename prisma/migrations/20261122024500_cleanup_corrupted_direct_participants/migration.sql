-- Remove accidentally @mention-added third-party participants from corrupted DIRECT conversations.
-- Safe & idempotent: only targets the two known corrupted DIRECT conversations when type = 'DIRECT'.
DELETE FROM "ConversationParticipant" cp
USING "Conversation" c
WHERE cp."conversationId" = c."id"
  AND c."type" = 'DIRECT'
  AND (
    (
      cp."conversationId" = '55aea5e2-e5f0-478a-af99-5e666ebc6db1'
      AND cp."userId" = '65d975a1-b6e4-40c2-a4d3-bfac3f1f8ed6'
    )
    OR (
      cp."conversationId" = 'a176e8cb-cfbc-4eaa-9e72-7fa1cb2926df'
      AND cp."userId" IN (
        '65d975a1-b6e4-40c2-a4d3-bfac3f1f8ed6',
        'e9445430-2f6a-461d-8fe3-714e5e106d52'
      )
    )
  );
