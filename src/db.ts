import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envFile = process.env.DOTENV_CONFIG_PATH || process.env.ENV_FILE || '.env';
if (fs.existsSync(path.resolve(process.cwd(), envFile))) {
  dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
} else {
  dotenv.config({ override: true });
}

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();


