import { vi, beforeEach } from 'vitest';
import { mockPrisma } from './helpers/prismaMock';
import { invalidateUserAuthCache, userForceLogoutMap } from '../middleware/auth';
import { clearReferenceCache } from '../helpers/referenceCache';
import { clearAnalyticsCache } from '../helpers/analyticsCache';

// Mock the db module using an inline factory that imports from prismaMock
vi.mock('../db', async () => {
  const { mockPrisma } = await import('./helpers/prismaMock');
  return {
    prisma: mockPrisma,
    basePrisma: mockPrisma,
    auditedTransaction: vi.fn().mockImplementation((callback: any) => callback(mockPrisma)),
    cleanText: vi.fn((v: string) => v),
    compactValue: vi.fn((v: any) => v),
    compactDiffPair: vi.fn((o: any, n: any) => ({ old: o, new: n })),
  };
});

// Mock activity logger client to avoid interval or background buffer crashes
vi.mock('../helpers/activityLogger', () => ({
  initActivityLogger: vi.fn(),
  shutdownActivityLogger: vi.fn().mockResolvedValue(undefined),
  enqueueActivityLog: vi.fn(),
  flushActivityLogs: vi.fn().mockResolvedValue(undefined),
  isActivityLoggingEnabled: vi.fn().mockReturnValue(true),
  setActivityLoggingEnabled: vi.fn(),
  getRetentionDays: vi.fn().mockReturnValue(30),
  setRetentionDays: vi.fn(),
  syncActivityLoggerSettings: vi.fn().mockResolvedValue({ enabled: true, retentionDays: 30 }),
  setActivityLoggerClient: vi.fn(),
  SETTING_KEY_ACTIVITY_LOGS: 'activity_logging_enabled',
  SETTING_KEY_ACTIVITY_RETENTION: 'activity_log_retention_days',
}));

beforeEach(() => {
  vi.clearAllMocks();
  invalidateUserAuthCache();
  clearReferenceCache();
  clearAnalyticsCache();
  userForceLogoutMap.clear();

  // Reset default return values for findFirst and findUnique to null
  const models = [
    'user',
    'role',
    'project',
    'projectNote',
    'projectNoteVersion',
    'client',
    'clientExtraData',
    'invoice',
    'invoiceItem',
    'service',
    'providedService',
    'reminder',
    'permit',
    'permitWaste',
    'wasteCatalog',
    'category',
    'companyInfo',
    'notification',
    'userPreference',
    'systemSetting',
    'activityLog',
    'activityLogMonthlyStats',
    'changeSet',
    'entityVersion',
  ];

  for (const m of models) {
    if (mockPrisma[m]) {
      mockPrisma[m].findFirst.mockResolvedValue(null);
      mockPrisma[m].findUnique.mockResolvedValue(null);
      mockPrisma[m].findMany.mockResolvedValue([]);
    }
  }

  // Re-establish default $transaction implementation on mockPrisma
  mockPrisma.$transaction.mockImplementation((fnOrArray: any) => {
    if (typeof fnOrArray === 'function') {
      return fnOrArray(mockPrisma);
    }
    return Promise.all(fnOrArray);
  });
});
