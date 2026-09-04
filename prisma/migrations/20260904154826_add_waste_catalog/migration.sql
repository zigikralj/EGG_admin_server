-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "permitId" TEXT,
ADD COLUMN     "permitNumber" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MENTION',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "projectId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientExtraData" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "permitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExtraData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permit" (
    "id" TEXT NOT NULL,
    "permitNumber" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteCatalog" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hazardListMark" TEXT,
    "isHazardous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WasteCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitWaste" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "wasteCatalogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermitWaste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_read_idx" ON "Notification"("read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientExtraData_clientId_key" ON "ClientExtraData"("clientId");

-- CreateIndex
CREATE INDEX "ClientExtraData_clientId_idx" ON "ClientExtraData"("clientId");

-- CreateIndex
CREATE INDEX "ClientExtraData_permitId_idx" ON "ClientExtraData"("permitId");

-- CreateIndex
CREATE INDEX "Permit_permitNumber_idx" ON "Permit"("permitNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WasteCatalog_code_key" ON "WasteCatalog"("code");

-- CreateIndex
CREATE INDEX "PermitWaste_permitId_idx" ON "PermitWaste"("permitId");

-- CreateIndex
CREATE INDEX "PermitWaste_wasteCatalogId_idx" ON "PermitWaste"("wasteCatalogId");

-- CreateIndex
CREATE UNIQUE INDEX "PermitWaste_permitId_wasteCatalogId_key" ON "PermitWaste"("permitId", "wasteCatalogId");

-- CreateIndex
CREATE INDEX "Reminder_permitId_idx" ON "Reminder"("permitId");

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "Permit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientExtraData" ADD CONSTRAINT "ClientExtraData_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientExtraData" ADD CONSTRAINT "ClientExtraData_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "Permit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitWaste" ADD CONSTRAINT "PermitWaste_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "Permit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitWaste" ADD CONSTRAINT "PermitWaste_wasteCatalogId_fkey" FOREIGN KEY ("wasteCatalogId") REFERENCES "WasteCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
