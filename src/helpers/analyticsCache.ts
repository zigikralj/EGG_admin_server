/**
 * In-memory response cache for activity analytics.
 * Default TTL: 60 seconds.
 * Cleared on activity log mutations (clear-all, bulk-delete, session delete, delete).
 */

interface CacheEntry<T = any> {
  expires: number;
  data: T;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60_000;

export function getAnalyticsCache<T = any>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setAnalyticsCache<T = any>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, {
    expires: Date.now() + ttlMs,
    data,
  });
}

export function clearAnalyticsCache(): void {
  cache.clear();
}
