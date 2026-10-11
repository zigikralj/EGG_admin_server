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
import { requestContext } from './context';
import { initActivityLogger, enqueueActivityLog, isActivityLoggingEnabled } from './helpers/activityLogger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
const adapter = new PrismaPg(pool);

const basePrisma = new PrismaClient({ adapter });
initActivityLogger(basePrisma);

// --- Audit logging configuration ---
/** Models never audited: the log itself and high-frequency / low-value side-effect records. */
const AUDIT_SKIP_MODELS = new Set(['ActivityLog', 'UserPreference', 'Notification', 'SystemSetting']);
const AUDIT_OPERATIONS = new Set(['create', 'update', 'delete']);
/** Fields that must never be written to the activity log. */
const SENSITIVE_FIELD_RE = /password|token|secret/i;
/** Bookkeeping fields that add noise to snapshots. */
const NOISE_FIELDS = new Set(['createdAt', 'updatedAt']);
const MAX_STRING_LENGTH = 200;

/** Whether a value in `args.data` is a plain scalar assignment (not a nested relation op). */
const isScalarAssignment = (v: unknown) =>
  v !== undefined && (v === null || typeof v !== 'object' || v instanceof Date);

const compactValue = (v: unknown): unknown => {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const text = /<[a-z][\s\S]*>/i.test(v) ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : v;
    return text.length > MAX_STRING_LENGTH ? text.slice(0, MAX_STRING_LENGTH) + '…' : text;
  }
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > MAX_STRING_LENGTH ? json.slice(0, MAX_STRING_LENGTH) + '…' : v;
  }
  return v;
};

/** Compact snapshot of a record: scalar fields only, secrets redacted, long text truncated. */
const compactSnapshot = (record: any): Record<string, unknown> | null => {
  if (!record || typeof record !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (NOISE_FIELDS.has(key) || val === null || val === undefined || val === '') continue;
    if (SENSITIVE_FIELD_RE.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') continue; // included relations
    out[key] = compactValue(val);
  }
  return out;
};

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = requestContext.getStore();

        if (!isActivityLoggingEnabled() || !ctx?.userId || AUDIT_SKIP_MODELS.has(model) || !AUDIT_OPERATIONS.has(operation)) {
          return query(args);
        }

        const data = (args as any).data as Record<string, unknown> | undefined;
        const where = (args as any).where;
        const changedKeys =
          operation === 'update' && data ? Object.keys(data).filter((k) => isScalarAssignment(data[k])) : [];

        // Before-state: for updates only the fields being changed; for deletes the full row.
        let before: any = null;
        if (where && (operation === 'delete' || (operation === 'update' && changedKeys.length > 0))) {
          try {
            const select =
              operation === 'update' ? Object.fromEntries(changedKeys.map((k) => [k, true])) : undefined;
            before = await (basePrisma as any)[model].findUnique({ where, ...(select ? { select } : {}) });
          } catch {
            // Ignore fetch errors — audit is best-effort
          }
        }

        const result = await query(args);

        try {
          let diff: Record<string, unknown> | null = null;
          if (operation === 'create') {
            diff = compactSnapshot(result);
          } else if (operation === 'update') {
            diff = {};
            for (const key of changedKeys) {
              const oldVal = before?.[key];
              const newVal = (result as any)?.[key];
              if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
              diff[key] = SENSITIVE_FIELD_RE.test(key)
                ? { old: '[redacted]', new: '[redacted]' }
                : { old: compactValue(oldVal), new: compactValue(newVal) };
            }
            // Nothing changed: skip the row, unless relations were touched (e.g. invoice items replaced).
            if (Object.keys(diff).length === 0) {
              const relationKeys = data
                ? Object.keys(data).filter((k) => data[k] !== undefined && !isScalarAssignment(data[k]))
                : [];
              if (relationKeys.length === 0) return result;
              diff = { relations: relationKeys.join(', ') };
            }
          } else if (operation === 'delete') {
            diff = compactSnapshot(before);
          }

          // Non-blocking: persisted in background batches by activityLogger.
          enqueueActivityLog({
            userId: ctx.userId,
            userName: ctx.userName || 'Unknown',
            type: operation.toUpperCase(),
            path: `/api/${model.toLowerCase()}s`,
            details: JSON.stringify({ model, action: operation, diff }),
            sessionId: ctx.sessionId || null,
          });
        } catch (e) {
          console.error('Failed to log activity via Prisma extension', e);
        }

        return result;
      }
    }
  }
}) as unknown as PrismaClient;
