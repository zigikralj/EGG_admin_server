-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "invoiceType" TEXT,
ADD COLUMN IF NOT EXISTS "parentInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Permit" ADD COLUMN IF NOT EXISTS "permitTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "clientId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Invoice_parentInvoiceId_idx" ON "Invoice"("parentInvoiceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Permit_clientId_idx" ON "Permit"("clientId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_parentInvoiceId_fkey'
  ) THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_parentInvoiceId_fkey" FOREIGN KEY ("parentInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Permit_clientId_fkey'
  ) THEN
    ALTER TABLE "Permit" ADD CONSTRAINT "Permit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
