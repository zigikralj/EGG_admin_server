import { vi } from 'vitest';

export function createPrismaMock() {
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
    'chatConversation',
    'chatParticipant',
    'chatMessage',
    'contract',
    'contractTemplate',
  ];

  const mock: Record<string, any> = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $transaction: vi.fn().mockImplementation((fnOrArray) => {
      if (typeof fnOrArray === 'function') {
        return fnOrArray(mock);
      }
      return Promise.all(fnOrArray);
    }),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $extends: vi.fn().mockReturnThis(),
  };

  for (const m of models) {
    mock[m] = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: 'mock-id', ...args?.data })),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args?.where?.id || 'mock-id', ...args?.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args?.where?.id || 'mock-id' })),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: args?.where?.id || 'mock-id', ...(args?.create || {}) })),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _count: 0 }),
    };
  }

  return mock;
}

export const mockPrisma = createPrismaMock();
