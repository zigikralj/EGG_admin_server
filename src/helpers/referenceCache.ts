/**
 * In-memory cache for slowly changing reference entities.
 * Default TTL: 10 minutes (600,000 ms).
 * Used for Services, Categories, CompanyInfo, Roles, and WasteCatalog.
 */

interface CacheEntry<T = any> {
  expires: number;
  data: T;
}

const cache = new Map<string, CacheEntry>();
export const DEFAULT_REFERENCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getReferenceCache<T = any>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setReferenceCache<T = any>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_REFERENCE_TTL_MS
): void {
  cache.set(key, {
    expires: Date.now() + ttlMs,
    data,
  });
}

export function invalidateReferenceCache(key: string): void {
  cache.delete(key);
}

export function invalidateReferenceCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export function clearReferenceCache(): void {
  cache.clear();
}
