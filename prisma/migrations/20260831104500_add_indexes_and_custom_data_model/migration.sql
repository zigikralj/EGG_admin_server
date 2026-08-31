-- AlterTable
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "customDataModel" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_responsibleId_idx" ON "Project"("responsibleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_done_idx" ON "Project"("done");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_type_idx" ON "Project"("type");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserPreference_userId_idx" ON "UserPreference"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reminder_projectId_idx" ON "Reminder"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reminder_clientId_idx" ON "Reminder"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reminder_responsibleId_idx" ON "Reminder"("responsibleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reminder_status_idx" ON "Reminder"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_projectId_idx" ON "Invoice"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvidedService_serviceId_idx" ON "ProvidedService"("serviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvidedService_clientId_idx" ON "ProvidedService"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvidedService_projectId_idx" ON "ProvidedService"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvidedService_invoiceId_idx" ON "ProvidedService"("invoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProvidedService_status_idx" ON "ProvidedService"("status");

