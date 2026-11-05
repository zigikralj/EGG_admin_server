import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { Client as PgClient } from 'pg';

function parseCopyData(dumpPath: string, tableName: string): { headers: string[]; rows: Record<string, string | null>[] } {
  const res = spawnSync('pg_restore', ['-f', '-', '--data-only', '-t', tableName, dumpPath], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });

  if (res.error) {
    throw new Error(`Failed to run pg_restore: ${res.error.message}`);
  }

  const output = res.stdout;
  const lines = output.split('\n');
  let inCopy = false;
  let headers: string[] = [];
  const rows: Record<string, string | null>[] = [];

  for (const line of lines) {
    if (line.startsWith(`COPY public."${tableName}"`)) {
      inCopy = true;
      const match = line.match(/\((.*?)\)/);
      if (match) {
        headers = match[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      }
      continue;
    }
    if (inCopy) {
      if (line.trim() === '\\.') {
        break;
      }
      if (!line) continue;
      const parts = line.split('\t');
      const row: Record<string, string | null> = {};
      headers.forEach((h, idx) => {
        const val = parts[idx];
        row[h] = val === '\\N' ? null : val;
      });
      rows.push(row);
    }
  }

  return { headers, rows };
}

function escapeLiteral(val: string | null): string {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function importProvidedServices(options: { dumpPath?: string; truncateExisting?: boolean } = {}) {
  const defaultDump = path.resolve(__dirname, '../../db_backups/backup_04_11_2026_160421.dump');
  const dumpPath = options.dumpPath || process.argv[2] || defaultDump;

  if (!fs.existsSync(dumpPath)) {
    console.error(`❌ Backup dump file not found at: ${dumpPath}`);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ekos_tracker';
  console.log(`\n======================================================`);
  console.log(` Importing Provided Services from Production Dump`);
  console.log(` Source dump: ${dumpPath}`);
  console.log(` Target DB:   ${databaseUrl}`);
  console.log(`======================================================\n`);

  console.log('📦 Parsing backup dump via pg_restore...');
  const { rows: psRows } = parseCopyData(dumpPath, 'ProvidedService');
  const { rows: sRows } = parseCopyData(dumpPath, 'Service');
  const { rows: cRows } = parseCopyData(dumpPath, 'Client');
  const { rows: pRows } = parseCopyData(dumpPath, 'Project');

  console.log(`   Found ${psRows.length} ProvidedService records in dump.`);

  const neededServiceIds = new Set(psRows.map((r) => r.serviceId).filter(Boolean));
  const neededClientIds = new Set(psRows.map((r) => r.clientId).filter(Boolean));
  const neededProjectIds = new Set(psRows.map((r) => r.projectId).filter(Boolean));

  const matchingServices = sRows.filter((s) => neededServiceIds.has(s.id));
  const matchingClients = cRows.filter((c) => neededClientIds.has(c.id));
  const matchingProjects = pRows.filter((p) => neededProjectIds.has(p.id));

  console.log(`   Referenced dependencies to import/upsert:`);
  console.log(`   - Services: ${matchingServices.length}`);
  console.log(`   - Clients:  ${matchingClients.length}`);
  console.log(`   - Projects: ${matchingProjects.length}`);

  const client = new PgClient({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN;');
    await client.query("SET LOCAL audit.disabled = 'true';");

    // 1. Upsert Services
    for (const s of matchingServices) {
      // Check if a service with this code already exists
      const existingCodeRes = await client.query(`SELECT id FROM "Service" WHERE code = $1;`, [s.code]);
      if (existingCodeRes.rows.length > 0) {
        // Update the existing record and its ID to match the dump
        await client.query(`
          UPDATE "Service"
          SET id = $1,
              name = $2,
              "group" = $3,
              frequency = $4,
              description = $5,
              "customDataModel" = $6::jsonb,
              "updatedAt" = $7::timestamp
          WHERE code = $8;
        `, [s.id, s.name, s.group, parseInt(s.frequency || '0', 10), s.description, s.customDataModel, s.updatedAt, s.code]);
      } else {
        const cols = Object.keys(s);
        const colNames = cols.map((c) => `"${c}"`).join(', ');
        const valLiterals = cols.map((c) => escapeLiteral(s[c])).join(', ');
        await client.query(`
          INSERT INTO "Service" (${colNames})
          VALUES (${valLiterals})
          ON CONFLICT (id) DO UPDATE SET
            "name" = EXCLUDED."name",
            "group" = EXCLUDED."group",
            "customDataModel" = EXCLUDED."customDataModel",
            "updatedAt" = EXCLUDED."updatedAt";
        `);
      }
    }
    console.log(`✅ Upserted ${matchingServices.length} referenced Services`);

    // 2. Upsert Clients
    for (const c of matchingClients) {
      const cols = Object.keys(c);
      const colNames = cols.map((col) => `"${col}"`).join(', ');
      const valLiterals = cols.map((col) => escapeLiteral(c[col])).join(', ');
      await client.query(`
        INSERT INTO "Client" (${colNames})
        VALUES (${valLiterals})
        ON CONFLICT (id) DO UPDATE SET
          "name" = EXCLUDED."name",
          "contactPerson" = EXCLUDED."contactPerson",
          "email" = EXCLUDED."email",
          "phone" = EXCLUDED."phone",
          "city" = EXCLUDED."city",
          "updatedAt" = EXCLUDED."updatedAt";
      `);
    }
    console.log(`✅ Upserted ${matchingClients.length} referenced Clients`);

    // 3. Upsert Projects
    // Check if responsibleId exists in local User table, if not nullify to prevent FK error
    for (const p of matchingProjects) {
      if (p.responsibleId) {
        const userRes = await client.query(`SELECT id FROM "User" WHERE id = $1;`, [p.responsibleId]);
        if (userRes.rows.length === 0) {
          p.responsibleId = null;
        }
      }
      const cols = Object.keys(p);
      const colNames = cols.map((col) => `"${col}"`).join(', ');
      const valLiterals = cols.map((col) => escapeLiteral(p[col])).join(', ');
      await client.query(`
        INSERT INTO "Project" (${colNames})
        VALUES (${valLiterals})
        ON CONFLICT (id) DO UPDATE SET
          "name" = EXCLUDED."name",
          "clientId" = EXCLUDED."clientId",
          "updatedAt" = EXCLUDED."updatedAt";
      `);
    }
    console.log(`✅ Upserted ${matchingProjects.length} referenced Projects`);

    // 4. Clean out old mock ProvidedServices if requested (default true)
    const shouldTruncate = options.truncateExisting ?? true;
    if (shouldTruncate) {
      await client.query('TRUNCATE "ProvidedService" CASCADE;');
      console.log('🧹 Cleared existing ProvidedService table for clean import.');
    }

    // 5. Insert ProvidedServices (with price and currency)
    let priceCount = 0;
    for (const r of psRows) {
      const priceNum = parseFloat(r.price || '0');
      if (priceNum > 0) priceCount++;

      const cols = Object.keys(r);
      const colNames = cols.map((c) => `"${c}"`).join(', ');
      const valLiterals = cols.map((c) => escapeLiteral(r[c])).join(', ');
      await client.query(`
        INSERT INTO "ProvidedService" (${colNames})
        VALUES (${valLiterals})
        ON CONFLICT (id) DO UPDATE SET
          "serviceId" = EXCLUDED."serviceId",
          "clientId" = EXCLUDED."clientId",
          "projectId" = EXCLUDED."projectId",
          "invoiceId" = EXCLUDED."invoiceId",
          "status" = EXCLUDED."status",
          "location" = EXCLUDED."location",
          "scheduledDate" = EXCLUDED."scheduledDate",
          "completionDate" = EXCLUDED."completionDate",
          "price" = EXCLUDED."price",
          "currency" = EXCLUDED."currency",
          "notes" = EXCLUDED."notes",
          "customData" = EXCLUDED."customData",
          "updatedAt" = EXCLUDED."updatedAt";
      `);
    }
    console.log(`✅ Inserted ${psRows.length} ProvidedService records (${priceCount} with price > 0)`);

    // 6. Update waste_disposal_service_id SystemSetting to match production
    await client.query(`
      INSERT INTO "SystemSetting" (id, key, value, "createdAt", "updatedAt")
      VALUES ('waste_setting_default', 'waste_disposal_service_id', '21de4158-170a-4a0e-b4f9-a7a569f146b6', NOW(), NOW())
      ON CONFLICT (key) DO UPDATE SET value = '21de4158-170a-4a0e-b4f9-a7a569f146b6', "updatedAt" = NOW();
    `);
    console.log(`✅ Configured waste_disposal_service_id in SystemSetting to production service '21de4158-170a-4a0e-b4f9-a7a569f146b6'`);

    await client.query('COMMIT;');
    console.log(`\n🎉 SUCCESS: Import completed successfully!\n`);
  } catch (err) {
    await client.query('ROLLBACK;');
    console.error('❌ Import failed and rolled back:', err);
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  importProvidedServices()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
