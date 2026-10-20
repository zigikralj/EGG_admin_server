/**
 * Buffered, non-blocking activity log writer.
 *
 * - `enqueueActivityLog()` returns immediately; entries are persisted in batches
 *   with a single `createMany` (every FLUSH_INTERVAL_MS or once BATCH_SIZE entries are queued).
 * - Failures are logged and never propagate to the user request.
 * - The queue is capped (MAX_QUEUE_SIZE) so memory can't grow unbounded if the DB is down.
 * - A daily retention job removes logs older than retentionDays (default 90, configured via SystemSetting).
 *
 * The Prisma client is injected via `initActivityLogger()` (called from db.ts) to avoid
 * a circular import between db.ts and this module.
 */
import type { PrismaClient } from '@prisma/client';

export interface ActivityLogEntry {
  userId: string;
  userName?: string | null;
  type: string;
  path?: string | null;
  details?: string | null;
  durationSeconds?: number;
  sessionId?: string | null;
  timestamp?: Date;
}

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 50;
const MAX_QUEUE_SIZE = 5_000;
const RETENTION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_INITIAL_DELAY_MS = 60_000;

let client: PrismaClient | null = null;
let queue: ActivityLogEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;
let droppedCount = 0;
let loggingEnabled = true;
let retentionDays = 30;

export const SETTING_KEY_ACTIVITY_LOGS = 'activity_logging_enabled';
export const SETTING_KEY_ACTIVITY_RETENTION = 'activity_log_retention_days';

export function isActivityLoggingEnabled(): boolean {
  return loggingEnabled;
}

export function setActivityLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
  if (!enabled) {
    // Drop any pending queued entries if logging gets disabled
    queue = [];
  }
}

export function getRetentionDays(): number {
  return retentionDays;
}

export function setRetentionDays(days: number): void {
  if (Number.isFinite(days) && days > 0) {
    retentionDays = Math.round(days);
  }
}

export async function syncActivityLoggerSettings(): Promise<{ enabled: boolean; retentionDays: number }> {
  if (!client) return { enabled: loggingEnabled, retentionDays };
  try {
    const [statusSetting, retentionSetting] = await Promise.all([
      client.systemSetting.findUnique({
        where: { key: SETTING_KEY_ACTIVITY_LOGS },
      }),
      client.systemSetting.findUnique({
        where: { key: SETTING_KEY_ACTIVITY_RETENTION },
      }),
    ]);
    if (statusSetting) {
      loggingEnabled = statusSetting.value === 'true';
    }
    if (retentionSetting) {
      const parsed = parseInt(retentionSetting.value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        retentionDays = parsed;
      }
    }
  } catch (err) {
    // If table or DB is not ready yet, keep default
  }
  return { enabled: loggingEnabled, retentionDays };
}

export function initActivityLogger(prismaClient: PrismaClient): void {
  if (client) return;
  client = prismaClient;

  // Sync setting from DB
  void syncActivityLoggerSettings();

  // Retention: first run shortly after boot, then once per day.
  const initial = setTimeout(() => {
    void purgeOldActivityLogs();
    retentionTimer = setInterval(() => void purgeOldActivityLogs(), RETENTION_CHECK_INTERVAL_MS);
    retentionTimer.unref();
  }, RETENTION_INITIAL_DELAY_MS);
  initial.unref();
}

export function enqueueActivityLog(entry: ActivityLogEntry | ActivityLogEntry[]): void {
  if (!loggingEnabled) return;
  const entries = Array.isArray(entry) ? entry : [entry];
  for (const e of entries) {
    if (!e || !e.userId) continue;
    if (queue.length >= MAX_QUEUE_SIZE) {
      droppedCount++;
      continue;
    }
    queue.push({ ...e, timestamp: e.timestamp ?? new Date() });
  }

  if (queue.length >= BATCH_SIZE) {
    void flushActivityLogs();
  } else if (!flushTimer && queue.length > 0) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushActivityLogs();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref();
  }
}

export async function flushActivityLogs(): Promise<void> {
  if (flushing) {
    await flushing;
  }
  if (!client || queue.length === 0) return;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const batch = queue;
  queue = [];

  flushing = (async () => {
    try {
      await client!.activityLog.createMany({
        data: batch.map((e) => ({
          userId: e.userId,
          userName: e.userName ?? null,
          type: e.type || 'UNKNOWN',
          path: e.path ?? null,
          details: e.details ?? null,
          durationSeconds: e.durationSeconds ?? 0,
          sessionId: e.sessionId ?? null,
          timestamp: e.timestamp ?? new Date(),
        })),
      });
      if (droppedCount > 0) {
        console.warn(`[activityLogger] Dropped ${droppedCount} log entries due to full queue.`);
        droppedCount = 0;
      }
    } catch (err) {
      // Most likely cause is a FK violation (e.g., user deleted). Don't retry to avoid loops.
      console.error(`[activityLogger] Failed to persist ${batch.length} activity logs`, err);
    }
  })();

  try {
    await flushing;
  } finally {
    flushing = null;
  }

  // Anything queued during the flush gets scheduled normally
  if (queue.length > 0) enqueueActivityLog([]);
}

export async function purgeShortLifecycleSessions(): Promise<number> {
  if (!client) return 0;
  try {
    const result = await client.$executeRaw`
      DELETE FROM "ActivityLog"
      WHERE "sessionId" IN (
        SELECT "sessionId"
        FROM "ActivityLog"
        WHERE "sessionId" IS NOT NULL
        GROUP BY "sessionId"
        HAVING 
          BOOL_AND("type" IN ('LOGIN', 'LOGOUT')) = TRUE
          AND COALESCE(SUM("durationSeconds"), 0) < 5
          AND EXTRACT(EPOCH FROM (MAX("timestamp") - MIN("timestamp"))) < 5
      );
    `;
    if (result > 0) {
      console.log(`[activityLogger] Purged ${result} log entries from sessions < 5s with only login/logout.`);
    }
    return result;
  } catch (err) {
    console.error('[activityLogger] Failed to purge short lifecycle sessions', err);
    return 0;
  }
}

export async function purgeOldActivityLogs(): Promise<number> {
  if (!client) return 0;
  await purgeShortLifecycleSessions();
  const cutoff = new Date(Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000);
  try {
    const result = await client.$transaction(async (tx) => {
      // 1. Roll up logs older than retention cutoff into monthly stats
      await tx.$executeRaw`
        INSERT INTO "ActivityLogMonthlyStats" (id, "userId", "yearMonth", "totalDurationSeconds", "actionCount", "updatedAt")
        SELECT gen_random_uuid()::text, "userId", to_char("timestamp", 'YYYY-MM'),
               COALESCE(SUM("durationSeconds"), 0)::int,
               COUNT(*) FILTER (WHERE "type" NOT IN ('LOGIN','LOGOUT','ONLINE','OFFLINE'))::int,
               NOW()
        FROM "ActivityLog"
        WHERE "timestamp" < ${cutoff}
        GROUP BY "userId", to_char("timestamp", 'YYYY-MM')
        ON CONFLICT ("userId", "yearMonth") DO UPDATE SET
          "totalDurationSeconds" = "ActivityLogMonthlyStats"."totalDurationSeconds" + EXCLUDED."totalDurationSeconds",
          "actionCount"          = "ActivityLogMonthlyStats"."actionCount" + EXCLUDED."actionCount",
          "updatedAt"            = NOW();
      `;

      // 2. Delete raw logs older than retention cutoff
      const deleted = await tx.activityLog.deleteMany({ where: { timestamp: { lt: cutoff } } });
      return deleted.count;
    });

    if (result > 0) {
      console.log(`[activityLogger] Retention: aggregated & removed ${result} logs older than ${getRetentionDays()} days.`);
    }
    return result;
  } catch (err) {
    console.error('[activityLogger] Retention purge failed', err);
    return 0;
  }
}

export async function shutdownActivityLogger(): Promise<void> {
  if (retentionTimer) clearInterval(retentionTimer);
  await flushActivityLogs();
}
