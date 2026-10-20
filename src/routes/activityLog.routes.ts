import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { prisma } from "../db";
import { UserRole } from "../types";
import {
  enqueueActivityLog,
  flushActivityLogs,
  purgeShortLifecycleSessions,
  getRetentionDays,
  isActivityLoggingEnabled,
  setActivityLoggingEnabled,
  setRetentionDays,
  SETTING_KEY_ACTIVITY_LOGS,
  SETTING_KEY_ACTIVITY_RETENTION,
  type ActivityLogEntry,
} from "../helpers/activityLogger";
import { getAnalyticsCache, setAnalyticsCache, clearAnalyticsCache } from "../helpers/analyticsCache";
import { getActivityAnalytics } from "../services/activityAnalytics.service";
import { getCanonicalPagePath } from "../helpers/pathUtils";

const router = Router();
router.use(requireAuth);

const CLIENT_EVENT_TYPES = new Set(["PAGE_VIEW", "LOGIN", "LOGOUT", "ONLINE", "OFFLINE"]);
const MAX_BATCH_SIZE = 100;
const MAX_PATH_LENGTH = 300;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

/** Columns returned by the list endpoint when details are excluded (default). */
const LIST_SELECT = {
  id: true,
  userId: true,
  userName: true,
  type: true,
  path: true,
  durationSeconds: true,
  sessionId: true,
  timestamp: true,
} as const;

function isUserAdmin(authUser: any): boolean {
  if (!authUser) return false;
  return authUser.role === UserRole.ADMINISTRATOR || Boolean(authUser.roleEntity?.isSystemAdmin);
}

// GET /api/activity-logs/status — check whether logging is active and retention period
router.get("/status", asyncHandler(async (_req, res) => {
  res.json({
    enabled: isActivityLoggingEnabled(),
    retentionDays: getRetentionDays(),
  });
}));

// PATCH /api/activity-logs/status — update settings (Administrator only)
router.patch("/status", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Only Administrators can modify activity log settings." });
    return;
  }

  const { enabled, retentionDays } = req.body;

  if (enabled === undefined && retentionDays === undefined) {
    res.status(400).json({ error: "At least one of 'enabled' or 'retentionDays' must be provided." });
    return;
  }

  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Invalid 'enabled' value. Must be a boolean." });
      return;
    }

    setActivityLoggingEnabled(enabled);

    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY_ACTIVITY_LOGS },
      update: { value: String(enabled) },
      create: { key: SETTING_KEY_ACTIVITY_LOGS, value: String(enabled) },
    });
  }

  if (retentionDays !== undefined) {
    const parsedDays = parseInt(String(retentionDays), 10);
    if (!Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 3650) {
      res.status(400).json({ error: "Invalid 'retentionDays' value. Must be an integer between 1 and 3650." });
      return;
    }

    setRetentionDays(parsedDays);

    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY_ACTIVITY_RETENTION },
      update: { value: String(parsedDays) },
      create: { key: SETTING_KEY_ACTIVITY_RETENTION, value: String(parsedDays) },
    });
  }

  res.json({
    enabled: isActivityLoggingEnabled(),
    retentionDays: getRetentionDays(),
  });
}));

// GET /api/activity-logs — Administrator only
// Query: userId, sessionId, from (ISO date), before (ISO date), beforeId (UUID), limit (default 50, ≤250), includeDetails ('true' to include the details column)
router.get("/", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  // Make sure freshly buffered entries are visible to the viewer
  await flushActivityLogs();

  const { userId, sessionId, limit, from, before, beforeId, includeDetails } = req.query;
  const where: any = {};
  if (userId && typeof userId === "string") {
    where.userId = userId;
  }
  if (sessionId && typeof sessionId === "string") {
    where.sessionId = sessionId;
  }
  if (from && typeof from === "string") {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      where.timestamp = { ...(where.timestamp ?? {}), gte: fromDate };
    }
  }
  if (typeof before === "string") {
    const beforeDate = new Date(before);
    if (!isNaN(beforeDate.getTime())) {
      const cursorCond = typeof beforeId === "string"
        ? { OR: [{ timestamp: { lt: beforeDate } }, { timestamp: beforeDate, id: { lt: beforeId } }] }
        : { timestamp: { lt: beforeDate } };
      where.AND = [...(where.AND ?? []), cursorCond];
    }
  }

  const parsed = parseInt(String(limit ?? ''), 10);
  const take = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 250) : 50;
  const withDetails = includeDetails === "true";

  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take,
    ...(withDetails ? {} : { select: LIST_SELECT }),
  });
  res.json(logs);
}));

// GET /api/activity-logs/analytics — Activity analytics (Administrator only)
router.get("/analytics", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity analytics are restricted to Administrators." });
    return;
  }

  // Ensure buffered in-memory logs are persisted before analytics computation
  await flushActivityLogs();

  const query = req.query;

  // 1. Timezone validation
  let tz = typeof query.tz === "string" ? query.tz.trim() : "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  // 2. Date range validation
  const now = new Date();
  let toDate = query.to ? new Date(query.to as string) : now;
  if (isNaN(toDate.getTime())) toDate = now;

  let fromDate = query.from ? new Date(query.from as string) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (isNaN(fromDate.getTime())) fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (fromDate >= toDate) {
    res.status(400).json({ error: "INVALID_RANGE", message: "'from' date must be before 'to' date." });
    return;
  }

  // Hard-cap the range to retention period
  const retentionDays = getRetentionDays();
  const maxRangeMs = retentionDays * 24 * 60 * 60 * 1000;
  if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
    fromDate = new Date(toDate.getTime() - maxRangeMs);
  }

  // 3. Granularity validation / auto-calculation
  const allowedGranularities = new Set(["day", "week", "month"]);
  let granularity = typeof query.granularity === "string" ? query.granularity.toLowerCase() : "";
  if (!allowedGranularities.has(granularity)) {
    const rangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    granularity = rangeDays <= 45 ? "day" : rangeDays <= 180 ? "week" : "month";
  }

  // 4. Optional filters
  const userIds = query.userIds && typeof query.userIds === "string"
    ? query.userIds.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const roles = query.roles && typeof query.roles === "string"
    ? query.roles.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const excludeAdminPages = query.excludeAdminPages !== "false";
  const compare = query.compare !== "false";

  // Cache lookup
  const cacheKey = JSON.stringify({
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    granularity,
    tz,
    userIds: userIds?.sort(),
    roles: roles?.sort(),
    excludeAdminPages,
    compare,
  });

  const cached = getAnalyticsCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const result = await getActivityAnalytics(prisma, {
    from: fromDate,
    to: toDate,
    granularity: granularity as "day" | "week" | "month",
    tz,
    userIds,
    roles,
    excludeAdminPages,
    compare,
  });

  setAnalyticsCache(cacheKey, result);
  res.json(result);
}));

// GET /api/activity-logs/summary — Administrator only
// Query: from (ISO date)
router.get("/summary", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  await flushActivityLogs();

  const fromParam = req.query.from as string;
  const fromDate = fromParam ? new Date(fromParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const validFrom = isNaN(fromDate.getTime()) ? new Date(Date.now() - 24 * 60 * 60 * 1000) : fromDate;

  const cacheKey = `summary:${validFrom.toISOString()}`;
  const cached = getAnalyticsCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  interface UserClusterRow {
    userId: string;
    userName: string | null;
    totalSessionsCount: number;
    totalDurationSeconds: number;
    totalActivitiesCount: number;
    lastActive: Date | string | null;
    lastType: string | null;
  }

  const userStats = await prisma.$queryRaw<UserClusterRow[]>`
    WITH ordered AS (
      SELECT "userId", "userName", "type", "durationSeconds", "timestamp",
             LAG("timestamp") OVER w AS prev_ts,
             LAG("type")      OVER w AS prev_type
      FROM "ActivityLog"
      WHERE "timestamp" >= ${validFrom}
      WINDOW w AS (PARTITION BY "userId" ORDER BY "timestamp")
    ), flagged AS (
      SELECT *,
        CASE WHEN prev_ts IS NULL
               OR prev_type = 'LOGOUT'
               OR "timestamp" - prev_ts > INTERVAL '30 minutes'
               OR ("type" = 'LOGIN' AND "timestamp" - prev_ts > INTERVAL '5 minutes')
             THEN 1 ELSE 0 END AS is_new_session
      FROM ordered
    )
    SELECT "userId",
           MAX("userName")                                                    AS "userName",
           SUM(is_new_session)::int                                           AS "totalSessionsCount",
           COALESCE(SUM("durationSeconds"), 0)::int                           AS "totalDurationSeconds",
           COUNT(*) FILTER (WHERE "type" NOT IN ('LOGIN','LOGOUT','ONLINE','OFFLINE'))::int AS "totalActivitiesCount",
           MAX("timestamp")                                                   AS "lastActive",
           (ARRAY_AGG("type" ORDER BY "timestamp" DESC))[1]                   AS "lastType"
    FROM flagged
    GROUP BY "userId"
    ORDER BY "totalDurationSeconds" DESC;
  `;

  interface ModuleBreakdownRow {
    userId: string;
    path: string;
    seconds: number;
  }

  const moduleBreakdown = await prisma.$queryRaw<ModuleBreakdownRow[]>`
    SELECT "userId", "path", COALESCE(SUM("durationSeconds"), 0)::int AS seconds
    FROM "ActivityLog"
    WHERE "timestamp" >= ${validFrom} AND "path" IS NOT NULL
      AND "type" NOT IN ('LOGIN','LOGOUT','ONLINE','OFFLINE')
    GROUP BY "userId", "path";
  `;

  const globalModuleMap = new Map<string, number>();
  const userModuleMap = new Map<string, Map<string, number>>();

  for (const row of moduleBreakdown) {
    const canonical = getCanonicalPagePath(row.path);
    const s = Number(row.seconds) || 0;
    globalModuleMap.set(canonical, (globalModuleMap.get(canonical) || 0) + s);

    let uMap = userModuleMap.get(row.userId);
    if (!uMap) {
      uMap = new Map<string, number>();
      userModuleMap.set(row.userId, uMap);
    }
    uMap.set(canonical, (uMap.get(canonical) || 0) + s);
  }

  const now = Date.now();
  const todayDateStr = new Date().toDateString();

  const userSummaries = userStats.map((u) => {
    const uMap = userModuleMap.get(u.userId);
    const topModules: Array<{ path: string; seconds: number; percentage: number }> = [];
    const totalUserDuration = Number(u.totalDurationSeconds) || 0;

    if (uMap) {
      const sorted = Array.from(uMap.entries()).sort((a, b) => b[1] - a[1]);
      for (const [p, sec] of sorted.slice(0, 3)) {
        const pct = totalUserDuration > 0 ? Math.round((sec / totalUserDuration) * 100) : 0;
        topModules.push({ path: p, seconds: sec, percentage: pct });
      }
    }

    const lastActiveDate = u.lastActive ? new Date(u.lastActive) : null;
    const isRecent = lastActiveDate ? now - lastActiveDate.getTime() <= 10 * 60 * 1000 : false;
    const hasActiveSession = Boolean(
      isRecent && u.lastType && u.lastType !== "OFFLINE" && u.lastType !== "LOGOUT"
    );

    return {
      userId: u.userId,
      userName: u.userName || "Unknown",
      totalDurationSeconds: totalUserDuration,
      totalSessionsCount: Number(u.totalSessionsCount) || 0,
      totalActivitiesCount: Number(u.totalActivitiesCount) || 0,
      lastActive: lastActiveDate ? lastActiveDate.toISOString() : new Date().toISOString(),
      hasActiveSession,
      topModules,
    };
  });

  const totalUsers = userSummaries.length;
  const activeToday = userStats.filter((u) => {
    return u.lastActive && new Date(u.lastActive).toDateString() === todayDateStr;
  }).length;
  const totalSessions = userSummaries.reduce((sum, u) => sum + u.totalSessionsCount, 0);
  const totalTrackedSeconds = userSummaries.reduce((sum, u) => sum + u.totalDurationSeconds, 0);

  let topModule: string | null = null;
  let topModuleSeconds = 0;
  for (const [p, sec] of globalModuleMap.entries()) {
    if (sec > topModuleSeconds) {
      topModuleSeconds = sec;
      topModule = p;
    }
  }

  const topModulePercent =
    totalTrackedSeconds > 0 ? Math.round((topModuleSeconds / totalTrackedSeconds) * 100) : 0;

  const result = {
    kpiStats: {
      totalUsers,
      activeToday,
      totalSessions,
      totalTrackedSeconds,
      topModule,
      topModulePercent,
    },
    userSummaries,
  };

  setAnalyticsCache(cacheKey, result, 30_000);
  res.json(result);
}));

// GET /api/activity-logs/monthly-stats — Administrator only
// Query: userId?, fromYearMonth?, toYearMonth?
router.get("/monthly-stats", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  const { userId, fromYearMonth, toYearMonth } = req.query;

  const where: any = {};
  if (userId && typeof userId === "string") {
    where.userId = userId;
  }
  if (fromYearMonth && typeof fromYearMonth === "string") {
    where.yearMonth = { ...(where.yearMonth || {}), gte: fromYearMonth };
  }
  if (toYearMonth && typeof toYearMonth === "string") {
    where.yearMonth = { ...(where.yearMonth || {}), lte: toYearMonth };
  }

  const stats = await prisma.activityLogMonthlyStats.findMany({
    where,
    orderBy: [{ yearMonth: "desc" }, { totalDurationSeconds: "desc" }],
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const formatted = stats.map((s) => ({
    id: s.id,
    userId: s.userId,
    userName: s.user?.name || s.user?.email || "Unknown",
    yearMonth: s.yearMonth,
    totalDurationSeconds: s.totalDurationSeconds,
    sessionCount: s.sessionCount,
    actionCount: s.actionCount,
    moduleBreakdown: s.moduleBreakdown,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  res.json(formatted);
}));

// GET /api/activity-logs/:id — single log including details (Administrator only)
router.get("/:id", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  const log = await prisma.activityLog.findUnique({ where: { id: req.params.id as string } });
  if (!log) {
    res.status(404).json({ error: "Activity log not found." });
    return;
  }
  res.json(log);
}));

// POST /api/activity-logs
// Accepts a single event or an array of events (batched by the client tracker).
// Identity is taken from the authenticated user; the write is buffered and does not block the response.
router.post("/", asyncHandler(async (req, res) => {
  if (!isActivityLoggingEnabled()) {
    res.status(202).json({ accepted: 0 });
    return;
  }

  const user = req.authUser!;
  const rawEvents: any[] = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.events) ? req.body.events : [req.body];

  const entries: ActivityLogEntry[] = [];
  for (const ev of rawEvents.slice(0, MAX_BATCH_SIZE)) {
    if (!ev || typeof ev !== "object") continue;
    const type = typeof ev.type === "string" ? ev.type.toUpperCase() : "";
    if (!CLIENT_EVENT_TYPES.has(type)) continue;

    const ts = ev.timestamp ? new Date(ev.timestamp) : new Date();
    const duration = Math.max(0, Math.min(parseInt(ev.durationSeconds, 10) || 0, MAX_DURATION_SECONDS));

    entries.push({
      userId: user.id,
      userName: user.name,
      type,
      path: typeof ev.path === "string" ? ev.path.slice(0, MAX_PATH_LENGTH) : null,
      durationSeconds: duration,
      sessionId: typeof ev.sessionId === "string" ? ev.sessionId.slice(0, 100) : null,
      timestamp: isNaN(ts.getTime()) ? new Date() : ts,
    });
  }

  if (entries.length > 0) enqueueActivityLog(entries);
  res.status(202).json({ accepted: entries.length });
}));

// DELETE /api/activity-logs/clear-all — Administrator only
router.delete("/clear-all", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  await flushActivityLogs();
  const result = await prisma.activityLog.deleteMany({});
  clearAnalyticsCache();
  res.json({ message: "All activity logs deleted.", count: result.count });
}));

// POST /api/activity-logs/bulk-delete — Administrator only
router.post("/bulk-delete", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "No ids provided for deletion." });
    return;
  }

  const result = await prisma.activityLog.deleteMany({
    where: {
      id: { in: ids }
    }
  });

  clearAnalyticsCache();
  res.json({ message: "Activity logs deleted.", count: result.count });
}));

// DELETE /api/activity-logs/session/:sessionId — Administrator only
router.delete("/session/:sessionId", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  const sessionId = req.params.sessionId as string;
  await flushActivityLogs();
  const result = await prisma.activityLog.deleteMany({
    where: { sessionId },
  });
  clearAnalyticsCache();
  res.json({ message: "Activity logs for session deleted.", count: result.count });
}));

// DELETE /api/activity-logs/:id — Administrator only
router.delete("/:id", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  const id = req.params.id as string;
  await prisma.activityLog.delete({
    where: { id },
  });
  clearAnalyticsCache();
  res.json({ message: "Activity log deleted." });
}));

export default router;
