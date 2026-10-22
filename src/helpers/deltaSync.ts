import { basePrisma } from '../db';

/**
 * Validates and parses a raw query parameter into a Date object.
 * Returns null if the value is missing, empty, or not a valid date.
 */
export function parseSince(raw?: unknown): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;

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
