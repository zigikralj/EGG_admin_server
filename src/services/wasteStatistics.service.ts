import { basePrisma } from '../db';
import { SYSTEM_SETTING_KEYS } from '../constants';

export interface WasteStatisticsQueryOptions {
  year?: number;
  monthIndex?: number; // 0-11
  statusFilter?: 'all' | 'completed' | 'canceled';
}

export interface WasteDisposalClientsQueryOptions {
  page?: number;
  limit?: number;
  search?: string;
  year?: number;
  statusFilter?: 'all' | 'completed' | 'canceled';
  sortBy?: 'totalValue' | 'totalWaste' | 'count' | 'clientName';
  sortOrder?: 'asc' | 'desc';
}

export interface WasteDisposalClientRowDto {
  clientId: string;
  clientName: string;
  city: string | null;
  count: number;
  totalWasteKg: number;
  totalWasteTons: number;
  paidRevenueRSD: number;
  totalInvoicedRSD: number;
  lastDeliveryDate: string | null;
}

export interface PaginatedWasteDisposalClientsDto {
  items: WasteDisposalClientRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface WasteStatisticsResult {
  kpi: {
    totalCount: number;
    completedCount: number;
    inProgressCount: number;
    plannedCount: number;
    completionRate: string;
    paidRevenueRSD: number;
    paidRevenueEUR: number;
    paidInvoicesCount: number;
  };
  availableYears: number[];
  currentWasteYear: number | null;
  selectedYearMonths: Array<{
    monthIndex: number;
    monthKey: string;
    label: string;
  }>;
  selectedMonthIndex: number | null;
  selectedMonthKey: string;
  wasteStatsForSelectedYear: {
    totalKg: number;
    totalTons: number;
    totalEntries: number;
    activeClientsCount: number;
  };
  wasteStatsForSelectedMonth: {
    totalKg: number;
    totalTons: number;
    totalEntries: number;
    activeClientsCount: number;
    clients: Array<{
      clientId: string;
      clientName: string;
      totalKg: number;
      entriesCount: number;
    }>;
  };
  wasteComparisonSeries: Array<{
    year: number;
    label: string;
    data: Array<number | null>; // 12 elements
  }>;
  topClients: Array<{
    clientId: string;
    label: string;
    count: number;
    paidRevenueRSD: number;
    totalWasteKg: number;
  }>;
}

const MONTH_NAMES_SR = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Jun',
  'Jul', 'Avgust', 'Septembar', 'Oktobar', 'Novembar', 'Decembar'
];

export async function getWasteDisposalStatistics(
  options: WasteStatisticsQueryOptions = {}
): Promise<WasteStatisticsResult> {
  // 1. Resolve active waste disposal service ID from SystemSetting
  const setting = await basePrisma.systemSetting.findUnique({
    where: { key: SYSTEM_SETTING_KEYS.WASTE_DISPOSAL_SERVICE_ID || 'waste_disposal_service_id' },
  });

  const wasteServiceId = setting?.value?.trim();
  if (!wasteServiceId) {
    return createEmptyResult();
  }

  // 2. Fetch service to identify dynamic customDataModel weight field & unit
  const wasteService = await basePrisma.service.findUnique({
    where: { id: wasteServiceId },
    select: { customDataModel: true },
  });

  let weightFieldId = 'field_1788029154873_lroa'; // default fallback
  let multiplier = 1;

  if (Array.isArray(wasteService?.customDataModel)) {
    for (const field of wasteService.customDataModel as any[]) {
      if (field.type === 'number') {
        const u = String(field.unit || '').trim().toLowerCase();
        if (['kg', 't', 'tona', 'tone'].includes(u)) {
          weightFieldId = field.id;
          if (['t', 'tona', 'tone'].includes(u)) multiplier = 1000;
          break;
        }
      }
    }
  }

  const statusFilter = options.statusFilter || 'all';

  // 3. Execute queries concurrently
  const [
    kpiCounts,
    kpiRevenue,
    yearsData,
    topClientsRaw,
    comparisonRaw,
  ] = await Promise.all([
    // A. Status counts
    basePrisma.$queryRaw<Array<{
      totalCount: number;
      completedCount: number;
      inProgressCount: number;
      plannedCount: number;
    }>>`
      SELECT 
        COUNT(*)::int AS "totalCount",
        COUNT(*) FILTER (WHERE LOWER(status) = 'completed')::int AS "completedCount",
        COUNT(*) FILTER (WHERE LOWER(status) IN ('in progress', 'in_progress'))::int AS "inProgressCount",
        COUNT(*) FILTER (WHERE LOWER(status) = 'planned')::int AS "plannedCount"
      FROM "ProvidedService"
      WHERE "serviceId" = ${wasteServiceId};
    `,

    // B. Paid invoice revenue
    basePrisma.$queryRaw<Array<{
      paidRevenueRSD: number;
      paidRevenueEUR: number;
      paidInvoicesCount: number;
    }>>`
      SELECT 
        COALESCE(SUM(CASE WHEN inv.currency = 'RSD' THEN inv."totalAmount" ELSE 0 END), 0)::float AS "paidRevenueRSD",
        COALESCE(SUM(CASE WHEN inv.currency IN ('€', 'EUR') THEN inv."totalAmount" ELSE 0 END), 0)::float AS "paidRevenueEUR",
        COUNT(DISTINCT inv.id)::int AS "paidInvoicesCount"
      FROM "Invoice" inv
      WHERE inv.id IN (
        SELECT DISTINCT ps."invoiceId" 
        FROM "ProvidedService" ps 
        WHERE ps."serviceId" = ${wasteServiceId} AND ps."invoiceId" IS NOT NULL
      ) AND LOWER(inv.status) = 'paid';
    `,

    // C. Available years
    basePrisma.$queryRaw<Array<{ year: number }>>`
      SELECT DISTINCT 
        substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 1, 4)::int AS year
      FROM "ProvidedService"
      WHERE "serviceId" = ${wasteServiceId}
      ORDER BY year DESC;
    `,

    // D. Top 9 clients by count
    basePrisma.$queryRaw<Array<{
      clientId: string;
      label: string;
      count: number;
      totalWasteKg: number;
      paidRevenueRSD: number;
    }>>`
      SELECT 
        COALESCE(ps."clientId", '__unassigned__') AS "clientId",
        COALESCE(c.name, 'Unassigned') AS "label",
        COUNT(ps.id)::int AS "count",
        SUM(
          COALESCE(
            NULLIF(ps."customData"->>${weightFieldId}, '')::numeric,
            NULLIF(ps."customData"->>'kolicina_kg', '')::numeric,
            NULLIF(ps."customData"->>'kolicina', '')::numeric,
            0
          ) * ${multiplier}
        )::float AS "totalWasteKg",
        COALESCE((
          SELECT SUM(inv."totalAmount")
          FROM "Invoice" inv
          WHERE inv.id IN (
            SELECT DISTINCT sub."invoiceId"
            FROM "ProvidedService" sub
            WHERE sub."clientId" = ps."clientId" 
              AND sub."serviceId" = ${wasteServiceId} 
              AND sub."invoiceId" IS NOT NULL
          ) AND inv.currency = 'RSD' AND LOWER(inv.status) = 'paid'
        ), 0)::float AS "paidRevenueRSD"
      FROM "ProvidedService" ps
      LEFT JOIN "Client" c ON c.id = ps."clientId"
      WHERE ps."serviceId" = ${wasteServiceId}
      GROUP BY ps."clientId", c.name
      ORDER BY "count" DESC
      LIMIT 9;
    `,

    // E. Monthly comparison for all years
    basePrisma.$queryRaw<Array<{
      yr: number;
      m: number;
      totalKg: number;
    }>>`
      SELECT 
        substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 1, 4)::int AS yr,
        substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 6, 2)::int AS m,
        SUM(
          COALESCE(
            NULLIF("customData"->>${weightFieldId}, '')::numeric,
            NULLIF("customData"->>'kolicina_kg', '')::numeric,
            NULLIF("customData"->>'kolicina', '')::numeric,
            0
          ) * ${multiplier}
        )::float AS "totalKg"
      FROM "ProvidedService"
      WHERE "serviceId" = ${wasteServiceId}
        AND (
          (${statusFilter} = 'all' AND LOWER(status) != 'canceled')
          OR (${statusFilter} = 'completed' AND LOWER(status) = 'completed')
          OR (${statusFilter} = 'canceled' AND LOWER(status) = 'canceled')
        )
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC;
    `,
  ]);

  // Format KPI metrics
  const counts = kpiCounts[0] || { totalCount: 0, completedCount: 0, inProgressCount: 0, plannedCount: 0 };
  const revenue = kpiRevenue[0] || { paidRevenueRSD: 0, paidRevenueEUR: 0, paidInvoicesCount: 0 };
  const totalCount = counts.totalCount || 0;
  const completionRate = totalCount > 0 ? ((counts.completedCount / totalCount) * 100).toFixed(1) : '0';

  const availableYears = yearsData.map((y) => y.year).filter(Boolean);

  // Determine current active year
  let currentWasteYear: number | null = null;
  if (options.year && availableYears.includes(options.year)) {
    currentWasteYear = options.year;
  } else if (availableYears.length > 0) {
    currentWasteYear = availableYears[0];
  }

  // Active months for currentWasteYear
  let activeMonths: number[] = [];
  if (currentWasteYear) {
    const activeMonthsRaw = await basePrisma.$queryRaw<Array<{ m: number }>>`
      SELECT DISTINCT 
        substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 6, 2)::int AS m
      FROM "ProvidedService"
      WHERE "serviceId" = ${wasteServiceId}
        AND substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${currentWasteYear}
      ORDER BY m ASC;
    `;
    activeMonths = activeMonthsRaw.map((r) => r.m);
  }

  const selectedYearMonths = activeMonths.map((m) => {
    const monthIndex = m - 1;
    const monthKey = `${currentWasteYear}-${String(m).padStart(2, '0')}`;
    const label = MONTH_NAMES_SR[monthIndex] || `Mesec ${m}`;
    return { monthIndex, monthKey, label };
  });

  // Determine current active month
  let selectedMonthIndex: number | null = null;
  if (options.monthIndex !== undefined && options.monthIndex !== null && activeMonths.includes(options.monthIndex + 1)) {
    selectedMonthIndex = options.monthIndex;
  } else if (selectedYearMonths.length > 0) {
    selectedMonthIndex = selectedYearMonths[selectedYearMonths.length - 1].monthIndex;
  }

  const selectedMonthObj = selectedYearMonths.find((m) => m.monthIndex === selectedMonthIndex);
  const selectedMonthKey = selectedMonthObj?.monthKey || '';
  const selectedMonthNum = selectedMonthIndex !== null ? selectedMonthIndex + 1 : null;

  // Selected Year & Month aggregations
  let yearStats = { totalKg: 0, totalTons: 0, totalEntries: 0, activeClientsCount: 0 };
  let monthStats = {
    totalKg: 0,
    totalTons: 0,
    totalEntries: 0,
    activeClientsCount: 0,
    clients: [] as Array<{ clientId: string; clientName: string; totalKg: number; entriesCount: number }>,
  };

  if (currentWasteYear) {
    const [yearRaw, monthRaw, monthClientsRaw] = await Promise.all([
      basePrisma.$queryRaw<Array<{ totalKg: number; totalEntries: number; activeClientsCount: number }>>`
        SELECT 
          COALESCE(SUM(
            COALESCE(
              NULLIF("customData"->>${weightFieldId}, '')::numeric,
              NULLIF("customData"->>'kolicina_kg', '')::numeric,
              NULLIF("customData"->>'kolicina', '')::numeric,
              0
            ) * ${multiplier}
          ), 0)::float AS "totalKg",
          COUNT(*)::int AS "totalEntries",
          COUNT(DISTINCT "clientId")::int AS "activeClientsCount"
        FROM "ProvidedService"
        WHERE "serviceId" = ${wasteServiceId}
          AND substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${currentWasteYear};
      `,

      selectedMonthNum !== null
        ? basePrisma.$queryRaw<Array<{ totalKg: number; totalEntries: number; activeClientsCount: number }>>`
            SELECT 
              COALESCE(SUM(
                COALESCE(
                  NULLIF("customData"->>${weightFieldId}, '')::numeric,
                  NULLIF("customData"->>'kolicina_kg', '')::numeric,
                  NULLIF("customData"->>'kolicina', '')::numeric,
                  0
                ) * ${multiplier}
              ), 0)::float AS "totalKg",
              COUNT(*)::int AS "totalEntries",
              COUNT(DISTINCT "clientId")::int AS "activeClientsCount"
            FROM "ProvidedService"
            WHERE "serviceId" = ${wasteServiceId}
              AND substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${currentWasteYear}
              AND substring(COALESCE(NULLIF("completionDate", ''), NULLIF("scheduledDate", ''), to_char("createdAt", 'YYYY-MM-DD')), 6, 2)::int = ${selectedMonthNum};
          `
        : Promise.resolve([]),

      selectedMonthNum !== null
        ? basePrisma.$queryRaw<Array<{ clientId: string; clientName: string; totalKg: number; entriesCount: number }>>`
            SELECT 
              ps."clientId",
              COALESCE(c.name, 'Unassigned') AS "clientName",
              COALESCE(SUM(
                COALESCE(
                  NULLIF(ps."customData"->>${weightFieldId}, '')::numeric,
                  NULLIF(ps."customData"->>'kolicina_kg', '')::numeric,
                  NULLIF(ps."customData"->>'kolicina', '')::numeric,
                  0
                ) * ${multiplier}
              ), 0)::float AS "totalKg",
              COUNT(ps.id)::int AS "entriesCount"
            FROM "ProvidedService" ps
            LEFT JOIN "Client" c ON c.id = ps."clientId"
            WHERE ps."serviceId" = ${wasteServiceId}
              AND substring(COALESCE(NULLIF(ps."completionDate", ''), NULLIF(ps."scheduledDate", ''), to_char(ps."createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${currentWasteYear}
              AND substring(COALESCE(NULLIF(ps."completionDate", ''), NULLIF(ps."scheduledDate", ''), to_char(ps."createdAt", 'YYYY-MM-DD')), 6, 2)::int = ${selectedMonthNum}
            GROUP BY ps."clientId", c.name
            ORDER BY "totalKg" DESC;
          `
        : Promise.resolve([]),
    ]);

    const y = yearRaw[0];
    if (y) {
      yearStats = {
        totalKg: y.totalKg,
        totalTons: y.totalKg / 1000,
        totalEntries: y.totalEntries,
        activeClientsCount: y.activeClientsCount,
      };
    }

    const m = monthRaw[0];
    if (m) {
      monthStats = {
        totalKg: m.totalKg,
        totalTons: m.totalKg / 1000,
        totalEntries: m.totalEntries,
        activeClientsCount: m.activeClientsCount,
        clients: monthClientsRaw,
      };
    }
  }

  // Format YoY 12-month comparison series
  const now = new Date();
  const currentCalYear = now.getFullYear();
  const currentCalMonth = now.getMonth(); // 0-11

  // Ascending chronological order
  const sortedAscYears = [...availableYears].sort((a, b) => a - b);
  const yearDataMap: Record<number, (number | null)[]> = {};

  sortedAscYears.forEach((yr) => {
    if (yr === currentCalYear) {
      yearDataMap[yr] = Array.from({ length: 12 }, (_, m) => (m <= currentCalMonth ? 0 : null));
    } else if (yr > currentCalYear) {
      yearDataMap[yr] = new Array(12).fill(null);
    } else {
      yearDataMap[yr] = new Array(12).fill(0);
    }
  });

  comparisonRaw.forEach((row) => {
    if (yearDataMap[row.yr]) {
      const mIdx = row.m - 1;
      if (mIdx >= 0 && mIdx < 12) {
        if (yearDataMap[row.yr][mIdx] !== null) {
          yearDataMap[row.yr][mIdx] = row.totalKg;
        }
      }
    }
  });

  const wasteComparisonSeries = sortedAscYears.map((yr) => ({
    year: yr,
    label: String(yr),
    data: yearDataMap[yr],
  }));

  return {
    kpi: {
      totalCount,
      completedCount: counts.completedCount || 0,
      inProgressCount: counts.inProgressCount || 0,
      plannedCount: counts.plannedCount || 0,
      completionRate,
      paidRevenueRSD: revenue.paidRevenueRSD || 0,
      paidRevenueEUR: revenue.paidRevenueEUR || 0,
      paidInvoicesCount: revenue.paidInvoicesCount || 0,
    },
    availableYears,
    currentWasteYear,
    selectedYearMonths,
    selectedMonthIndex,
    selectedMonthKey,
    wasteStatsForSelectedYear: yearStats,
    wasteStatsForSelectedMonth: monthStats,
    wasteComparisonSeries,
    topClients: topClientsRaw,
  };
}

function createEmptyResult(): WasteStatisticsResult {
  return {
    kpi: {
      totalCount: 0,
      completedCount: 0,
      inProgressCount: 0,
      plannedCount: 0,
      completionRate: '0',
      paidRevenueRSD: 0,
      paidRevenueEUR: 0,
      paidInvoicesCount: 0,
    },
    availableYears: [],
    currentWasteYear: null,
    selectedYearMonths: [],
    selectedMonthIndex: null,
    selectedMonthKey: '',
    wasteStatsForSelectedYear: {
      totalKg: 0,
      totalTons: 0,
      totalEntries: 0,
      activeClientsCount: 0,
    },
    wasteStatsForSelectedMonth: {
      totalKg: 0,
      totalTons: 0,
      totalEntries: 0,
      activeClientsCount: 0,
      clients: [],
    },
    wasteComparisonSeries: [],
    topClients: [],
  };
}

export async function getWasteDisposalClients(
  options: WasteDisposalClientsQueryOptions = {}
): Promise<PaginatedWasteDisposalClientsDto> {
  // 1. Resolve waste disposal service ID
  const setting = await basePrisma.systemSetting.findUnique({
    where: { key: SYSTEM_SETTING_KEYS.WASTE_DISPOSAL_SERVICE_ID },
  });
  const wasteServiceId = setting?.value?.trim();
  if (!wasteServiceId) {
    return {
      items: [],
      total: 0,
      page: options.page || 1,
      limit: options.limit || 10,
      totalPages: 0,
    };
  }

  // 2. Fetch service customDataModel for weight field & unit multiplier
  const wasteService = await basePrisma.service.findUnique({
    where: { id: wasteServiceId },
    select: { customDataModel: true },
  });

  let weightFieldId = 'field_1788029154873_lroa';
  let multiplier = 1;

  if (Array.isArray(wasteService?.customDataModel)) {
    for (const field of wasteService.customDataModel as any[]) {
      if (field.type === 'number') {
        const u = String(field.unit || '').trim().toLowerCase();
        if (['kg', 't', 'tona', 'tone'].includes(u)) {
          weightFieldId = field.id;
          if (['t', 'tona', 'tone'].includes(u)) multiplier = 1000;
          break;
        }
      }
    }
  }

  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 10));
  const offset = (page - 1) * limit;

  const statusFilter = options.statusFilter || 'all';
  const sortBy = options.sortBy || 'totalValue';
  const sortOrder = (options.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = [`ps."serviceId" = '${wasteServiceId.replace(/'/g, "''")}'`];

  if (statusFilter === 'completed') {
    conditions.push(`LOWER(ps.status) = 'completed'`);
  } else if (statusFilter === 'canceled') {
    conditions.push(`LOWER(ps.status) = 'canceled'`);
  } else {
    conditions.push(`LOWER(ps.status) != 'canceled'`);
  }

  if (options.year) {
    conditions.push(
      `substring(COALESCE(NULLIF(ps."completionDate", ''), NULLIF(ps."scheduledDate", ''), to_char(ps."createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${options.year}`
    );
  }

  if (options.search && options.search.trim()) {
    const escapedSearch = options.search.trim().replace(/'/g, "''");
    conditions.push(`(c.name ILIKE '%${escapedSearch}%' OR c.city ILIKE '%${escapedSearch}%')`);
  }

  const whereClause = conditions.join(' AND ');

  let yearConditionForSub = '';
  if (options.year) {
    yearConditionForSub = `AND substring(COALESCE(NULLIF(sub."completionDate", ''), NULLIF(sub."scheduledDate", ''), to_char(sub."createdAt", 'YYYY-MM-DD')), 1, 4)::int = ${options.year}`;
  }

  // Count total matching clients
  const countRaw = await basePrisma.$queryRawUnsafe<Array<{ total: number }>>(`
    SELECT COUNT(*)::int AS total FROM (
      SELECT ps."clientId"
      FROM "ProvidedService" ps
      LEFT JOIN "Client" c ON c.id = ps."clientId"
      WHERE ${whereClause}
      GROUP BY ps."clientId", c.name, c.city
    ) sub;
  `);
  const total = countRaw[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  if (total === 0) {
    return {
      items: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
    };
  }

  let sqlSortCol = '"paidRevenueRSD"';
  if (sortBy === 'totalWaste') sqlSortCol = '"totalWasteKg"';
  else if (sortBy === 'count') sqlSortCol = '"count"';
  else if (sortBy === 'clientName') sqlSortCol = '"clientName"';

  const rows = await basePrisma.$queryRawUnsafe<Array<{
    clientId: string;
    clientName: string;
    city: string | null;
    count: number;
    lastDeliveryDate: string | null;
    totalWasteKg: number;
    paidRevenueRSD: number;
    totalInvoicedRSD: number;
  }>>(`
    WITH client_stats AS (
      SELECT
        COALESCE(ps."clientId", '__unassigned__') AS "clientId",
        COALESCE(c.name, 'Unassigned') AS "clientName",
        c.city AS "city",
        COUNT(ps.id)::int AS "count",
        MAX(COALESCE(NULLIF(ps."completionDate", ''), ps."scheduledDate")) AS "lastDeliveryDate",
        SUM(
          COALESCE(
            NULLIF(ps."customData"->>'${weightFieldId}', '')::numeric,
            NULLIF(ps."customData"->>'kolicina_kg', '')::numeric,
            NULLIF(ps."customData"->>'kolicina', '')::numeric,
            0
          ) * ${multiplier}
        )::float AS "totalWasteKg",
        COALESCE((
          SELECT SUM(inv."totalAmount")
          FROM "Invoice" inv
          WHERE inv.id IN (
            SELECT DISTINCT sub."invoiceId"
            FROM "ProvidedService" sub
            WHERE sub."clientId" = ps."clientId"
              AND sub."serviceId" = '${wasteServiceId.replace(/'/g, "''")}'
              AND sub."invoiceId" IS NOT NULL
              ${yearConditionForSub}
          ) AND inv.currency = 'RSD' AND LOWER(inv.status) = 'paid'
        ), 0)::float AS "paidRevenueRSD",
        COALESCE((
          SELECT SUM(inv."totalAmount")
          FROM "Invoice" inv
          WHERE inv.id IN (
            SELECT DISTINCT sub."invoiceId"
            FROM "ProvidedService" sub
            WHERE sub."clientId" = ps."clientId"
              AND sub."serviceId" = '${wasteServiceId.replace(/'/g, "''")}'
              AND sub."invoiceId" IS NOT NULL
              ${yearConditionForSub}
          ) AND inv.currency = 'RSD'
        ), 0)::float AS "totalInvoicedRSD"
      FROM "ProvidedService" ps
      LEFT JOIN "Client" c ON c.id = ps."clientId"
      WHERE ${whereClause}
      GROUP BY ps."clientId", c.name, c.city
    )
    SELECT * FROM client_stats
    ORDER BY ${sqlSortCol} ${sortOrder}, "count" DESC
    LIMIT ${limit} OFFSET ${offset};
  `);

  const items: WasteDisposalClientRowDto[] = rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.clientName,
    city: r.city,
    count: r.count,
    totalWasteKg: r.totalWasteKg,
    totalWasteTons: r.totalWasteKg / 1000,
    paidRevenueRSD: r.paidRevenueRSD,
    totalInvoicedRSD: r.totalInvoicedRSD,
    lastDeliveryDate: r.lastDeliveryDate,
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages,
  };
}

