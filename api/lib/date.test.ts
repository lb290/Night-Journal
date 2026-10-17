/**
 * Regression tests for calendar-day → MySQL DATE column binding.
 *
 * Root cause: `entry_date` / `diary_date` are MySQL DATE columns (no
 * timezone), but queries passed `new Date("YYYY-MM-DD")`. mysql2 serializes
 * a JS Date using the *local* timezone, so on a UTC+8 server the bound
 * parameter becomes "2026-10-17 08:00:00" — which never equals the stored
 * DATE value "2026-10-17". Every date lookup silently returned zero rows on
 * any non-UTC host.
 */

import { describe, it, expect, afterEach } from "vitest";
import { toDateColumnValue } from "./date";

describe("toDateColumnValue", () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("keeps a calendar day stable regardless of the server timezone", () => {
    process.env.TZ = "Asia/Shanghai";
    expect(toDateColumnValue("2026-10-17")).toBe("2026-10-17");

    process.env.TZ = "UTC";
    expect(toDateColumnValue("2026-10-17")).toBe("2026-10-17");
  });

  it("rejects malformed calendar days instead of silently coercing them", () => {
    expect(() => toDateColumnValue("2026-13-01")).toThrow();
    expect(() => toDateColumnValue("not-a-date")).toThrow();
    expect(() => toDateColumnValue("2026-1-1")).toThrow();
  });

  it("normalizes a Date instance to the calendar day in the given zone", () => {
    // 2026-10-16T16:00:00Z is 2026-10-17T00:00:00 at UTC+8
    const d = new Date("2026-10-16T16:00:00.000Z");
    expect(toDateColumnValue(d, "Asia/Shanghai")).toBe("2026-10-17");
    expect(toDateColumnValue(d, "UTC")).toBe("2026-10-16");
  });
});
