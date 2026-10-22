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
import { initActivityLogger, enqueueActivityLog, isActivityLoggingEnabled } from './helpers/activityLogger';
import { PRISMA_MODEL_TO_API_ROUTE } from './constants/apiRoutes';
import { stripHtmlToText } from './helpers/htmlUtils';

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

/** Models never audited: the log itself and high-frequency / low-value side-effect records. */
const AUDIT_SKIP_MODELS = new Set(['ActivityLog', 'UserPreference', 'Notification', 'SystemSetting', 'ChangeSet', 'EntityVersion', 'ProjectNote', 'ProjectNoteVersion']);
const AUDIT_OPERATIONS = new Set(['create', 'update', 'delete']);
/** Fields that must never be written to the activity log. */
const SENSITIVE_FIELD_RE = /password|token|secret/i;
/** Bookkeeping and relational fields that are not meaningful to log as diffs. */
const NOISE_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);
const MAX_STRING_LENGTH = 120;

const isScalarAssignment = (val: unknown): boolean =>
  val === null ||
  typeof val === 'string' ||
  typeof val === 'number' ||
  typeof val === 'boolean' ||
  val instanceof Date;

export const cleanText = (v: string): string => {
  if (!v) return '';
  return /<[a-z!]/i.test(v)
    ? stripHtmlToText(v).replace(/\s+/g, ' ').trim()
    : v.trim();
};

export const compactValue = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const text = cleanText(v);
    return text.length > MAX_STRING_LENGTH ? text.slice(0, MAX_STRING_LENGTH) + '…' : text;
  }
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > MAX_STRING_LENGTH ? json.slice(0, MAX_STRING_LENGTH) + '…' : v;
  }
  return v;
};

export const compactDiffPair = (
  oldVal: unknown,
  newVal: unknown
): { old: unknown; new: unknown } => {
  if (typeof oldVal !== 'string' || typeof newVal !== 'string') {
    return { old: compactValue(oldVal), new: compactValue(newVal) };
  }

  const oldText = cleanText(oldVal);
  const newText = cleanText(newVal);

  if (oldText === newText) {
    const preview = compactValue(oldText) || '(empty)';
    return { old: preview, new: `${preview} (formatting)` };
  }

  let diffStart = 0;
  while (
    diffStart < oldText.length &&
    diffStart < newText.length &&
    oldText[diffStart] === newText[diffStart]
  ) {
    diffStart++;
  }

  if (diffStart <= 40) {
    const oldPrefix = oldText.length > MAX_STRING_LENGTH ? oldText.slice(0, MAX_STRING_LENGTH) + '…' : oldText;
    const newPrefix = newText.length > MAX_STRING_LENGTH ? newText.slice(0, MAX_STRING_LENGTH) + '…' : newText;
    if (oldPrefix !== newPrefix) {
      return { old: oldPrefix, new: newPrefix };
    }
  }

  const contextBefore = 30;
  const contextAfter = 70;
  const startIdx = Math.max(0, diffStart - contextBefore);
  const oldEndIdx = Math.min(oldText.length, diffStart + contextAfter);
  const newEndIdx = Math.min(newText.length, diffStart + contextAfter);

  const prefix = startIdx > 0 ? '…' : '';
  const oldSuffix = oldEndIdx < oldText.length ? '…' : '';
  const newSuffix = newEndIdx < newText.length ? '…' : '';

  const oldSnippet = prefix + oldText.slice(startIdx, oldEndIdx) + oldSuffix;
  const newSnippet = prefix + newText.slice(startIdx, newEndIdx) + newSuffix;

  if (oldSnippet === newSnippet) {
    return { old: oldSnippet, new: `${newSnippet} (modified)` };
  }

  return { old: oldSnippet, new: newSnippet };
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

        // If not a mutation operation or no context available, run query as-is
        if (!MUTATION_OPERATIONS.has(operation) || !ctx) {
          return query(args);
        }

        const data = (args as any)?.data as Record<string, unknown> | undefined;
        const where = (args as any)?.where;
        const changedKeys =
          operation === 'update' && data ? Object.keys(data).filter((k) => isScalarAssignment(data[k])) : [];

        const delegateName = model.charAt(0).toLowerCase() + model.slice(1);
        const delegate = (basePrisma as any)[delegateName] || (basePrisma as any)[model];

        // Before-state: for updates only the fields being changed; for deletes the full row.
        let before: any = null;
        if (where && delegate && (operation === 'delete' || (operation === 'update' && changedKeys.length > 0))) {
          try {
            const select =
              operation === 'update' ? Object.fromEntries(changedKeys.map((k) => [k, true])) : undefined;
            before = await delegate.findUnique({ where, ...(select ? { select } : {}) });
          } catch {
            // Ignore fetch errors — audit is best-effort
          }
        }

        // Automatic context propagation for mutations through PostgreSQL transaction
        const result = await auditedTransaction(async (tx) => {
          const txDelegate = (tx as any)[delegateName] || (tx as any)[model];
          return txDelegate[operation](args);
        });

        // Record to ActivityLog for user audit timeline and session activity
        if (isActivityLoggingEnabled() && ctx?.userId && !AUDIT_SKIP_MODELS.has(model) && AUDIT_OPERATIONS.has(operation)) {
          try {
            let diff: Record<string, unknown> | null = null;
            if (operation === 'create') {
              diff = compactSnapshot(result);
            } else if (operation === 'update') {
              diff = {};
              for (const key of changedKeys) {
                const oldVal = before?.[key];
                const newVal = (result as any)?.[key];

                const normOld = oldVal instanceof Date ? oldVal.toISOString() : (oldVal ?? null);
                const normNew = newVal instanceof Date ? newVal.toISOString() : (newVal ?? null);

                if (JSON.stringify(normOld) === JSON.stringify(normNew)) continue;

                const logKey = model === 'Project' && key === 'notesPreview' ? 'notes' : key;
                diff[logKey] = SENSITIVE_FIELD_RE.test(key)
                  ? { old: '[redacted]', new: '[redacted]' }
                  : compactDiffPair(oldVal, newVal);
              }

              if (Object.keys(diff).length === 0) {
                const relationKeys = data
                  ? Object.keys(data).filter((k) => data[k] !== undefined && !isScalarAssignment(data[k]))
                  : [];
                if (relationKeys.length > 0) {
                  diff = { relations: relationKeys.join(', ') };
                }
              }
            } else if (operation === 'delete') {
              diff = compactSnapshot(before);
            }

            if (diff && Object.keys(diff).length > 0) {
              const apiPath = PRISMA_MODEL_TO_API_ROUTE[model] || `/api/${model.toLowerCase()}s`;

              enqueueActivityLog({
                userId: ctx.userId,
                userName: ctx.userName || 'Unknown',
                type: operation.toUpperCase(),
                path: apiPath,
                details: JSON.stringify({ model, action: operation, diff }),
                sessionId: ctx.sessionId || null,
              });
            }
          } catch (e) {
            console.error('Failed to log activity via Prisma extension', e);
          }
        }

        return result;
      },
    },
  },
}) as unknown as PrismaClient;


