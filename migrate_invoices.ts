import { prisma } from './src/db';

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
          console.log(`Updated invoice ${inv.invoiceNumber}`);
        } catch (e) {
          console.error(`Failed to update invoice ${inv.invoiceNumber}`, e);
        }
      }
    }
  }
  console.log("Migration complete.");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
