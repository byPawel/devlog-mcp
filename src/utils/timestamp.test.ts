import { formatTimestampSlug, isoWeekDir, monthDir, dateStamp } from './timestamp.js';

describe('formatTimestampSlug', () => {
  it('formats a normal mid-day UTC date', () => {
    const d = new Date(Date.UTC(2026, 5, 10, 22, 23)); // 2026-06-10T22:23Z, Wednesday
    expect(formatTimestampSlug(d)).toBe('2026-06-10-22h23-wednesday');
  });

  it('uses the UTC weekday just after UTC midnight (TZs behind UTC would say tuesday)', () => {
    // 2026-06-10T00:05Z is Wednesday in UTC, but still Tuesday in e.g. America/Los_Angeles.
    const d = new Date(Date.UTC(2026, 5, 10, 0, 5));
    expect(formatTimestampSlug(d)).toBe('2026-06-10-00h05-wednesday');
  });

  it('uses the UTC weekday just before UTC midnight (TZs ahead of UTC would say wednesday)', () => {
    // 2026-06-09T23:30Z is Tuesday in UTC, but already Wednesday in e.g. Europe/Warsaw.
    const d = new Date(Date.UTC(2026, 5, 9, 23, 30));
    expect(formatTimestampSlug(d)).toBe('2026-06-09-23h30-tuesday');
  });

  it('zero-pads hour and minute', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 3, 7)); // Monday
    expect(formatTimestampSlug(d)).toBe('2026-01-05-03h07-monday');
  });
});

describe('isoWeekDir', () => {
  it('formats a mid-year week', () => {
    expect(isoWeekDir(new Date(Date.UTC(2026, 5, 10)))).toBe('2026-W24');
  });

  it('assigns late-December dates to W01 of the NEXT ISO week-year', () => {
    // 2024-12-30 (Monday) belongs to ISO week 2025-W01.
    expect(isoWeekDir(new Date(Date.UTC(2024, 11, 30)))).toBe('2025-W01');
  });

  it('assigns early-January dates to W52/W53 of the PREVIOUS ISO week-year', () => {
    // 2027-01-01 (Friday) belongs to ISO week 2026-W53.
    expect(isoWeekDir(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
    // 2021-01-01 (Friday) belongs to ISO week 2020-W53.
    expect(isoWeekDir(new Date(Date.UTC(2021, 0, 1)))).toBe('2020-W53');
  });

  it('keeps in-year boundary dates in the current ISO week-year', () => {
    // 2026-12-28 (Monday) is the start of 2026-W53.
    expect(isoWeekDir(new Date(Date.UTC(2026, 11, 28)))).toBe('2026-W53');
    // 2025-01-01 (Wednesday) is in 2025-W01.
    expect(isoWeekDir(new Date(Date.UTC(2025, 0, 1)))).toBe('2025-W01');
  });

  it('handles a Sunday at the year boundary (ISO weekday 7 branch)', () => {
    // 2023-01-01 is a Sunday; its ISO week's Thursday is 2022-12-29 -> 2022-W52.
    expect(isoWeekDir(new Date(Date.UTC(2023, 0, 1)))).toBe('2022-W52');
  });

  it('zero-pads the week number', () => {
    expect(isoWeekDir(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-W02');
  });
});

describe('monthDir', () => {
  it('formats year and zero-padded month in UTC', () => {
    expect(monthDir(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
    expect(monthDir(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('2026-12');
  });
});

describe('dateStamp', () => {
  it('formats the UTC calendar date with zero padding', () => {
    expect(dateStamp(new Date(Date.UTC(2026, 5, 10, 22, 23)))).toBe('2026-06-10');
    expect(dateStamp(new Date(Date.UTC(2026, 0, 5, 0, 0)))).toBe('2026-01-05');
  });
});
