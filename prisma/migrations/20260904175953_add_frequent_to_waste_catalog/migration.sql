-- AlterTable
ALTER TABLE "WasteCatalog" ADD COLUMN     "frequent" INTEGER;

-- CreateIndex
CREATE INDEX "WasteCatalog_frequent_idx" ON "WasteCatalog"("frequent");
