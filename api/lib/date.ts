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

/** Default zone for a self-hosted, single-household deployment. */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

/**
 * Render an instant as a wall-clock time in the user's own timezone.
 *
 * `Date#toISOString()` produces UTC, which is the wrong thing to hand a model
 * that is asked about "when was this recorded": a fragment saved at 19:09 in
 * UTC+8 was described as "上午十一点左右" because the vision model received
 * "11:09Z" with no zone attached and assumed it was local time.
 *
 * The output is deliberately explicit — "2026-10-18 19:09" plus the zone — so
 * the model cannot silently reinterpret it as UTC.
 *
 * @param instant  The moment to render.
 * @param timeZone IANA zone; falls back to DEFAULT_TIME_ZONE when unset/invalid.
 */
export function formatLocalDateTime(
  instant: Date,
  timeZone: string | null | undefined = DEFAULT_TIME_ZONE,
): string {
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : DEFAULT_TIME_ZONE;

  // sv-SE renders as "YYYY-MM-DD HH:mm", which is both unambiguous and the
  // format the prompts already use for dates.
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);

  return `${formatted}（${zone}）`;
}

/** Guard against an invalid IANA name reaching Intl and throwing. */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
