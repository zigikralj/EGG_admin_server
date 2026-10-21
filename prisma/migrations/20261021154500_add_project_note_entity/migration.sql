-- CreateTable
CREATE TABLE "ProjectNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectNoteVersion" (
    "id" BIGSERIAL NOT NULL,
    "noteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT,
    "patch" TEXT,
    "charDelta" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT,
    "authorName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectNoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectNote_projectId_key" ON "ProjectNote"("projectId");

-- CreateIndex
CREATE INDEX "ProjectNote_projectId_idx" ON "ProjectNote"("projectId");

-- CreateIndex
CREATE INDEX "ProjectNoteVersion_noteId_kind_version_idx" ON "ProjectNoteVersion"("noteId", "kind", "version");

-- CreateIndex
CREATE INDEX "ProjectNoteVersion_noteId_createdAt_idx" ON "ProjectNoteVersion"("noteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectNoteVersion_noteId_version_key" ON "ProjectNoteVersion"("noteId", "version");

-- AddForeignKey
ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNote" ADD CONSTRAINT "ProjectNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectNoteVersion" ADD CONSTRAINT "ProjectNoteVersion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ProjectNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data Backfill: Migrate existing Project.notes into ProjectNote & initial Keyframe version
DO $$
DECLARE
  r RECORD;
  new_note_id TEXT;
BEGIN
  FOR r IN SELECT id, notes, "createdAt", "updatedAt" FROM "Project" WHERE notes IS NOT NULL AND notes != '' LOOP
    new_note_id := gen_random_uuid()::text;
    
    -- Insert into ProjectNote
    INSERT INTO "ProjectNote" ("id", "projectId", "content", "version", "createdAt", "updatedAt")
    VALUES (new_note_id, r.id, r.notes, 1, r."createdAt", r."updatedAt");
    
    -- Insert initial baseline keyframe version
    INSERT INTO "ProjectNoteVersion" ("noteId", "version", "kind", "content", "charDelta", "authorName", "reason", "createdAt")
    VALUES (new_note_id, 1, 'S', r.notes, LENGTH(r.notes), 'System Migration', 'Baseline migration', r."updatedAt");
  END LOOP;
END $$;

-- Ensure notesPreview is backfilled on all Projects before dropping notes
UPDATE "Project"
SET "notesPreview" = LEFT(TRIM(regexp_replace(COALESCE("notes", ''), '<[^>]+>', ' ', 'g')), 300)
WHERE "notesPreview" IS NULL;

-- Drop old notes column from Project
ALTER TABLE "Project" DROP COLUMN "notes";
