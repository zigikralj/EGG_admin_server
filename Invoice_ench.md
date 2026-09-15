# Backend Changes Required

Because my current workspace is limited to the `client` folder, I cannot edit the backend files in the `server` folder directly. Please apply the following changes to your backend to support the native invoice fields.

## 1. Update `server/prisma/schema.prisma`

Add the following fields and relations to the `Invoice` model:

```prisma
model Invoice {
  id              String   @id @default(uuid())
  invoiceNumber   String   @unique
  invoiceType     String?  @default("Standard")
  parentInvoiceId String?
  
  // ... existing fields ...

  parentInvoice   Invoice?  @relation("ParentChildInvoices", fields: [parentInvoiceId], references: [id], onDelete: SetNull)
  childInvoices   Invoice[] @relation("ParentChildInvoices")

  // ... existing relations ...

  @@index([parentInvoiceId])
}
```

## 2. Apply Schema Changes

Run the following command in your `server` directory:

```bash
npm run db:push:local
```
*(Or use `migrate dev` if you prefer to generate migration files).*

## 3. Update `server/src/routes/invoices.routes.ts`

In both the `POST /api/invoices` and `PUT /api/invoices/:id` handlers, make sure you accept and save `invoiceType` and `parentInvoiceId`:

```typescript
// Inside POST and PUT handlers:
const {
  invoiceNumber,
  invoiceType,     // <-- Extract these
  parentInvoiceId, // <--
  dateCreated,
  // ...
} = req.body;

// Inside prisma.invoice.create / update:
const invoice = await prisma.invoice.create({
  data: {
    invoiceNumber,
    invoiceType: invoiceType || 'Standard',
    parentInvoiceId: parentInvoiceId || null,
    // ...
  }
});
```

## 4. Run Data Migration (Optional)

If you have existing invoices that use the HTML comment hack inside the `notes` field, you'll want to run a quick script to extract that metadata and populate the new columns, then remove the comments from the notes.

```typescript
// script example (migrate_invoices.ts):
import { prisma } from './db';

const META_REGEX = /(?:\r?\n)?<!--meta:(\{.*?\})-->$/s;

async function run() {
  const invoices = await prisma.invoice.findMany();
  for (const inv of invoices) {
    if (inv.notes) {
      const match = inv.notes.match(META_REGEX);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          const cleanNotes = inv.notes.replace(META_REGEX, '').trim();
          await prisma.invoice.update({
            where: { id: inv.id },
            data: {
              notes: cleanNotes,
              invoiceType: parsed.type || 'Standard',
              parentInvoiceId: parsed.parentId || null,
            }
          });
        } catch (e) {
          console.error(e);
        }
      }
    }
  }
}
run();
```
