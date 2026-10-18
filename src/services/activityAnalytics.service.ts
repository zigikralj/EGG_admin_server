import { PrismaClient, Prisma } from '@prisma/client';

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  granularity: 'day' | 'week' | 'month';
  tz: string;
  userIds?: string[];
  roles?: string[];
  excludeAdminPages?: boolean;
  compare?: boolean;
}

export interface AnalyticsTotals {
  activeUsers: number;
  sessions: number;
  pageViews: number;
  actions: number;
  trackedSeconds: number;
  avgSessionSeconds: number;
  avgPagesPerSession: number;
}

export interface ActivityAnalytics {
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month'; tz: string };
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals | null;
  timeline: Array<{
    bucket: string;
    activeUsers: number;
    sessions: number;
    trackedSeconds: number;
    pageViews: number;
    actions: number;
  }>;
  pages: Array<{
    path: string;
    views: number;
    totalSeconds: number;
    avgSeconds: number;
    uniqueUsers: number;
    sessions: number;
  }>;
  actions: Array<{
    model: string;
    action: 'create' | 'update' | 'delete';
    count: number;
    uniqueUsers: number;
  }>;
  users: Array<{
    userId: string;
    userName: string;
    role: string | null;
    sessions: number;
    activeDays: number;
    trackedSeconds: number;
    pageViews: number;
    actions: number;
    avgSessionSeconds: number;
    lastActive: string;
    topPath: string | null;
    pageSeconds: Array<{ path: string; seconds: number }>;
    pageActions: Array<{ path: string; actions: number }>;
  }>;
  heatmap: Array<{ dow: number; hour: number; trackedSeconds: number; actions: number }>;
  sessionLengthBuckets: Array<{
    bucket: '<1m' | '1-5m' | '5-15m' | '15-30m' | '30-60m' | '60m+';
    count: number;
  }>;
  transitions: Array<{ from: string; to: string; count: number }>;
  entryPages: Array<{ path: string; count: number }>;
  exitPages: Array<{ path: string; count: number }>;
  editedFields: Array<{ model: string; field: string; count: number; uniqueUsers: number }>;
  quickDeletes: Array<{ model: string; count: number }>;
  stickiness: { dau: number; wau: number; mau: number };
  totalRegisteredActiveUsers: number;
}

/**
 * Builds the WHERE clause for SQL queries based on analytics filters.
 */
function buildWhereClause(
  from: Date,
  to: Date,
  userIds?: string[],
  roles?: string[],
  excludeAdminPages: boolean = true
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`"timestamp" >= ${from} AND "timestamp" < ${to}`,
  ];

  if (userIds && userIds.length > 0) {
    conditions.push(Prisma.sql`"userId" IN (${Prisma.join(userIds)})`);
  }

  if (roles && roles.length > 0) {
    conditions.push(
      Prisma.sql`"userId" IN (SELECT "id" FROM "User" WHERE "role"::text IN (${Prisma.join(roles)}))`
    );
  }

  if (excludeAdminPages) {
    conditions.push(
      Prisma.sql`NOT ("type" = 'PAGE_VIEW' AND ("path" LIKE '/data-management/activity-logs%' OR "path" LIKE '/api/activity-logs%'))`
    );
  }

  return Prisma.join(conditions, ' AND ');
}

export async function getActivityAnalytics(
  prisma: PrismaClient,
  filters: AnalyticsFilters
): Promise<ActivityAnalytics> {
  const { from, to, granularity, tz, userIds, roles, excludeAdminPages = true, compare = true } = filters;

  const whereSql = buildWhereClause(from, to, userIds, roles, excludeAdminPages);

  // Run independent database aggregations in parallel
  const [
    totalsRaw,
    previousTotalsRaw,
    timelineRaw,
    pagesRaw,
    actionsRaw,
    usersRaw,
    userTopPathsRaw,
    userActionPathsRaw,
    allUsers,
    heatmapRaw,
    sessionBucketsRaw,
    transitionsRaw,
    entryPagesRaw,
    exitPagesRaw,
    editedFieldsRaw,
    quickDeletesRaw,
    dauRaw,
    wauRaw,
    mauRaw,
  ] = await Promise.all([
    // 1. Totals
    prisma.$queryRaw<Array<{
      activeUsers: number;
      sessions: number;
      pageViews: number;
      actions: number;
      trackedSeconds: number;
    }>>`
      SELECT
        COUNT(DISTINCT "userId")::int                                        AS "activeUsers",
        COUNT(DISTINCT "sessionId")::int                                     AS "sessions",
        COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::int                    AS "pageViews",
        COUNT(*) FILTER (WHERE "type" IN ('CREATE','UPDATE','DELETE'))::int  AS "actions",
        COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS "trackedSeconds"
      FROM "ActivityLog"
      WHERE ${whereSql}
    `,

    // 2. Previous Totals (for comparison deltas)
    compare
      ? (() => {
          const durationMs = to.getTime() - from.getTime();
          const prevFrom = new Date(from.getTime() - durationMs);
          const prevTo = from;
          const prevWhere = buildWhereClause(prevFrom, prevTo, userIds, roles, excludeAdminPages);
          return prisma.$queryRaw<Array<{
            activeUsers: number;
            sessions: number;
            pageViews: number;
            actions: number;
            trackedSeconds: number;
          }>>`
            SELECT
              COUNT(DISTINCT "userId")::int                                        AS "activeUsers",
              COUNT(DISTINCT "sessionId")::int                                     AS "sessions",
              COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::int                    AS "pageViews",
              COUNT(*) FILTER (WHERE "type" IN ('CREATE','UPDATE','DELETE'))::int  AS "actions",
              COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS "trackedSeconds"
            FROM "ActivityLog"
            WHERE ${prevWhere}
          `;
        })()
      : Promise.resolve([]),

    // 3. Timeline
    prisma.$queryRaw<Array<{
      bucket: Date | string;
      activeUsers: number;
      sessions: number;
      trackedSeconds: number;
      pageViews: number;
      actions: number;
    }>>`
      SELECT date_trunc(${granularity}, ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})) AS bucket,
             COUNT(DISTINCT "userId")::int AS "activeUsers",
             COUNT(DISTINCT "sessionId")::int AS "sessions",
             COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS "trackedSeconds",
             COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::int AS "pageViews",
             COUNT(*) FILTER (WHERE "type" IN ('CREATE','UPDATE','DELETE'))::int AS "actions"
      FROM "ActivityLog"
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 1
    `,

    // 4. Pages
    prisma.$queryRaw<Array<{
      path: string;
      views: number;
      totalSeconds: number;
      uniqueUsers: number;
      sessions: number;
    }>>`
      SELECT "path",
             COUNT(*)::int AS views,
             COALESCE(SUM("durationSeconds"), 0)::int AS "totalSeconds",
             COUNT(DISTINCT "userId")::int AS "uniqueUsers",
             COUNT(DISTINCT "sessionId")::int AS sessions
      FROM "ActivityLog"
      WHERE ${whereSql} AND "type" = 'PAGE_VIEW' AND "path" IS NOT NULL AND "path" <> ''
      GROUP BY "path"
      ORDER BY "totalSeconds" DESC, views DESC
    `,

    // 5. Actions per entity
    prisma.$queryRaw<Array<{
      model: string;
      action: 'create' | 'update' | 'delete';
      count: number;
      uniqueUsers: number;
    }>>`
      SELECT (("details"::jsonb) ->> 'model') AS model,
             LOWER("type") AS action,
             COUNT(*)::int AS count,
             COUNT(DISTINCT "userId")::int AS "uniqueUsers"
      FROM "ActivityLog"
      WHERE ${whereSql} AND "type" IN ('CREATE','UPDATE','DELETE') AND "details" IS NOT NULL AND "details" LIKE '{%'
      GROUP BY 1, 2
      ORDER BY count DESC
    `,

    // 6. Users aggregated
    prisma.$queryRaw<Array<{
      userId: string;
      sessions: number;
      activeDays: number;
      trackedSeconds: number;
      pageViews: number;
      actions: number;
      lastActive: Date | string;
    }>>`
      SELECT "userId",
             COUNT(DISTINCT "sessionId")::int AS sessions,
             COUNT(DISTINCT date_trunc('day', ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})))::int AS "activeDays",
             COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS "trackedSeconds",
             COUNT(*) FILTER (WHERE "type" = 'PAGE_VIEW')::int AS "pageViews",
             COUNT(*) FILTER (WHERE "type" IN ('CREATE','UPDATE','DELETE'))::int AS actions,
             MAX("timestamp") AS "lastActive"
      FROM "ActivityLog"
      WHERE ${whereSql}
      GROUP BY "userId"
      ORDER BY "trackedSeconds" DESC
    `,

    // 7. Top 6 paths per user
    prisma.$queryRaw<Array<{
      userId: string;
      path: string;
      seconds: number;
    }>>`
      WITH user_paths AS (
        SELECT "userId", "path",
               COALESCE(SUM("durationSeconds"), 0)::int AS seconds,
               ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY SUM("durationSeconds") DESC, COUNT(*) DESC) AS rn
        FROM "ActivityLog"
        WHERE ${whereSql} AND "type" = 'PAGE_VIEW' AND "path" IS NOT NULL AND "path" <> ''
        GROUP BY "userId", "path"
      )
      SELECT "userId", "path", seconds
      FROM user_paths
      WHERE rn <= 6
    `,

    // 7b. Top 8 action paths per user
    prisma.$queryRaw<Array<{
      userId: string;
      path: string;
      actions: number;
    }>>`
      WITH user_action_paths AS (
        SELECT "userId", "path",
               COUNT(*)::int AS actions,
               ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY COUNT(*) DESC) AS rn
        FROM "ActivityLog"
        WHERE ${whereSql} AND "type" IN ('CREATE','UPDATE','DELETE') AND "path" IS NOT NULL AND "path" <> ''
        GROUP BY "userId", "path"
      )
      SELECT "userId", "path", actions
      FROM user_action_paths
      WHERE rn <= 8
    `,

    // 8. Registered users for names, roles, and adoption count
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
      },
    }),

    // 9. Heatmap (7x24)
    prisma.$queryRaw<Array<{
      dow: number;
      hour: number;
      trackedSeconds: number;
      actions: number;
    }>>`
      SELECT (EXTRACT(ISODOW FROM ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})) - 1)::int AS dow,
             EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour,
             COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS "trackedSeconds",
             COUNT(*) FILTER (WHERE "type" IN ('CREATE','UPDATE','DELETE'))::int AS actions
      FROM "ActivityLog"
      WHERE ${whereSql}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,

    // 10. Session Length Buckets
    prisma.$queryRaw<Array<{
      bucket: '<1m' | '1-5m' | '5-15m' | '15-30m' | '30-60m' | '60m+';
      count: number;
    }>>`
      WITH session_durations AS (
        SELECT "sessionId",
               COALESCE(SUM("durationSeconds") FILTER (WHERE "type" = 'PAGE_VIEW'), 0)::int AS total_seconds
        FROM "ActivityLog"
        WHERE ${whereSql} AND "sessionId" IS NOT NULL
        GROUP BY "sessionId"
      )
      SELECT
        CASE
          WHEN total_seconds < 60 THEN '<1m'
          WHEN total_seconds < 300 THEN '1-5m'
          WHEN total_seconds < 900 THEN '5-15m'
          WHEN total_seconds < 1800 THEN '15-30m'
          WHEN total_seconds < 3600 THEN '30-60m'
          ELSE '60m+'
        END AS bucket,
        COUNT(*)::int AS count
      FROM session_durations
      GROUP BY 1
    `,

    // 11. Navigation transitions (Top 30)
    prisma.$queryRaw<Array<{
      from: string;
      to: string;
      count: number;
    }>>`
      WITH pv AS (
        SELECT "sessionId", "path", "timestamp",
               LEAD("path") OVER (PARTITION BY "sessionId" ORDER BY "timestamp") AS next_path
        FROM "ActivityLog"
        WHERE ${whereSql} AND "type" = 'PAGE_VIEW' AND "sessionId" IS NOT NULL AND "path" IS NOT NULL AND "path" <> ''
      )
      SELECT "path" AS "from", next_path AS "to", COUNT(*)::int AS count
      FROM pv
      WHERE next_path IS NOT NULL AND next_path <> "path"
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 30
    `,

    // 12. Entry pages (Top 10)
    prisma.$queryRaw<Array<{ path: string; count: number }>>`
      WITH pv AS (
        SELECT "sessionId", "path", "timestamp",
               ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "timestamp") AS rn_asc
        FROM "ActivityLog"
        WHERE ${whereSql} AND "type" = 'PAGE_VIEW' AND "sessionId" IS NOT NULL AND "path" IS NOT NULL AND "path" <> ''
      )
      SELECT "path", COUNT(*)::int AS count
      FROM pv
      WHERE rn_asc = 1
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `,

    // 13. Exit pages (Top 10)
    prisma.$queryRaw<Array<{ path: string; count: number }>>`
      WITH pv AS (
        SELECT "sessionId", "path", "timestamp",
               ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "timestamp" DESC) AS rn_desc
        FROM "ActivityLog"
        WHERE ${whereSql} AND "type" = 'PAGE_VIEW' AND "sessionId" IS NOT NULL AND "path" IS NOT NULL AND "path" <> ''
      )
      SELECT "path", COUNT(*)::int AS count
      FROM pv
      WHERE rn_desc = 1
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `,

    // 14. Edited fields (Top 25)
    prisma.$queryRaw<Array<{
      model: string;
      field: string;
      count: number;
      uniqueUsers: number;
    }>>`
      SELECT (("details"::jsonb) ->> 'model') AS model,
             k AS field,
             COUNT(*)::int AS count,
             COUNT(DISTINCT "userId")::int AS "uniqueUsers"
      FROM "ActivityLog",
           LATERAL jsonb_object_keys(
             CASE
               WHEN "details" LIKE '{%' AND ("details"::jsonb ? 'diff') AND jsonb_typeof(("details"::jsonb) -> 'diff') = 'object'
               THEN ("details"::jsonb) -> 'diff'
               ELSE '{}'::jsonb
             END
           ) AS k
      WHERE ${whereSql} AND "type" = 'UPDATE' AND "details" IS NOT NULL AND k <> 'relations'
      GROUP BY 1, 2
      ORDER BY count DESC
      LIMIT 25
    `,

    // 15. Quick deletes (deleted < 10m after create)
    prisma.$queryRaw<Array<{ model: string; count: number }>>`
      SELECT (c."details"::jsonb ->> 'model') AS model,
             COUNT(*)::int AS count
      FROM "ActivityLog" c
      JOIN "ActivityLog" d
        ON (c."details"::jsonb ->> 'model') = (d."details"::jsonb ->> 'model')
       AND (c."details"::jsonb -> 'diff' ->> 'id') IS NOT NULL
       AND (c."details"::jsonb -> 'diff' ->> 'id') = (d."details"::jsonb -> 'diff' ->> 'id')
      WHERE c."type" = 'CREATE'
        AND d."type" = 'DELETE'
        AND c."details" LIKE '{%'
        AND d."details" LIKE '{%'
        AND d."timestamp" >= c."timestamp"
        AND d."timestamp" <= c."timestamp" + INTERVAL '10 minutes'
        AND c."timestamp" >= ${from} AND c."timestamp" < ${to}
      GROUP BY 1
      ORDER BY count DESC
    `,

    // 16. Stickiness: DAU
    prisma.$queryRaw<Array<{ dau: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS dau
      FROM "ActivityLog"
      WHERE ${whereSql}
      GROUP BY date_trunc('day', ("timestamp" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))
    `,

    // 17. Stickiness: WAU (trailing 7 days from `to`)
    prisma.$queryRaw<Array<{ wau: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS wau
      FROM "ActivityLog"
      WHERE "timestamp" >= (${to}::timestamp - INTERVAL '7 days') AND "timestamp" < ${to}
      ${userIds && userIds.length > 0 ? Prisma.sql`AND "userId" IN (${Prisma.join(userIds)})` : Prisma.empty}
      ${roles && roles.length > 0 ? Prisma.sql`AND "userId" IN (SELECT "id" FROM "User" WHERE "role"::text IN (${Prisma.join(roles)}))` : Prisma.empty}
    `,

    // 18. Stickiness: MAU (trailing 30 days from `to`)
    prisma.$queryRaw<Array<{ mau: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS mau
      FROM "ActivityLog"
      WHERE "timestamp" >= (${to}::timestamp - INTERVAL '30 days') AND "timestamp" < ${to}
      ${userIds && userIds.length > 0 ? Prisma.sql`AND "userId" IN (${Prisma.join(userIds)})` : Prisma.empty}
      ${roles && roles.length > 0 ? Prisma.sql`AND "userId" IN (SELECT "id" FROM "User" WHERE "role"::text IN (${Prisma.join(roles)}))` : Prisma.empty}
    `,
  ]);

  // Process Totals
  const tRow = totalsRaw[0] || { activeUsers: 0, sessions: 0, pageViews: 0, actions: 0, trackedSeconds: 0 };
  const totals: AnalyticsTotals = {
    activeUsers: Number(tRow.activeUsers) || 0,
    sessions: Number(tRow.sessions) || 0,
    pageViews: Number(tRow.pageViews) || 0,
    actions: Number(tRow.actions) || 0,
    trackedSeconds: Number(tRow.trackedSeconds) || 0,
    avgSessionSeconds:
      Number(tRow.sessions) > 0 ? Math.round(Number(tRow.trackedSeconds) / Number(tRow.sessions)) : 0,
    avgPagesPerSession:
      Number(tRow.sessions) > 0 ? Number((Number(tRow.pageViews) / Number(tRow.sessions)).toFixed(1)) : 0,
  };

  let previousTotals: AnalyticsTotals | null = null;
  if (compare && previousTotalsRaw.length > 0) {
    const pRow = previousTotalsRaw[0];
    previousTotals = {
      activeUsers: Number(pRow.activeUsers) || 0,
      sessions: Number(pRow.sessions) || 0,
      pageViews: Number(pRow.pageViews) || 0,
      actions: Number(pRow.actions) || 0,
      trackedSeconds: Number(pRow.trackedSeconds) || 0,
      avgSessionSeconds:
        Number(pRow.sessions) > 0 ? Math.round(Number(pRow.trackedSeconds) / Number(pRow.sessions)) : 0,
      avgPagesPerSession:
        Number(pRow.sessions) > 0 ? Number((Number(pRow.pageViews) / Number(pRow.sessions)).toFixed(1)) : 0,
    };
  }

  // Process Timeline with gap-filling
  const timelineMap = new Map<string, {
    activeUsers: number;
    sessions: number;
    trackedSeconds: number;
    pageViews: number;
    actions: number;
  }>();

  for (const row of timelineRaw) {
    const bStr = row.bucket instanceof Date ? row.bucket.toISOString() : String(row.bucket);
    // Normalize date bucket key (date part or ISO)
    const key = bStr.slice(0, 10);
    timelineMap.set(key, {
      activeUsers: Number(row.activeUsers) || 0,
      sessions: Number(row.sessions) || 0,
      trackedSeconds: Number(row.trackedSeconds) || 0,
      pageViews: Number(row.pageViews) || 0,
      actions: Number(row.actions) || 0,
    });
  }

  const timeline: ActivityAnalytics['timeline'] = [];
  const cur = new Date(from);
  while (cur < to) {
    const key = cur.toISOString().slice(0, 10);
    const existing = timelineMap.get(key) || {
      activeUsers: 0,
      sessions: 0,
      trackedSeconds: 0,
      pageViews: 0,
      actions: 0,
    };
    timeline.push({
      bucket: key,
      ...existing,
    });

    if (granularity === 'day') {
      cur.setUTCDate(cur.getUTCDate() + 1);
    } else if (granularity === 'week') {
      cur.setUTCDate(cur.getUTCDate() + 7);
    } else {
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  // Process Pages
  const pages = pagesRaw.map((p) => {
    const views = Number(p.views) || 0;
    const totalSeconds = Number(p.totalSeconds) || 0;
    return {
      path: p.path,
      views,
      totalSeconds,
      avgSeconds: views > 0 ? Math.round(totalSeconds / views) : 0,
      uniqueUsers: Number(p.uniqueUsers) || 0,
      sessions: Number(p.sessions) || 0,
    };
  });

  // Process Actions
  const actions = actionsRaw
    .filter((a) => a.model)
    .map((a) => ({
      model: a.model,
      action: a.action,
      count: Number(a.count) || 0,
      uniqueUsers: Number(a.uniqueUsers) || 0,
    }));

  // Process Users
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const userPathsMap = new Map<string, Array<{ path: string; seconds: number }>>();

  for (const up of userTopPathsRaw) {
    if (!userPathsMap.has(up.userId)) userPathsMap.set(up.userId, []);
    userPathsMap.get(up.userId)!.push({
      path: up.path,
      seconds: Number(up.seconds) || 0,
    });
  }

  const userActionPathsMap = new Map<string, Array<{ path: string; actions: number }>>();
  for (const uap of userActionPathsRaw) {
    if (!userActionPathsMap.has(uap.userId)) userActionPathsMap.set(uap.userId, []);
    userActionPathsMap.get(uap.userId)!.push({
      path: uap.path,
      actions: Number(uap.actions) || 0,
    });
  }

  const users = usersRaw.map((u) => {
    const uMeta = userMap.get(u.userId);
    const trackedSecs = Number(u.trackedSeconds) || 0;
    const sess = Number(u.sessions) || 0;
    const pPaths = userPathsMap.get(u.userId) || [];
    const topPath = pPaths.length > 0 ? pPaths[0].path : null;

    return {
      userId: u.userId,
      userName: uMeta?.name || 'Unknown',
      role: uMeta?.role || null,
      sessions: sess,
      activeDays: Number(u.activeDays) || 0,
      trackedSeconds: trackedSecs,
      pageViews: Number(u.pageViews) || 0,
      actions: Number(u.actions) || 0,
      avgSessionSeconds: sess > 0 ? Math.round(trackedSecs / sess) : 0,
      lastActive: u.lastActive instanceof Date ? u.lastActive.toISOString() : String(u.lastActive),
      topPath,
      pageSeconds: pPaths,
      pageActions: userActionPathsMap.get(u.userId) || [],
    };
  });

  // Process Heatmap
  const heatmap = heatmapRaw.map((h) => ({
    dow: Number(h.dow),
    hour: Number(h.hour),
    trackedSeconds: Number(h.trackedSeconds) || 0,
    actions: Number(h.actions) || 0,
  }));

  // Process Session Length Buckets
  const standardBuckets: Array<'<1m' | '1-5m' | '5-15m' | '15-30m' | '30-60m' | '60m+'> = [
    '<1m',
    '1-5m',
    '5-15m',
    '15-30m',
    '30-60m',
    '60m+',
  ];
  const bucketCountMap = new Map<string, number>(
    sessionBucketsRaw.map((b) => [b.bucket, Number(b.count) || 0])
  );
  const sessionLengthBuckets = standardBuckets.map((bucket) => ({
    bucket,
    count: bucketCountMap.get(bucket) || 0,
  }));

  // Process Transitions, Entry, Exit
  const transitions = transitionsRaw.map((t) => ({
    from: t.from,
    to: t.to,
    count: Number(t.count) || 0,
  }));

  const entryPages = entryPagesRaw.map((e) => ({
    path: e.path,
    count: Number(e.count) || 0,
  }));

  const exitPages = exitPagesRaw.map((e) => ({
    path: e.path,
    count: Number(e.count) || 0,
  }));

  // Process Edited Fields
  const editedFields = editedFieldsRaw
    .filter((ef) => ef.model && ef.field)
    .map((ef) => ({
      model: ef.model,
      field: ef.field,
      count: Number(ef.count) || 0,
      uniqueUsers: Number(ef.uniqueUsers) || 0,
    }));

  // Process Quick Deletes
  const quickDeletes = quickDeletesRaw
    .filter((qd) => qd.model)
    .map((qd) => ({
      model: qd.model,
      count: Number(qd.count) || 0,
    }));

  // Stickiness
  const avgDau =
    dauRaw.length > 0
      ? Number(
          (
            dauRaw.reduce((sum, d) => sum + (Number(d.dau) || 0), 0) / dauRaw.length
          ).toFixed(1)
        )
      : 0;
  const wau = wauRaw.length > 0 ? Number(wauRaw[0].wau) || 0 : 0;
  const mau = mauRaw.length > 0 ? Number(mauRaw[0].mau) || 0 : 0;

  const totalRegisteredActiveUsers = allUsers.filter((u) => u.status === 'Active').length;

  return {
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      granularity,
      tz,
    },
    totals,
    previousTotals,
    timeline,
    pages,
    actions,
    users,
    heatmap,
    sessionLengthBuckets,
    transitions,
    entryPages,
    exitPages,
    editedFields,
    quickDeletes,
    stickiness: {
      dau: avgDau,
      wau,
      mau,
    },
    totalRegisteredActiveUsers,
  };
}
