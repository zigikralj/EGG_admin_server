import { basePrisma } from '../db';

export const MAX_DELTA_AGE_DAYS = 30;

/**
 * Validates and parses a raw query parameter into a Date object.
 * Returns null if the value is missing, empty, not a valid date,
 * or older than MAX_DELTA_AGE_DAYS (30 days) to prevent missing tombstones.
 */
export function parseSince(raw?: unknown, maxAgeDays: number = MAX_DELTA_AGE_DAYS): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

  // If the since date is older than retention (e.g. 30 days), fall back to null
  // so callers serve a full fresh snapshot instead of risking tombstone misses.
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < cutoff) {
    return null;
  }

  return parsed;
}

/**
 * Retrieves deleted entity IDs for a given entity type since a specified date.
 * Leverages the PostgreSQL-level EntityVersion records created on DELETE operations.
 */
export async function fetchDeletedIds(
  entityType: string,
  sinceDate: Date,
  limit: number = 2000
): Promise<string[]> {
  try {
    const deletedVersions = await basePrisma.entityVersion.findMany({
      where: {
        entityType,
        op: 'D',
        createdAt: { gt: sinceDate },
      },
      select: { entityId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    return Array.from(new Set(deletedVersions.map((v) => v.entityId)));
  } catch (error) {
    console.error(`[deltaSync] Error fetching deleted IDs for ${entityType}:`, error);
    return [];
  }
}

export interface DeltaEnvelope<T> {
  delta: boolean;
  items: T[];
  deletedIds: string[];
  syncedAt: string;
}

/**
 * Constructs a delta response envelope if a `sinceDate` is provided or if `forceEnvelope` is true.
 * Otherwise returns the raw items array for backwards compatibility.
 */
export function buildDeltaResponse<T>(
  items: T[],
  deletedIds: string[],
  sinceDate: Date | null,
  options?: { forceEnvelope?: boolean; syncedAt?: Date }
): T[] | DeltaEnvelope<T> {
  if (sinceDate !== null || options?.forceEnvelope) {
    return {
      delta: sinceDate !== null,
      items,
      deletedIds,
      syncedAt: (options?.syncedAt || new Date()).toISOString(),
    };
  }
  return items;
}

/**
 * Deletes EntityVersion and orphan ChangeSet records older than the specified retention days.
 * Executes deletions in chunks of 5,000 to avoid table locks on PostgreSQL / Neon.
 */
export async function purgeOldEntityVersions(days: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const CHUNK_SIZE = 5000;
  let totalVersionsDeleted = 0;

  try {
    // 1. Delete EntityVersion rows in chunks
    while (true) {
      const deletedChunk = await basePrisma.$executeRaw`
        DELETE FROM "EntityVersion"
        WHERE id IN (
          SELECT id FROM "EntityVersion"
          WHERE "createdAt" < ${cutoff}
          LIMIT ${CHUNK_SIZE}
        )
      `;
      totalVersionsDeleted += deletedChunk;
      if (deletedChunk < CHUNK_SIZE) break;
    }

    // 2. Delete orphan ChangeSet records that have no remaining EntityVersion records
    while (true) {
      const deletedChangeSets = await basePrisma.$executeRaw`
        DELETE FROM "ChangeSet"
        WHERE id IN (
          SELECT cs.id FROM "ChangeSet" cs
          LEFT JOIN "EntityVersion" ev ON cs.id = ev."changeSetId"
          WHERE cs."createdAt" < ${cutoff} AND ev.id IS NULL
          LIMIT ${CHUNK_SIZE}
        )
      `;
      if (deletedChangeSets < CHUNK_SIZE) break;
    }

    if (totalVersionsDeleted > 0) {
      console.log(`[deltaSync] Retention: removed ${totalVersionsDeleted} EntityVersion records older than ${days} days.`);
    }

    return totalVersionsDeleted;
  } catch (error) {
    console.error('[deltaSync] Retention purge failed:', error);
    return 0;
  }
}
