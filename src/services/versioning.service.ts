import { basePrisma, auditedTransaction } from '../db';

const ENTITY_TYPE_MAP: Record<string, string> = {
  project: 'Project',
  projects: 'Project',
  client: 'Client',
  clients: 'Client',
  clientextradata: 'ClientExtraData',
  service: 'Service',
  services: 'Service',
  category: 'Category',
  categories: 'Category',
  reminder: 'Reminder',
  reminders: 'Reminder',
  invoice: 'Invoice',
  invoices: 'Invoice',
  invoiceitem: 'InvoiceItem',
  invoiceitems: 'InvoiceItem',
  providedservice: 'ProvidedService',
  providedservices: 'ProvidedService',
  permit: 'Permit',
  permits: 'Permit',
  permitwaste: 'PermitWaste',
  wastecatalog: 'WasteCatalog',
  companyinfo: 'CompanyInfo',
  user: 'User',
  users: 'User',
};

export function normalizeEntityType(raw: string): string | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  return ENTITY_TYPE_MAP[lower] || null;
}

export async function getEntityTimeline(
  entityType: string,
  entityId: string,
  options?: { limit?: number; offset?: number; includeChildren?: boolean }
) {
  const normType = normalizeEntityType(entityType);
  if (!normType) throw new Error(`Unsupported entity type: ${entityType}`);

  const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200);
  const offset = Math.max(Number(options?.offset) || 0, 0);
  const includeChildren = Boolean(options?.includeChildren);

  const where = includeChildren
    ? {
        OR: [
          { entityType: normType, entityId },
          { parentType: normType, parentId: entityId },
        ],
      }
    : {
        entityType: normType,
        entityId,
      };

  const [total, versions] = await Promise.all([
    basePrisma.entityVersion.count({ where }),
    basePrisma.entityVersion.findMany({
      where,
      include: { changeSet: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    }),
  ]);

  return {
    total,
    limit,
    offset,
    versions: versions.map((v) => ({
      id: v.id.toString(),
      changeSetId: v.changeSetId,
      entityType: v.entityType,
      entityId: v.entityId,
      version: v.version,
      op: v.op,
      kind: v.kind,
      changedFields: v.changedFields,
      parentType: v.parentType,
      parentId: v.parentId,
      createdAt: v.createdAt,
      changeSet: {
        id: v.changeSet.id,
        userId: v.changeSet.userId,
        userName: v.changeSet.userName,
        source: v.changeSet.source,
        reason: v.changeSet.reason,
        route: v.changeSet.route,
        method: v.changeSet.method,
        createdAt: v.changeSet.createdAt,
      },
    })),
  };
}

export async function rebuildEntityVersion(
  entityType: string,
  entityId: string,
  targetVersion: number
) {
  const normType = normalizeEntityType(entityType);
  if (!normType) throw new Error(`Unsupported entity type: ${entityType}`);

  // 1. Find nearest keyframe snapshot S with version <= targetVersion and kind = 'S'
  const nearestSnapshot = await basePrisma.entityVersion.findFirst({
    where: {
      entityType: normType,
      entityId,
      version: { lte: targetVersion },
      kind: 'S',
    },
    orderBy: { version: 'desc' },
  });

  if (!nearestSnapshot) {
    return null;
  }

  // 2. Fetch all intermediate deltas from nearestSnapshot.version up to targetVersion
  const intermediateDeltas = await basePrisma.entityVersion.findMany({
    where: {
      entityType: normType,
      entityId,
      version: {
        gt: nearestSnapshot.version,
        lte: targetVersion,
      },
    },
    orderBy: { version: 'asc' },
  });

  // 3. Fold deltas over snapshot
  const state: Record<string, any> = {
    ...(nearestSnapshot.data as Record<string, any>),
  };

  for (const delta of intermediateDeltas) {
    if (delta.data && typeof delta.data === 'object' && !Array.isArray(delta.data)) {
      Object.assign(state, delta.data);
    }
  }

  // Retrieve the target version record itself for accurate metadata
  const targetVersionRecord =
    nearestSnapshot.version === targetVersion
      ? nearestSnapshot
      : intermediateDeltas[intermediateDeltas.length - 1];

  return {
    entityType: normType,
    entityId,
    version: targetVersion,
    op: targetVersionRecord?.op ?? nearestSnapshot.op,
    kind: targetVersionRecord?.kind ?? nearestSnapshot.kind,
    createdAt: targetVersionRecord?.createdAt ?? nearestSnapshot.createdAt,
    state,
  };
}

export async function diffVersions(
  entityType: string,
  entityId: string,
  vFrom: number,
  vTo: number
) {
  const normType = normalizeEntityType(entityType);
  if (!normType) throw new Error(`Unsupported entity type: ${entityType}`);

  const [fromState, toState] = await Promise.all([
    rebuildEntityVersion(normType, entityId, vFrom),
    rebuildEntityVersion(normType, entityId, vTo),
  ]);

  if (!fromState || !toState) {
    throw new Error('One or both versions could not be found for comparison');
  }

  const allKeys = Array.from(
    new Set([...Object.keys(fromState.state), ...Object.keys(toState.state)])
  );

  const diff: Record<string, { old: any; new: any }> = {};
  for (const key of allKeys) {
    if (key === 'updatedAt') continue;
    const oldVal = fromState.state[key] ?? null;
    const newVal = toState.state[key] ?? null;

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  return {
    entityType: normType,
    entityId,
    vFrom,
    vTo,
    fromCreatedAt: fromState.createdAt,
    toCreatedAt: toState.createdAt,
    changedFields: Object.keys(diff),
    diff,
  };
}

export async function getChangeSetDetails(changeSetId: string) {
  const changeSet = await basePrisma.changeSet.findUnique({
    where: { id: changeSetId },
    include: {
      versions: {
        orderBy: [{ entityType: 'asc' }, { version: 'asc' }],
      },
    },
  });

  if (!changeSet) return null;

  return {
    id: changeSet.id,
    userId: changeSet.userId,
    userName: changeSet.userName,
    source: changeSet.source,
    reason: changeSet.reason,
    route: changeSet.route,
    method: changeSet.method,
    createdAt: changeSet.createdAt,
    versions: changeSet.versions.map((v) => ({
      id: v.id.toString(),
      entityType: v.entityType,
      entityId: v.entityId,
      version: v.version,
      op: v.op,
      kind: v.kind,
      changedFields: v.changedFields,
      parentType: v.parentType,
      parentId: v.parentId,
      data: v.data,
      createdAt: v.createdAt,
    })),
  };
}

export async function restoreVersion(
  entityType: string,
  entityId: string,
  targetVersion: number,
  userContext: { userId: string; userName?: string }
) {
  const normType = normalizeEntityType(entityType);
  if (!normType) throw new Error(`Unsupported entity type: ${entityType}`);

  const historical = await rebuildEntityVersion(normType, entityId, targetVersion);
  if (!historical) {
    throw new Error(`Version ${targetVersion} not found for ${normType} ${entityId}`);
  }

  const delegateName = normType.charAt(0).toLowerCase() + normType.slice(1);

  // Clean data for restoration: omit immutable/bookkeeping fields
  const cleanAttributes = { ...historical.state };
  delete cleanAttributes.id;
  delete cleanAttributes.createdAt;
  delete cleanAttributes.updatedAt;

  // Protect sensitive user password field from being replaced with "[redacted]"
  if (normType === 'User' && cleanAttributes.password === '[redacted]') {
    delete cleanAttributes.password;
  }

  return auditedTransaction(
    async (tx) => {
      const delegate = (tx as any)[delegateName];
      if (!delegate) throw new Error(`Unknown model delegate: ${delegateName}`);

      const existingRecord = await delegate.findUnique({
        where: { id: entityId },
      });

      let restoredRecord;
      if (existingRecord) {
        restoredRecord = await delegate.update({
          where: { id: entityId },
          data: cleanAttributes,
        });
      } else {
        // Record was deleted; recreate with original id
        restoredRecord = await delegate.create({
          data: {
            ...cleanAttributes,
            id: entityId,
          },
        });
      }

      return {
        restored: true,
        entityType: normType,
        entityId,
        restoredToVersion: targetVersion,
        record: restoredRecord,
      };
    },
    {
      source: 'restore',
      reason: `Restored to version ${targetVersion}`,
      userId: userContext.userId,
      userName: userContext.userName,
    }
  );
}
