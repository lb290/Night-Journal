/**
 * Renders the real user message and asserts the shape the model receives.
 *
 * This is the closest thing to "what the model actually sees" without calling
 * an external API, so it catches placeholder regressions and confirms the
 * timestamp is wall-clock rather than UTC.
 */

import { describe, it, expect } from "vitest";
import { buildDiaryUserMessage } from "./diary";
import { DEFAULT_DIARY_USER_TEMPLATE, DEFAULT_STYLE_PROMPTS } from "@contracts/prompts";
import { formatLocalDateTime } from "../lib/date";

const fragments = [
  {
    id: 26,
    contentText: "我的两只鹦鹉生病了，一只身上长虫了，另一只肠胃不好。",
    moodLabel: "sad",
    createdAt: new Date("2026-10-18T11:09:34.000Z"),
    attachments: [],
  },
];

describe("buildDiaryUserMessage", () => {
  const message = buildDiaryUserMessage(
    {
      date: "2026-10-18",
      language: "zh",
      style: "克制冷静",
      length: "短",
      stylePrompt: DEFAULT_STYLE_PROMPTS["克制冷静"],
      fragments,
      memory: null,
    },
    DEFAULT_DIARY_USER_TEMPLATE,
  );

  it("includes the date, style and fragments", () => {
    expect(message).toContain("2026-10-18");
    expect(message).toContain("克制冷静");
    expect(message).toContain("两只鹦鹉生病了");
  });

  it("leaves no unresolved placeholders", () => {
    expect(message).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  it("states the factual-source rule", () => {
    expect(message).toContain("唯一的事实来源");
  });
});

describe("wall-clock timestamps in prompts", () => {
  it("renders an evening fragment as evening, not UTC", () => {
    // The exact regression: 19:09 local must not read as 11:09
    const rendered = formatLocalDateTime(
      new Date("2026-10-18T11:09:34.000Z"),
      "Asia/Shanghai",
    );
    expect(rendered).toContain("19:09");
    expect(rendered).not.toContain("11:09");
  });
});
