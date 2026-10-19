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
import { PrismaClient, Prisma } from '@prisma/client';
import { requestContext } from './context';
import { initActivityLogger } from './helpers/activityLogger';

// Enable BigInt serialization in JSON.stringify
if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
const adapter = new PrismaPg(pool);

export const basePrisma = new PrismaClient({ adapter });
initActivityLogger(basePrisma);

export interface AuditTransactionOptions {
  source?: string;
  reason?: string;
  userId?: string;
  userName?: string;
}

export async function auditedTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: AuditTransactionOptions
): Promise<T> {
  const ctx = requestContext.getStore();
  const userId = options?.userId ?? ctx?.userId ?? null;
  const userName = options?.userName ?? ctx?.userName ?? null;
  const sessionId = ctx?.sessionId ?? null;
  const requestId = ctx?.requestId ?? null;
  const method = ctx?.method ?? null;
  const route = ctx?.route ?? null;
  const source = options?.source ?? ctx?.source ?? (userId ? 'api' : 'system');
  const reason = options?.reason ?? ctx?.reason ?? null;

  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT
        set_config('audit.user_id', COALESCE(${userId}, ''), true),
        set_config('audit.user_name', COALESCE(${userName}, ''), true),
        set_config('audit.session_id', COALESCE(${sessionId}, ''), true),
        set_config('audit.request_id', COALESCE(${requestId}, ''), true),
        set_config('audit.method', COALESCE(${method}, ''), true),
        set_config('audit.route', COALESCE(${route}, ''), true),
        set_config('audit.source', COALESCE(${source}, ''), true),
        set_config('audit.reason', COALESCE(${reason}, ''), true)
    `;

    return callback(tx);
  });
}

const MUTATION_OPERATIONS = new Set([
  'create',
  'update',
  'delete',
  'upsert',
  'createMany',
  'updateMany',
  'deleteMany',
]);

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = requestContext.getStore();

        // If not a mutation operation or no context available, run query as-is
        if (!MUTATION_OPERATIONS.has(operation) || !ctx) {
          return query(args);
        }

        // Automatic context propagation for single mutations
        return auditedTransaction(async (tx) => {
          const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
          const delegate = (tx as any)[delegateName] || (tx as any)[model];
          return delegate[operation](args);
        });
      },
    },
  },
}) as unknown as PrismaClient;

