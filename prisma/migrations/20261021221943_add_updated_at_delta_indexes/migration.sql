-- CreateIndex
CREATE INDEX "Client_updatedAt_idx" ON "Client"("updatedAt");

-- CreateIndex
CREATE INDEX "Invoice_updatedAt_idx" ON "Invoice"("updatedAt");

-- CreateIndex
CREATE INDEX "Permit_updatedAt_idx" ON "Permit"("updatedAt");

-- CreateIndex
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");

-- CreateIndex
CREATE INDEX "ProvidedService_updatedAt_idx" ON "ProvidedService"("updatedAt");

-- CreateIndex
CREATE INDEX "Reminder_updatedAt_idx" ON "Reminder"("updatedAt");
