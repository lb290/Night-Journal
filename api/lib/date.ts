/**
 * Calendar-day helpers for MySQL DATE columns.
 *
 * MySQL `DATE` columns carry no timezone: "2026-10-17" means that calendar
 * day, always. Binding a JS `Date` instead lets the driver decide, and mysql2
 * serializes Dates using the *local* timezone — so on a UTC+8 server the
 * parameter becomes "2026-10-17 08:00:00" and never matches the stored DATE.
 * The fix is to always bind the calendar day as a plain "YYYY-MM-DD" string.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  // Reject days that don't exist in the given month (e.g. 2026-02-30).
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * Convert a calendar day (or a Date) into the "YYYY-MM-DD" string that maps
 * 1:1 onto a MySQL DATE column, independent of the server timezone.
 *
 * @param value  A "YYYY-MM-DD" string, or a Date to normalize.
 * @param timeZone  IANA zone used when converting a Date (defaults to UTC,
 *                  matching how Drizzle reads DATE columns back).
 */
export function toDateColumnValue(value: string | Date, timeZone = "UTC"): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid date: cannot convert NaN Date to a DATE column value");
    }
    // en-CA renders as YYYY-MM-DD, which is exactly the DATE literal format.
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
    if (!isValidCalendarDay(formatted)) {
      throw new Error(`Invalid date: "${formatted}" is not a calendar day`);
    }
    return formatted;
  }

  const trimmed = value.trim();
  if (!isValidCalendarDay(trimmed)) {
    throw new Error(
      `Invalid calendar day: "${value}". Expected YYYY-MM-DD (e.g. 2026-10-17).`,
    );
  }
  return trimmed;
}

/**
 * First and last calendar day of a month, as DATE-column strings.
 * Used by the month-range queries instead of local-midnight Date objects.
 */
export function monthRange(year: number, month: number): { start: string; end: string } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Invalid year: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${nextYear}-${pad(nextMonth)}-01`,
  };
}
