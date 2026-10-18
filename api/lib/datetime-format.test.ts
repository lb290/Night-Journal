/**
 * Tests for rendering instants in the user's own timezone.
 *
 * Regression: the vision prompt used `new Date().toISOString()`, so a fragment
 * recorded at 19:09 in UTC+8 reached the model as "11:09Z" with no zone. The
 * model read it as local time and the diary said "上午十一点左右" — a fact the
 * user never wrote. These tests pin the wall-clock behaviour.
 */

import { describe, it, expect } from "vitest";
import { formatLocalDateTime, isValidTimeZone, DEFAULT_TIME_ZONE } from "./date";

describe("formatLocalDateTime", () => {
  it("renders an evening instant as evening, not UTC", () => {
    // 2026-10-18 19:09 in Shanghai
    const instant = new Date("2026-10-18T11:09:34.000Z");
    const rendered = formatLocalDateTime(instant, "Asia/Shanghai");

    expect(rendered).toContain("2026-10-18 19:09");
    expect(rendered).not.toContain("11:09");
  });

  it("states the zone so the model cannot reinterpret it as UTC", () => {
    const rendered = formatLocalDateTime(
      new Date("2026-10-18T11:09:34.000Z"),
      "Asia/Shanghai",
    );
    expect(rendered).toContain("Asia/Shanghai");
  });

  it("respects a different user timezone", () => {
    const instant = new Date("2026-10-18T11:09:34.000Z");
    expect(formatLocalDateTime(instant, "UTC")).toContain("11:09");
    expect(formatLocalDateTime(instant, "America/New_York")).toContain("07:09");
  });

  it("falls back to the default zone when none is configured", () => {
    const instant = new Date("2026-10-18T11:09:34.000Z");
    expect(formatLocalDateTime(instant, null)).toContain(DEFAULT_TIME_ZONE);
    expect(formatLocalDateTime(instant, undefined)).toContain(DEFAULT_TIME_ZONE);
  });

  it("falls back to the default zone for an invalid zone name", () => {
    const instant = new Date("2026-10-18T11:09:34.000Z");
    expect(() => formatLocalDateTime(instant, "Not/AZone")).not.toThrow();
    expect(formatLocalDateTime(instant, "Not/AZone")).toContain(DEFAULT_TIME_ZONE);
  });

  it("crosses the date boundary correctly", () => {
    // 23:30 UTC on the 18th is 07:30 on the 19th in Shanghai
    const instant = new Date("2026-10-18T23:30:00.000Z");
    expect(formatLocalDateTime(instant, "Asia/Shanghai")).toContain("2026-10-19 07:30");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("rejects junk and empty values", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});
