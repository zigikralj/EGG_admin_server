import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { prisma } from './db';

interface ClientMappingEntry {
  searchNames: string[];
  createFallback: {
    name: string;
    city?: string;
  };
}

const CLIENT_MAPPING: Record<string, ClientMappingEntry> = {
  GRAMMER: {
    searchNames: ['Grammer Automotive d.o.o.', 'GRAMMER SYSTEM DOO', 'Grammer'],
    createFallback: { name: 'Grammer Automotive d.o.o.', city: 'Aleksinac' },
  },
  ADIENT: {
    searchNames: ['Adient Seating d.o.o.', 'ADIENT AUTOMOTIVE DOO', 'Adient'],
    createFallback: { name: 'Adient Seating d.o.o.', city: 'Kragujevac' },
  },
  CORESO: {
    searchNames: ['Coreso d.o.o.', 'CORESO'],
    createFallback: { name: 'Coreso d.o.o.', city: 'Kragujevac' },
  },
  EUROTAY: {
    searchNames: ['EUROTAY DOO', 'Eurotay d.o.o.', 'Eurotay'],
    createFallback: { name: 'EUROTAY DOO', city: 'Kraljevo' },
  },
  FALKE: {
    searchNames: ['Falke Serbia d.o.o.', 'FALKE'],
    createFallback: { name: 'Falke Serbia d.o.o.', city: 'Leskovac' },
  },
  'PS FASHION': {
    searchNames: ['PS Fashion Design d.o.o.', 'PS FASHION', 'P.S. Fashion'],
    createFallback: { name: 'PS Fashion Design d.o.o.', city: 'Čačak' },
  },
  YUMIS: {
    searchNames: ['YUMIS DOO', 'Yumis d.o.o.', 'YUMIS'],
    createFallback: { name: 'Yumis d.o.o.', city: 'Niš' },
  },
  'IMI NIŠ': {
    searchNames: ['IMI Niš d.o.o.', 'IMI NIS', 'IMI Niš', 'IMI NIŠ'],
    createFallback: { name: 'IMI Niš d.o.o.', city: 'Niš' },
  },
  HIGIA: {
    searchNames: ['Higia d.o.o.', 'HIGIA DOO', 'HIGIA'],
    createFallback: { name: 'Higia d.o.o.', city: 'Pančevo' },
  },
  'GOOD YEAR': {
    searchNames: ['Goodyear Tires d.o.o.', 'Good Year', 'GOODYEAR'],
    createFallback: { name: 'Goodyear Tires d.o.o.', city: 'Kruševac' },
  },
  'IGB INĐIJA': {
    searchNames: ['IGB Automotive Inđija d.o.o.', 'IGB Inđija', 'IGB INĐIJA'],
    createFallback: { name: 'IGB Automotive Inđija d.o.o.', city: 'Inđija' },
  },
  'IGB LAZAREVAC': {
    searchNames: ['IGB Automotive Lazarevac d.o.o.', 'IGB Lazarevac', 'IGB LAZAREVAC'],
    createFallback: { name: 'IGB Automotive Lazarevac d.o.o.', city: 'Lazarevac' },
  },
  'FEKA ĆUPRIJA': {
    searchNames: ['Feka Automotive d.o.o. Ćuprija', 'Feka Ćuprija', 'FEKA'],
    createFallback: { name: 'Feka Automotive d.o.o. Ćuprija', city: 'Ćuprija' },
  },
  'MOJA SOBA': {
    searchNames: ['MOJA SOBA DOO', 'Moja Soba d.o.o.', 'MOJA SOBA'],
    createFallback: { name: 'MOJA SOBA DOO', city: 'Kraljevo' },
  },
  'WIN METAL': {
    searchNames: ['Win Metal d.o.o.', 'WIN METAL', 'WIN METAL DOO'],
    createFallback: { name: 'Win Metal d.o.o.', city: 'Kraljevo' },
  },
  'BANIM REKLAME': {
    searchNames: ['Banim Reklame d.o.o.', 'BANIM REKLAME DOO', 'BANIM REKLAME', 'BANIM'],
    createFallback: { name: 'Banim Reklame d.o.o.', city: 'Kraljevo' },
  },
  HEALTHCARE: {
    searchNames: ['Healthcare Europe d.o.o.', 'HEALTHCARE'],
    createFallback: { name: 'Healthcare Europe d.o.o.', city: 'Ruma' },
  },
  ITALTEX: {
    searchNames: ['Italtex d.o.o.', 'ITALTEX'],
    createFallback: { name: 'Italtex d.o.o.', city: 'Beograd' },
  },
};

const MONTH_NAME_MAP: Record<string, string> = {
  JANUAR: '01',
  FEBRUAR: '02',
  MART: '03',
  APRIL: '04',
  MAJ: '05',
  JUN: '06',
  JUL: '07',
  AVGUST: '08',
  SEPTEMBAR: '09',
  OKTOBAR: '10',
  NOVEMBAR: '11',
  DECEMBAR: '12',
};

function normalizeDate(rawDateVal: any, sheetName: string): string | null {
  if (rawDateVal === null || rawDateVal === undefined || rawDateVal === '') {
    return null;
  }

  // If number, could be Excel serial date
  if (typeof rawDateVal === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(rawDateVal);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        const y = String(parsed.y);
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // ignore
    }
  }

  const str = String(rawDateVal).trim();
  if (!str) return null;

  // DD.MM.YYYY or DD.MM.YYYY.
  const dateMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    const year = dateMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Check month name (for yearly sheets 2023, 2024, 2025)
  const monthUpper = str.toUpperCase();
  if (MONTH_NAME_MAP[monthUpper]) {
    const year = sheetName.match(/^\d{4}$/) ? sheetName : '2026';
    const month = MONTH_NAME_MAP[monthUpper];
    return `${year}-${month}-01`;
  }

  return null;
}

function parseKgValue(rawVal: any): number | null {
  if (rawVal === null || rawVal === undefined || rawVal === '' || rawVal === 0 || rawVal === '0') {
    return null;
  }

  let num: number;
  if (typeof rawVal === 'number') {
    num = rawVal;
  } else {
    const cleaned = String(rawVal).replace(/\s/g, '').replace(',', '.');
    num = parseFloat(cleaned);
  }

  if (isNaN(num) || num <= 0) return null;

  // In this Excel sheet, 9.68 means 9680 kg (scaled by 1000)
  return Math.round(num * 1000);
}

export async function importWasteDisposalServices() {
  const excelPath = path.resolve(process.cwd(), 'import-export/2026_EGG_Količine zbrinutog otpada.xlsx');
  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found: ${excelPath}`);
    process.exit(1);
  }

  console.log(`📖 Reading Excel file: ${excelPath}...`);
  const workbook = XLSX.readFile(excelPath, { cellDates: false });

  // 1. Ensure Waste Disposal service exists
  let wasteService = await prisma.service.findUnique({ where: { code: 'waste-disposal' } });
  if (!wasteService) {
    console.log('Creating waste-disposal service...');
    wasteService = await prisma.service.create({
      data: {
        code: 'waste-disposal',
        name: 'Waste Disposal',
        group: 'grp-waste',
        frequency: 0,
        description: 'Preuzimanje, transport i zbrinjavanje neopasnog i industrijskog otpada',
      },
    });
  }

  // 2. Resolve or create all client IDs
  const allDbClients = await prisma.client.findMany();
  const resolvedClients: Record<string, { id: string; name: string; city: string | null }> = {};

  for (const [colTitle, config] of Object.entries(CLIENT_MAPPING)) {
    let found = allDbClients.find((c) =>
      config.searchNames.some((sn) => sn.toLowerCase() === c.name.toLowerCase())
    );

    if (!found) {
      found = allDbClients.find((c) =>
        config.searchNames.some((sn) => c.name.toLowerCase().includes(sn.toLowerCase()))
      );
    }

    if (!found) {
      console.log(`Creating client for column "${colTitle}": ${config.createFallback.name}`);
      found = await prisma.client.create({
        data: {
          name: config.createFallback.name,
          city: config.createFallback.city || 'Srbija',
        },
      });
      allDbClients.push(found);
    }

    resolvedClients[colTitle] = {
      id: found.id,
      name: found.name,
      city: found.city,
    };
  }

  console.log('Client mapping resolved:');
  for (const [col, c] of Object.entries(resolvedClients)) {
    console.log(`  - [${col}] -> ${c.name} (${c.city || 'N/A'})`);
  }

  // 3. Process every sheet
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalProcessed = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) continue;

    const headers = rows[1] ? rows[1].map((h) => String(h).trim()) : [];
    let sheetRecords = 0;

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      const rawDate = row[0];
      const firstColStr = String(rawDate || '').trim();

      if (!firstColStr || firstColStr.toUpperCase().includes('UKUPNO') || firstColStr.toUpperCase().includes('SUM')) {
        continue;
      }

      const dateStr = normalizeDate(rawDate, sheetName);
      if (!dateStr) {
        continue;
      }

      for (let c = 1; c < headers.length; c++) {
        const colTitle = headers[c];
        if (!colTitle || colTitle.toUpperCase().includes('UKUPNO') || colTitle.toUpperCase().includes('SUM')) {
          continue;
        }

        const clientInfo = resolvedClients[colTitle];
        if (!clientInfo) {
          continue;
        }

        const kg = parseKgValue(row[c]);
        if (!kg) continue;

        totalProcessed++;
        sheetRecords++;

        // Format price estimated at 25 RSD / kg (or 0)
        const price = Math.round(kg * 25);
        const notes = `Preuzimanje i zbrinjavanje industrijskog otpada (${kg.toLocaleString('sr-RS')} kg)`;

        // Check existing provided service by serviceId, clientId, and completionDate
        const existing = await prisma.providedService.findFirst({
          where: {
            serviceId: wasteService.id,
            clientId: clientInfo.id,
            completionDate: dateStr,
          },
        });

        const customDataPayload = {
          kolicina_kg: kg,
          vrsta_otpada: 'Industrijski i ambalažni otpad',
        };

        if (existing) {
          await prisma.providedService.update({
            where: { id: existing.id },
            data: {
              status: 'Completed',
              scheduledDate: dateStr,
              completionDate: dateStr,
              location: clientInfo.city || existing.location || 'Srbija',
              price,
              notes,
              customData: customDataPayload,
            },
          });
          totalUpdated++;
        } else {
          await prisma.providedService.create({
            data: {
              serviceId: wasteService.id,
              clientId: clientInfo.id,
              status: 'Completed',
              scheduledDate: dateStr,
              completionDate: dateStr,
              location: clientInfo.city || 'Srbija',
              price,
              currency: 'RSD',
              notes,
              customData: customDataPayload,
            },
          });
          totalCreated++;
        }
      }
    }

    console.log(`Sheet "${sheetName}": processed ${sheetRecords} records.`);
  }

  // Clean up temporary inspection script if any
  const tempInspectPath = path.resolve(process.cwd(), 'src/inspectExcel.ts');
  if (fs.existsSync(tempInspectPath)) {
    fs.unlinkSync(tempInspectPath);
  }

  console.log(`\n🎉 Waste disposal import finished successfully!`);
  console.log(`   - Total records processed: ${totalProcessed}`);
  console.log(`   - Created new: ${totalCreated}`);
  console.log(`   - Updated existing: ${totalUpdated}`);
}

if (require.main === module) {
  importWasteDisposalServices()
    .catch((err) => {
      console.error('Fatal error during Excel import:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
