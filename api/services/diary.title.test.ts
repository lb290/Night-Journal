/**
 * Tests for diary title quality.
 *
 * Regression: the prompt said nothing about titles, so the model returned
 * "十月十八日" (a date), "画完了" (a flat label), and only occasionally
 * something with an image. The prompt now spells out the rules, and this
 * module rejects the obvious non-titles as a safety net.
 */

import { describe, it, expect } from "vitest";
import { isUsableTitle, deriveFallbackTitle, parseDiaryResponse } from "./diary";

describe("isUsableTitle", () => {
  it("rejects a bare Chinese date", () => {
    expect(isUsableTitle("十月十八日")).toBe(false);
    expect(isUsableTitle("十月十八")).toBe(false);
    expect(isUsableTitle("正月初一")).toBe(false);
  });

  it("rejects a bare numeric date", () => {
    expect(isUsableTitle("2026-10-18")).toBe(false);
    expect(isUsableTitle("2026/10/18")).toBe(false);
    expect(isUsableTitle("10月18日")).toBe(false);
    expect(isUsableTitle("10-18")).toBe(false);
  });

  it("rejects generic filler words", () => {
    for (const t of ["日记", "记录", "今天", "今日", "一天", "日常", "无题", "随记"]) {
      expect(isUsableTitle(t)).toBe(false);
    }
  });

  it("rejects an overlong title", () => {
    expect(isUsableTitle("一".repeat(25))).toBe(false);
  });

  it("rejects empty or whitespace", () => {
    expect(isUsableTitle("")).toBe(false);
    expect(isUsableTitle("   ")).toBe(false);
  });

  it("accepts titles with a concrete image", () => {
    expect(isUsableTitle("掌心喂食")).toBe(true);
    expect(isUsableTitle("交画之前")).toBe(true);
    expect(isUsableTitle("摸到软软的肚子")).toBe(true);
    expect(isUsableTitle("灯亮了一下")).toBe(true);
  });

  it("accepts a title that merely contains a number", () => {
    // "两只鹦鹉" is concrete, not a date
    expect(isUsableTitle("两只鹦鹉")).toBe(true);
  });
});

describe("deriveFallbackTitle", () => {
  it("takes the first clause of the opening paragraph", () => {
    expect(deriveFallbackTitle("两只鹦鹉生病了。一只身上长了虫。")).toBe("两只鹦鹉生病了");
  });

  it("skips leading blank lines", () => {
    expect(deriveFallbackTitle("\n\n仓鼠叫小毛球。有空我就摸摸它。")).toBe("仓鼠叫小毛球");
  });

  it("truncates a long opening clause", () => {
    const title = deriveFallbackTitle(
      "今天上午十一点左右我把谷物放在掌心喂它们然后看着它们慢慢吃完",
    );
    expect(title.length).toBeLessThanOrEqual(12);
  });

  it("falls back to a placeholder for empty content", () => {
    expect(deriveFallbackTitle("")).toBe("无题");
    expect(deriveFallbackTitle("   \n  ")).toBe("无题");
  });
});

describe("parseDiaryResponse title handling", () => {
  const body = "两只鹦鹉生病了。\n\n上午我把谷物放在掌心喂它们。";

  it("keeps a good title", () => {
    const raw = JSON.stringify({ title: "掌心喂食", summary: "s", content: body });
    expect(parseDiaryResponse(raw)?.title).toBe("掌心喂食");
  });

  it("replaces a date-as-title with one derived from the body", () => {
    const raw = JSON.stringify({ title: "十月十八日", summary: "s", content: body });
    expect(parseDiaryResponse(raw)?.title).toBe("两只鹦鹉生病了");
  });

  it("replaces a generic title", () => {
    const raw = JSON.stringify({ title: "日记", summary: "s", content: body });
    const parsed = parseDiaryResponse(raw);
    expect(parsed?.title).not.toBe("日记");
    expect(parsed?.title).toBe("两只鹦鹉生病了");
  });

  it("leaves the body untouched when replacing a title", () => {
    const raw = JSON.stringify({ title: "2026-10-18", summary: "s", content: body });
    expect(parseDiaryResponse(raw)?.content).toBe(body);
  });

  it("still returns null for an unparseable response", () => {
    expect(parseDiaryResponse("not json")).toBeNull();
  });
});
