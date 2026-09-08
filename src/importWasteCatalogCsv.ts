import fs from 'fs';
import path from 'path';
import { prisma } from './db';

/**
 * Parses CSV text taking into account quotes, commas inside quotes,
 * escaped quotes, and multiline cells.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      current.push(field);
      field = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') {
        i++;
      }
      current.push(field);
      field = '';
      if (current.some((f) => f.trim().length > 0)) {
        rows.push(current);
      }
      current = [];
    } else {
      field += c;
    }
  }

  if (field || current.length > 0) {
    current.push(field);
    if (current.some((f) => f.trim().length > 0)) {
      rows.push(current);
    }
  }

  return rows;
}

export interface ImportWasteCatalogOptions {
  filePath?: string;
  includeCategories?: boolean;
}

export async function importWasteCatalogFromCsv(options: ImportWasteCatalogOptions = {}) {
  const targetPath =
    options.filePath ||
    process.env.WASTE_CATALOG_CSV_PATH ||
    path.resolve(process.cwd(), 'import-export/dozvole_indeksi.csv');

  if (!fs.existsSync(targetPath)) {
    console.error(`❌ Waste catalog CSV file not found at: ${targetPath}`);
    process.exit(1);
  }

  console.log(`📖 Reading waste catalog CSV from: ${targetPath}`);
  const rawContent = fs.readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, '');
  const parsedRows = parseCSV(rawContent);

  if (parsedRows.length === 0) {
    console.log('⚠️ CSV file is empty.');
    return;
  }

  console.log(`📋 Total rows parsed in CSV: ${parsedRows.length}`);

  const includeCategories =
    options.includeCategories ?? process.argv.includes('--all') ?? process.argv.includes('--include-categories');

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let hazardousCount = 0;
  let nonHazardousCount = 0;

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    let rawCode = (row[0] || '').trim();
    let description = (row[1] || '').trim();
    let rawMark = (row[2] || '').trim();

    // Check if header row
    if (rawCode.toLowerCase() === 'kod' || rawCode.toLowerCase() === 'code' || rawMark.includes('Oznake')) {
      // Row 0 has 'Oznake za N listu opasnosti' in 3rd col
      // Check if this row is chapter 1 or a pure column header
      if (rawCode === '1' && description.toLowerCase().startsWith('otpadi')) {
        // This is chapter 1 in the Serbian catalog, but mark has the column title
        rawMark = '';
      } else {
        skipped++;
        continue;
      }
    }

    if (!rawCode || !description) {
      skipped++;
      continue;
    }

    // Clean footnotes in code (e.g. 19 10 05*1 -> 19 10 05*, 19 10 061 -> 19 10 06)
    let code = rawCode;
    if (code === '19 10 05*1') {
      code = '19 10 05*';
    } else if (code === '19 10 061') {
      code = '19 10 06';
    }

    // Normalize multiple spaces within code
    code = code.replace(/\s+/g, ' ').trim();

    const is6DigitIndex = /^\d{2}\s\d{2}\s\d{2}\*?$/.test(code);
    const isCategoryOrChapter = /^\d{1,2}$/.test(code) || /^\d{2}\s\d{2}$/.test(code);

    if (!is6DigitIndex && !includeCategories) {
      skipped++;
      continue;
    }

    // An entry is hazardous if and only if it has an asterisk '*'
    const isHazardous = code.includes('*');
    const hazardListMark = rawMark && !rawMark.includes('Oznake') ? rawMark : null;

    try {
      const existing = await prisma.wasteCatalog.findUnique({
        where: { code },
      });

      if (existing) {
        await prisma.wasteCatalog.update({
          where: { code },
          data: {
            description,
            hazardListMark,
            isHazardous,
          },
        });
        updated++;
      } else {
        await prisma.wasteCatalog.create({
          data: {
            code,
            description,
            hazardListMark,
            isHazardous,
          },
        });
        created++;
      }

      if (isHazardous) {
        hazardousCount++;
      } else {
        nonHazardousCount++;
      }
    } catch (err) {
      console.error(`❌ Error importing waste code "${code}" (row ${i + 1}):`, err);
    }
  }

  console.log(`\n✅ Waste Catalog Import finished:`);
  console.log(`   - Created new: ${created}`);
  console.log(`   - Updated: ${updated}`);
  console.log(`   - Skipped (headers/categories): ${skipped}`);
  console.log(`   - Hazardous items (with *): ${hazardousCount}`);
  console.log(`   - Non-hazardous items: ${nonHazardousCount}`);
  console.log(`   - Total active in catalog: ${created + updated}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const includeCategories = args.includes('--all') || args.includes('--include-categories');
  const filePathArg = args.find((a) => !a.startsWith('--'));

  importWasteCatalogFromCsv({
    filePath: filePathArg,
    includeCategories,
  })
    .catch((err) => {
      console.error('Fatal error during Waste Catalog import:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
}
