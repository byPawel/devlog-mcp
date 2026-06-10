/**
 * Shared UTC timestamp formatting helpers.
 *
 * Every component (date, time, weekday, week number) is derived from UTC so
 * the pieces always agree with each other. This avoids the classic bug of
 * mixing `toISOString()` (UTC) dates with `toLocaleDateString()` (local
 * timezone) weekday names, which disagree around UTC midnight.
 */

const MS_PER_DAY = 86_400_000;

const UTC_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  timeZone: 'UTC',
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format a timestamp slug as `YYYY-MM-DD-HHhMM-dayname`,
 * e.g. `2026-06-10-22h23-wednesday`.
 *
 * All components are derived from UTC: the calendar date, the 24-hour
 * zero-padded time, and the lowercased `en-US` weekday name computed for
 * the same UTC date (never the local-timezone weekday).
 */
export function formatTimestampSlug(date: Date): string {
  const weekday = UTC_WEEKDAY_FORMAT.format(date).toLowerCase();
  return `${dateStamp(date)}-${pad2(date.getUTCHours())}h${pad2(date.getUTCMinutes())}-${weekday}`;
}

/**
 * Format an ISO-8601 week directory name as `YYYY-Www`, e.g. `2026-W24`.
 *
 * Uses the ISO week NUMBER and ISO week-YEAR (not the calendar year):
 * Dec 29-31 can fall in W01 of the next year, and Jan 1-3 can fall in
 * W52/W53 of the previous year. Computed entirely in UTC.
 */
export function isoWeekDir(date: Date): string {
  // Work on a copy holding only the UTC calendar date.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weekday: Monday = 1 ... Sunday = 7.
  const isoDay = d.getUTCDay() || 7;
  // Shift to the Thursday of this ISO week; its calendar year is the ISO week-year.
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const weekYear = d.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${weekYear}-W${pad2(week)}`;
}

/**
 * Format a month directory name as `YYYY-MM` (UTC), e.g. `2026-06`.
 */
export function monthDir(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

/**
 * Format a calendar date stamp as `YYYY-MM-DD` (UTC), e.g. `2026-06-10`.
 */
export function dateStamp(date: Date): string {
  return `${monthDir(date)}-${pad2(date.getUTCDate())}`;
}
