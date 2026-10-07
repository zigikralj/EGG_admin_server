import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { prisma } from "../db";
import { UserRole } from "../types";
import {
  enqueueActivityLog,
  flushActivityLogs,
  getRetentionDays,
  isActivityLoggingEnabled,
  setActivityLoggingEnabled,
  setRetentionDays,
  SETTING_KEY_ACTIVITY_LOGS,
  SETTING_KEY_ACTIVITY_RETENTION,
  type ActivityLogEntry,
} from "../helpers/activityLogger";

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
// Query: userId, sessionId, from (ISO date), limit (≤5000), includeDetails ('true' to include the details column)
router.get("/", asyncHandler(async (req, res) => {
  if (!isUserAdmin(req.authUser)) {
    res.status(403).json({ error: "FORBIDDEN", message: "Activity logs are restricted to Administrators." });
    return;
  }

  // Make sure freshly buffered entries are visible to the viewer.
  await flushActivityLogs();

  const { userId, sessionId, limit, from, includeDetails } = req.query;
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
      where.timestamp = { gte: fromDate };
    }
  }

  const take = limit ? Math.min(parseInt(limit as string, 10) || 1000, 5000) : 1000;
  const withDetails = includeDetails === "true";

  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take,
    ...(withDetails ? {} : { select: LIST_SELECT }),
  });
  res.json(logs);
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
  res.json({ message: "Activity log deleted." });
}));

export default router;
