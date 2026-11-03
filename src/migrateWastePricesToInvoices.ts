import { basePrisma } from './db';
import { INVOICE_STATUSES, INVOICE_TYPES } from './constants';

function extractYearMonth(
  dateStr?: string | null,
  fallbackDate?: Date | null
): { year: string; month: string } {
  if (dateStr) {
    const match = String(dateStr).trim().match(/^(\d{4})[-/.](\d{2})/);
    if (match) {
      return { year: match[1], month: match[2] };
    }
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const year = String(parsed.getFullYear());
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      return { year, month };
    }
  }

  if (fallbackDate && !isNaN(fallbackDate.getTime())) {
    const year = String(fallbackDate.getFullYear());
    const month = String(fallbackDate.getMonth() + 1).padStart(2, '0');
    return { year, month };
  }

  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
  };
}

export async function migrateWastePricesToInvoices(options: { dryRun?: boolean } = {}) {
  const isDryRun = options.dryRun ?? process.argv.includes('--dry-run');

  console.log(`\n======================================================`);
  console.log(` Starting Waste Prices -> Invoices Migration`);
  console.log(` Mode: ${isDryRun ? '🔍 DRY RUN (no database changes)' : '🚀 LIVE EXECUTION'}`);
  console.log(`======================================================\n`);

  // 1. Fetch eligible ProvidedService records using raw SQL so it works before columns are dropped (e.g. on Neon)
  let eligibleServices: Array<{
    id: string;
    serviceId: string;
    clientId: string;
    projectId: string | null;
    invoiceId: string | null;
    completionDate: string | null;
    scheduledDate: string | null;
    createdAt: Date;
    notes: string | null;
    price: number | null;
    currency: string | null;
    clientName: string | null;
    projectName: string | null;
  }> = [];

  try {
    eligibleServices = await basePrisma.$queryRaw<typeof eligibleServices>`
      SELECT 
        ps.id, ps."serviceId", ps."clientId", ps."projectId", ps."invoiceId", 
        ps."completionDate", ps."scheduledDate", ps."createdAt", ps.notes,
        ps.price, ps.currency,
        c.name as "clientName",
        p.name as "projectName"
      FROM "ProvidedService" ps
      LEFT JOIN "Client" c ON c.id = ps."clientId"
      LEFT JOIN "Project" p ON p.id = ps."projectId"
      WHERE ps.price > 0 AND ps."invoiceId" IS NULL
      ORDER BY ps."completionDate" ASC, ps."scheduledDate" ASC, ps."createdAt" ASC, ps.id ASC
    `;
  } catch (err: any) {
    if (err?.message?.includes('column ps.price does not exist') || err?.message?.includes('column "price" does not exist')) {
      console.log('Column "price" does not exist in ProvidedService table (already migrated/dropped).');
      return { totalMigrated: 0, totalAmountRSD: 0, isDryRun };
    }
    throw err;
  }

  const totalEligible = eligibleServices.length;
  console.log(`Found ${totalEligible} provided services with price > 0 and no attached invoice.`);

  if (totalEligible === 0) {
    console.log('No records need migration. Exiting.');
    return { totalMigrated: 0, totalAmountRSD: 0, isDryRun };
  }

  // 2. Query existing HIST- invoice numbers to avoid collisions
  const existingHistInvoices = await basePrisma.invoice.findMany({
    where: {
      invoiceNumber: { startsWith: 'HIST-' },
    },
    select: { invoiceNumber: true },
  });

  const existingNumbersSet = new Set(existingHistInvoices.map((i) => i.invoiceNumber));
  console.log(`Found ${existingHistInvoices.length} existing HIST- invoices in the database.`);

  // 3. Track monthly sequence counters
  const monthCounters = new Map<string, number>();

  for (const inv of existingHistInvoices) {
    // Pattern: HIST-YYYY/MM/XXX
    const match = inv.invoiceNumber.match(/^HIST-(\d{4})\/(\d{2})\/(\d+)$/);
    if (match) {
      const key = `${match[1]}/${match[2]}`;
      const num = parseInt(match[3], 10);
      const currentMax = monthCounters.get(key) || 0;
      if (num > currentMax) {
        monthCounters.set(key, num);
      }
    }
  }

  // 4. Plan migrations
  let totalAmountRSD = 0;
  const plan: Array<{
    serviceId: string;
    invoiceNumber: string;
    clientId: string;
    clientName: string | null;
    projectId: string | null;
    projectName: string | null;
    date: string;
    amount: number;
    currency: string;
    itemDescription: string;
  }> = [];

  for (const service of eligibleServices) {
    const amount = Number(service.price) || 0;
    const currency = service.currency || 'RSD';
    if (currency === 'RSD') {
      totalAmountRSD += amount;
    }

    const { year, month } = extractYearMonth(
      service.completionDate || service.scheduledDate,
      service.createdAt
    );
    const monthKey = `${year}/${month}`;
    const firstOfMonthDate = `${year}-${month}-01`;

    let counter = (monthCounters.get(monthKey) || 0) + 1;
    let invoiceNumber = `HIST-${year}/${month}/${String(counter).padStart(3, '0')}`;
    while (existingNumbersSet.has(invoiceNumber)) {
      counter++;
      invoiceNumber = `HIST-${year}/${month}/${String(counter).padStart(3, '0')}`;
    }

    monthCounters.set(monthKey, counter);
    existingNumbersSet.add(invoiceNumber);

    plan.push({
      serviceId: service.id,
      invoiceNumber,
      clientId: service.clientId,
      clientName: service.clientName || null,
      projectId: service.projectId || null,
      projectName: service.projectName || null,
      date: firstOfMonthDate,
      amount,
      currency,
      itemDescription:
        (service.notes && service.notes.trim()) ||
        'Preuzimanje i zbrinjavanje industrijskog otpada',
    });
  }

  console.log(`\nGenerated ${plan.length} invoices across ${monthCounters.size} month periods.`);
  console.log(`Total amount (RSD): ${totalAmountRSD.toLocaleString('sr-RS')} RSD`);

  console.log('\n--- Sample of planned invoices (first 5) ---');
  for (const item of plan.slice(0, 5)) {
    console.log(
      `  • ${item.invoiceNumber} | Date: ${item.date} | Amount: ${item.amount.toLocaleString()} ${item.currency} | Client: ${item.clientName || item.clientId}`
    );
  }
  if (plan.length > 5) {
    console.log(`  ... and ${plan.length - 5} more.`);
  }

  if (isDryRun) {
    console.log('\n[DRY RUN] No database records were modified.');
    return { totalMigrated: plan.length, totalAmountRSD, isDryRun: true };
  }

  // 5. Execute migration in batches of 50 to avoid oversized transactions
  console.log('\nStarting database write operations in transactions...');
  const BATCH_SIZE = 50;
  let migratedCount = 0;

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const chunk = plan.slice(i, i + BATCH_SIZE);

    await basePrisma.$transaction(async (tx) => {
      for (const item of chunk) {
        // Create invoice with item
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: item.invoiceNumber,
            invoiceType: INVOICE_TYPES.STANDARD,
            status: INVOICE_STATUSES.PAID,
            dateCreated: item.date,
            dueDate: item.date,
            paymentDate: item.date,
            clientId: item.clientId,
            clientName: item.clientName,
            projectId: item.projectId,
            projectName: item.projectName,
            totalAmount: item.amount,
            currency: item.currency,
            notes: 'Automatski generisano iz istorijskih podataka pružene usluge (db:import-waste)',
            items: {
              create: {
                description: item.itemDescription,
                quantity: 1,
                unitPrice: item.amount,
                currency: item.currency,
              },
            },
          },
        });

        // Link ProvidedService
        await tx.providedService.update({
          where: { id: item.serviceId },
          data: { invoiceId: invoice.id },
        });
      }
    });

    migratedCount += chunk.length;
    console.log(`  ✓ Processed ${migratedCount} / ${plan.length} invoices`);
  }

  console.log(`\n🎉 Successfully migrated ${migratedCount} waste provided services to paid invoices!`);
  console.log(`Total invoiced amount: ${totalAmountRSD.toLocaleString('sr-RS')} RSD\n`);

  return { totalMigrated: migratedCount, totalAmountRSD, isDryRun: false };
}

if (process.argv[1]?.endsWith('migrateWastePricesToInvoices.ts')) {
  migrateWastePricesToInvoices()
    .catch((err) => {
      console.error('Fatal error during migration:', err);
      process.exit(1);
    })
    .finally(async () => {
      await basePrisma.$disconnect().catch(() => {});
      process.exit(0);
    });
}
