import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envFile = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env';
if (fs.existsSync(path.resolve(process.cwd(), envFile))) {
  dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
} else {
  dotenv.config({ override: true });
}

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
