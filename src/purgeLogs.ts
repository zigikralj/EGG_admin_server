import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envFile = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env';
if (fs.existsSync(path.resolve(process.cwd(), envFile))) {
  dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
} else {
  dotenv.config({ override: true });
}

import { basePrisma } from './db';
import { purgeOldActivityLogs, getRetentionDays } from './helpers/activityLogger';
import { purgeOldEntityVersions } from './helpers/deltaSync';

async function main() {
  console.log(`🧹 Starting Activity Log & EntityVersion Purge (retention: ${getRetentionDays()} days)...`);
  const startTime = Date.now();

  try {
    const result = await purgeOldActivityLogs();
    const versionsDeleted = await purgeOldEntityVersions(getRetentionDays());

    const elapsedMs = Date.now() - startTime;
    console.log(`\n✅ Retention Purge Completed in ${(elapsedMs / 1000).toFixed(2)}s:`);
    console.log(`   - Short-lifecycle sessions purged: ${result.shortSessionsPurged}`);
    console.log(`   - Monthly stats records updated/created: ${result.monthlyStatsRollups}`);
    console.log(`   - Raw activity logs removed: ${result.rawLogsDeleted}`);
    console.log(`   - Entity versions removed: ${versionsDeleted}`);
  } catch (error) {
    console.error('❌ Retention Purge failed:', error);
    process.exitCode = 1;
  } finally {
    await basePrisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('purgeLogs.ts') || process.argv[1]?.endsWith('purgeLogs.js')) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => {
      process.exit(process.exitCode || 0);
    });
}
