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
 * Deletes EntityVersion and orphan ChangeSet records older than the specified retention days,
 * while safely preserving entity history reconstruction and audit tampering constraints:
 * 1. Enables audit cleanup locally within the transaction (`set_config('audit.allow_cleanup', 'true', true)`).
 * 2. Only purges EntityVersion rows older than cutoff IF:
 *    a) A newer keyframe snapshot ('S') exists before or at cutoff (the version belongs to a superseded epoch), OR
 *    b) The entity was deleted ('D') and its deletion is older than cutoff.
 *    Active entities with no newer snapshot retain their baseline snapshot indefinitely.
 * 3. Deletes orphan ChangeSet records whose associated versions have been purged.
 * Executes deletions in chunks of 5,000 to avoid table locks.
 */
export async function purgeOldEntityVersions(days: number = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const CHUNK_SIZE = 5000;
  let totalVersionsDeleted = 0;

  try {
    // 1. Delete eligible EntityVersion rows in chunks inside transactions
    while (true) {
      const deletedChunk = await basePrisma.$transaction(async (tx) => {
        // Set local audit cleanup flag for tampering prevention trigger
        await tx.$executeRawUnsafe(`SELECT set_config('audit.allow_cleanup', 'true', true)`);

        return await tx.$executeRaw`
          DELETE FROM "EntityVersion"
          WHERE id IN (
            SELECT ev.id FROM "EntityVersion" ev
            WHERE ev."createdAt" < ${cutoff}
              AND (
                -- Case A: Belonging to a superseded epoch (newer snapshot exists before cutoff)
                EXISTS (
                  SELECT 1 FROM "EntityVersion" s
                  WHERE s."entityType" = ev."entityType"
                    AND s."entityId" = ev."entityId"
                    AND s.kind = 'S'
                    AND s.version > ev.version
                    AND s."createdAt" < ${cutoff}
                )
                OR
                -- Case B: Entity was deleted and deletion is older than cutoff
                (
                  (
                    SELECT last_ev.op FROM "EntityVersion" last_ev
                    WHERE last_ev."entityType" = ev."entityType"
                      AND last_ev."entityId" = ev."entityId"
                    ORDER BY last_ev.version DESC
                    LIMIT 1
                  ) = 'D'
                  AND
                  (
                    SELECT last_ev."createdAt" FROM "EntityVersion" last_ev
                    WHERE last_ev."entityType" = ev."entityType"
                      AND last_ev."entityId" = ev."entityId"
                    ORDER BY last_ev.version DESC
                    LIMIT 1
                  ) < ${cutoff}
                )
              )
            LIMIT ${CHUNK_SIZE}
          )
        `;
      });

      totalVersionsDeleted += deletedChunk;
      if (deletedChunk < CHUNK_SIZE) break;
    }

    // 2. Delete orphan ChangeSet records that have no remaining EntityVersion records
    while (true) {
      const deletedChangeSets = await basePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('audit.allow_cleanup', 'true', true)`);

        return await tx.$executeRaw`
          DELETE FROM "ChangeSet"
          WHERE id IN (
            SELECT cs.id FROM "ChangeSet" cs
            LEFT JOIN "EntityVersion" ev ON cs.id = ev."changeSetId"
            WHERE cs."createdAt" < ${cutoff} AND ev.id IS NULL
            LIMIT ${CHUNK_SIZE}
          )
        `;
      });

      if (deletedChangeSets < CHUNK_SIZE) break;
    }

    // 3. Purge soft-deleted ChatMessage tombstones older than cutoff that have no remaining replies
    await basePrisma.chatMessage.deleteMany({
      where: {
        isDeleted: true,
        updatedAt: { lt: cutoff },
        replies: { none: {} },
      },
    });

    if (totalVersionsDeleted > 0) {
      console.log(`[deltaSync] Retention: safely removed ${totalVersionsDeleted} superseded EntityVersion records older than ${days} days.`);
    }

    return totalVersionsDeleted;
  } catch (error) {
    console.error('[deltaSync] Retention purge failed:', error);
    return 0;
  }
}
