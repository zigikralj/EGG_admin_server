/**
 * Date utility helpers used across route handlers.
 */

/**
 * Advances a date string by the given number of months.
 * Returns an ISO date string (YYYY-MM-DD).
 */
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the number of days from today until the given date string.
 * Negative values mean the date is in the past.
 */
export function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date(new Date().toDateString());
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

/**
 * Returns true if a project is considered "stale":
 * - it is not done, AND
 * - its start date is more than 2 months in the past.
 */
export function isStale(p: { done: boolean; start: string | null }): boolean {
  if (p.done || !p.start) return false;
  const start = new Date(p.start);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  return start < cutoff;
}
