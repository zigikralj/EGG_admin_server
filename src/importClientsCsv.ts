import fs from 'fs';
import path from 'path';
import { prisma } from './db';

function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export async function importClientsFromCsv() {
  const csvPath = path.resolve(process.cwd(), 'import-export/Client.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) {
    console.log('⚠️ No data rows found in CSV.');
    return;
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => h.replace(/^"|"$/g, '').trim());
  console.log(`📋 Found headers:`, headers);

  const rows = lines.slice(1);
  console.log(`🔄 Processing ${rows.length} client rows...`);

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const values = parseCSVLine(line).map((v) => v.replace(/^"|"$/g, '').trim());

    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] ?? '';
    });

    const id = rowObj['id'];
    const name = rowObj['name'];
    const contactPerson = rowObj['contactPerson'] || null;
    const email = rowObj['email'] || null;
    const phone = rowObj['phone'] || null;
    const city = rowObj['city'] || null;
    const createdAt = rowObj['createdAt'] ? new Date(rowObj['createdAt']) : new Date();
    const updatedAt = rowObj['updatedAt'] ? new Date(rowObj['updatedAt']) : new Date();

    if (!name) {
      console.warn(`Row ${i + 2} has no name, skipping.`);
      skipped++;
      continue;
    }

    try {
      if (id) {
        const existing = await prisma.client.findUnique({ where: { id } });
        if (existing) {
          await prisma.client.update({
            where: { id },
            data: {
              name,
              contactPerson,
              email,
              phone,
              city,
              updatedAt,
            },
          });
          updated++;
        } else {
          await prisma.client.create({
            data: {
              id,
              name,
              contactPerson,
              email,
              phone,
              city,
              createdAt,
              updatedAt,
            },
          });
          imported++;
        }
      } else {
        // Find by name if id is not present
        const existing = await prisma.client.findFirst({ where: { name } });
        if (existing) {
          await prisma.client.update({
            where: { id: existing.id },
            data: {
              contactPerson,
              email,
              phone,
              city,
              updatedAt,
            },
          });
          updated++;
        } else {
          await prisma.client.create({
            data: {
              name,
              contactPerson,
              email,
              phone,
              city,
              createdAt,
              updatedAt,
            },
          });
          imported++;
        }
      }
    } catch (err) {
      console.error(`❌ Error importing row ${i + 2} (${name}):`, err);
    }
  }

  console.log(`✅ Import finished:`);
  console.log(`   - Created new: ${imported}`);
  console.log(`   - Updated: ${updated}`);
  console.log(`   - Skipped: ${skipped}`);
  console.log(`   - Total processed: ${rows.length}`);
}

if (require.main === module) {
  importClientsFromCsv()
    .catch((err) => {
      console.error('Fatal error during CSV import:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
