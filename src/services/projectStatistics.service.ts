import { prisma } from '../db';
import { isRestrictedToOwn } from '../types';

export interface ProjectStatisticsQueryOptions {
  statusFilter?: 'all' | 'active' | 'done';
  user?: any;
  language?: string;
}

export interface ProjectUserStatDto {
  userName: string;
  count: number;
}

export interface ProjectCategoryStatDto {
  grpCode: string;
  categoryName: string;
  count: number;
}

export interface MountainOwnerDto {
  owner: string;
  countsByMonth: Record<string, number>;
  total: number;
}

export interface MountainMonthDto {
  key: string;
  label: string;
}

export interface TopClientPaidDto {
  clientKey: string;
  clientName: string;
  totalPaid: number;
  count: number;
}

export interface ProjectStatisticsDto {
  statusCounts: {
    all: number;
    active: number;
    done: number;
  };
  filterStatus: 'all' | 'active' | 'done';
  userStats: ProjectUserStatDto[];
  categoryStats: ProjectCategoryStatDto[];
  mountainStats: {
    totalCompletedIn12Months: number;
    months: MountainMonthDto[];
    owners: MountainOwnerDto[];
  };
  topClients: TopClientPaidDto[];
}

const FALLBACK_TYPE_GROUPS: Record<string, string> = {
  'waste-disposal': 'grp-waste',
  'waste-management': 'grp-waste',
  'special-waste-streams': 'grp-waste',
  'permits': 'grp-legal',
  'environmental-impact': 'grp-legal',
  'wastewater-testing': 'grp-testing',
  'air-emissions': 'grp-testing',
  'noise-emissions': 'grp-testing',
  'soil-testing': 'grp-testing',
  'waste-testing': 'grp-testing',
  'adr-adviser': 'grp-advisory',
  'chemical-adviser': 'grp-advisory',
  'iso': 'grp-standards',
  'fsc': 'grp-standards',
  'enplus': 'grp-standards',
  'ddd': 'grp-standards',
  'haccp': 'grp-standards',
  'zbrinjavanje': 'grp-waste',
  'odlaganje': 'grp-waste',
  'odlaganje-otpada': 'grp-waste',
  'upravljanje': 'grp-waste',
  'posebni-tokovi': 'grp-waste',
};

const INTL_LOCALE_MAP: Record<string, string> = {
  'sr-Latn': 'sr-Latn-RS',
  'sr-Cyrl': 'sr-Cyrl-RS',
  en: 'en-US',
};

export async function getProjectStatistics(options: ProjectStatisticsQueryOptions = {}): Promise<ProjectStatisticsDto> {
  const statusFilter = options.statusFilter || 'all';
  const user = options.user;
  const language = options.language || 'sr-Latn';
  const isOnlyOwn = user ? (isRestrictedToOwn(user, 'projects') || isRestrictedToOwn(user, 'tracker_projects')) : false;

  // Generate 12-month window keys (YYYY-MM) and localized labels
  const now = new Date();
  const months: MountainMonthDto[] = [];
  const locale = INTL_LOCALE_MAP[language] || 'sr-Latn-RS';

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthName = d.toLocaleDateString(locale, { month: 'short' });
    const yearShort = String(d.getFullYear()).slice(-2);
    const label = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} '${yearShort}`;
    months.push({ key, label });
  }

  const oldestMonthDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // We use basePrisma / prisma.$queryRawUnsafe
  const basePrisma = (prisma as any).$primary ?? prisma;

  // 1. Query registered admin users & registered non-admin users
  const allUsers: Array<{ id: string; name: string; role: string; isSystemAdmin: boolean | null }> = await basePrisma.$queryRawUnsafe(`
    SELECT u.id, u.name, u.role, r."isSystemAdmin"
    FROM "User" u
    LEFT JOIN "Role" r ON u.role = r.name
  `);

  const adminIds = new Set<string>();
  const adminNames = new Set<string>();
  const nonAdminUsersList: Array<{ id: string; name: string }> = [];

  for (const u of allUsers) {
    const isAdmin = u.role === 'Administrator' || u.role?.toLowerCase() === 'administrator' || Boolean(u.isSystemAdmin);
    if (isAdmin) {
      adminIds.add(u.id);
      if (u.name) adminNames.add(u.name.trim().toLowerCase());
    } else {
      nonAdminUsersList.push({ id: u.id, name: u.name });
    }
  }

  // Construct SQL conditions
  // a) Non-admin condition
  const adminFilterClauses: string[] = [];
  if (adminIds.size > 0) {
    const idList = Array.from(adminIds).map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    adminFilterClauses.push(`(p."responsibleId" IS NULL OR p."responsibleId" NOT IN (${idList}))`);
  }
  if (adminNames.size > 0) {
    const nameList = Array.from(adminNames).map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
    adminFilterClauses.push(`(p.responsible IS NULL OR LOWER(TRIM(p.responsible)) NOT IN (${nameList}))`);
  }
  const nonAdminClause = adminFilterClauses.length > 0 ? adminFilterClauses.join(' AND ') : '1=1';

  // b) Restricted own projects condition
  let ownClause = '1=1';
  if (isOnlyOwn && user) {
    const escapedUserId = String(user.id || '').replace(/'/g, "''");
    const escapedUserName = String(user.name || '').trim().toLowerCase().replace(/'/g, "''");
    ownClause = `(p."responsibleId" = '${escapedUserId}' OR (p.responsible IS NOT NULL AND LOWER(TRIM(p.responsible)) = '${escapedUserName}'))`;
  }

  const baseProjectWhere = `${nonAdminClause} AND ${ownClause}`;

  // 2. Status counts query
  const statusCountsRaw: Array<{ all: number; active: number; done: number }> = await basePrisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS "all",
      COUNT(*) FILTER (WHERE p.done = false)::int AS "active",
      COUNT(*) FILTER (WHERE p.done = true)::int AS "done"
    FROM "Project" p
    WHERE ${baseProjectWhere}
  `);

  const statusCounts = statusCountsRaw[0] || { all: 0, active: 0, done: 0 };

  // Status condition for filtered user & category charts
  let statusCondition = '1=1';
  if (statusFilter === 'active') {
    statusCondition = 'p.done = false';
  } else if (statusFilter === 'done') {
    statusCondition = 'p.done = true';
  }

  const filteredProjectsWhere = `${baseProjectWhere} AND ${statusCondition}`;

  // 3. User breakdown query
  const userBreakdownRaw: Array<{ userName: string; count: number }> = await basePrisma.$queryRawUnsafe(`
    SELECT
      COALESCE(u.name, NULLIF(TRIM(p.responsible), ''), '__unassigned__') AS "userName",
      COUNT(*)::int AS "count"
    FROM "Project" p
    LEFT JOIN "User" u ON p."responsibleId" = u.id
    WHERE ${filteredProjectsWhere}
    GROUP BY 1
    ORDER BY "count" DESC
  `);

  // 4. Category breakdown query
  // Load categories table for display names
  const categoriesList: Array<{ code: string; name: string }> = await basePrisma.$queryRawUnsafe(`
    SELECT code, name FROM "Category"
  `);
  const categoryNameMap = new Map<string, string>();
  for (const c of categoriesList) {
    categoryNameMap.set(c.code, c.name);
  }

  const rawProjectsForCategories: Array<{ type: string; serviceGroup: string | null; count: number }> = await basePrisma.$queryRawUnsafe(`
    SELECT
      p.type,
      s.group AS "serviceGroup",
      COUNT(*)::int AS "count"
    FROM "Project" p
    LEFT JOIN "Service" s ON (s.code = p.type OR s.id = p.type)
    WHERE ${filteredProjectsWhere}
    GROUP BY p.type, s.group
  `);

  const categoryCountMap = new Map<string, number>();
  for (const r of rawProjectsForCategories) {
    const grpCode = r.serviceGroup || FALLBACK_TYPE_GROUPS[r.type] || '__other__';
    categoryCountMap.set(grpCode, (categoryCountMap.get(grpCode) || 0) + r.count);
  }

  const categoryStats: ProjectCategoryStatDto[] = Array.from(categoryCountMap.entries())
    .map(([grpCode, count]) => ({
      grpCode,
      categoryName: categoryNameMap.get(grpCode) || grpCode,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // 5. Mountain Chart: Completed projects by owner in last 12 months
  const oldestIso = oldestMonthDate.toISOString();
  const mountainRaw: Array<{ owner: string; monthKey: string; count: number }> = await basePrisma.$queryRawUnsafe(`
    SELECT
      COALESCE(u.name, NULLIF(TRIM(p.responsible), ''), '__unassigned__') AS "owner",
      TO_CHAR(COALESCE(p."updatedAt", p."createdAt"), 'YYYY-MM') AS "monthKey",
      COUNT(*)::int AS "count"
    FROM "Project" p
    LEFT JOIN "User" u ON p."responsibleId" = u.id
    WHERE p.done = true
      AND ${baseProjectWhere}
      AND COALESCE(p."updatedAt", p."createdAt") >= '${oldestIso}'
    GROUP BY 1, 2
  `);

  // Aggregate monthly counts per owner
  const monthKeySet = new Set(months.map((m) => m.key));
  const ownerMonthlyMap = new Map<string, Record<string, number>>();
  let totalCompletedIn12Months = 0;

  for (const r of mountainRaw) {
    if (monthKeySet.has(r.monthKey)) {
      if (!ownerMonthlyMap.has(r.owner)) {
        ownerMonthlyMap.set(r.owner, {});
      }
      const record = ownerMonthlyMap.get(r.owner)!;
      record[r.monthKey] = (record[r.monthKey] || 0) + r.count;
      totalCompletedIn12Months += r.count;
    }
  }

  // Include non-admin users in the owners list even if they have 0 completed projects
  for (const nonAdmin of nonAdminUsersList) {
    if (!ownerMonthlyMap.has(nonAdmin.name)) {
      ownerMonthlyMap.set(nonAdmin.name, {});
    }
  }

  const mountainOwners: MountainOwnerDto[] = Array.from(ownerMonthlyMap.entries())
    .map(([owner, countsByMonth]) => {
      const total = Object.values(countsByMonth).reduce((sum, v) => sum + v, 0);
      return { owner, countsByMonth, total };
    })
    .filter((o) => o.total > 0 || nonAdminUsersList.some((u) => u.name === o.owner))
    .sort((a, b) => b.total - a.total);

  // 6. Top 10 clients by sum of paid invoices
  const topClientsRaw: Array<{
    clientKey: string;
    clientName: string;
    totalPaid: number;
    count: number;
  }> = await basePrisma.$queryRawUnsafe(`
    SELECT
      COALESCE(i."clientId", 'name_' || TRIM(COALESCE(i."clientName", ''))) AS "clientKey",
      COALESCE(c.name, i."clientName", 'Unassigned') AS "clientName",
      SUM(
        CASE
          WHEN COALESCE(i."totalAmount", 0) > 0 THEN i."totalAmount"
          ELSE COALESCE(items_calc.sum_amount, 0)
        END
      )::float AS "totalPaid",
      COUNT(*)::int AS "count"
    FROM "Invoice" i
    LEFT JOIN "Client" c ON i."clientId" = c.id
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(ii.quantity, 0) * COALESCE(ii."unitPrice", 0)) AS sum_amount
      FROM "InvoiceItem" ii
      WHERE ii."invoiceId" = i.id
    ) items_calc ON true
    WHERE LOWER(TRIM(i.status)) = 'paid'
    GROUP BY 1, 2
    HAVING SUM(
      CASE
        WHEN COALESCE(i."totalAmount", 0) > 0 THEN i."totalAmount"
        ELSE COALESCE(items_calc.sum_amount, 0)
      END
    ) > 0
    ORDER BY "totalPaid" DESC
    LIMIT 10
  `);

  return {
    statusCounts,
    filterStatus: statusFilter,
    userStats: userBreakdownRaw,
    categoryStats,
    mountainStats: {
      totalCompletedIn12Months,
      months,
      owners: mountainOwners,
    },
    topClients: topClientsRaw,
  };
}
