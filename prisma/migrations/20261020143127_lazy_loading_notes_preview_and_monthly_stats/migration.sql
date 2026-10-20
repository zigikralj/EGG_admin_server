-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "notesPreview" TEXT;

-- CreateTable
CREATE TABLE "ActivityLogMonthlyStats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "totalDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "moduleBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLogMonthlyStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLogMonthlyStats_yearMonth_idx" ON "ActivityLogMonthlyStats"("yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLogMonthlyStats_userId_yearMonth_key" ON "ActivityLogMonthlyStats"("userId", "yearMonth");

-- AddForeignKey
ALTER TABLE "ActivityLogMonthlyStats" ADD CONSTRAINT "ActivityLogMonthlyStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill notesPreview
UPDATE "Project"
SET "notesPreview" = LEFT(TRIM(regexp_replace(COALESCE("notes", ''), '<[^>]+>', ' ', 'g')), 300);
