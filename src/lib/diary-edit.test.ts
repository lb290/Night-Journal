/**
 * Tests for the diary editor's save-gating rules.
 *
 * The editor must not let a user save an empty body (that would wipe the
 * diary), and it must not fire a request when nothing changed. These are the
 * two conditions that decide whether the save button is enabled.
 */

import { describe, it, expect } from "vitest";

/** Mirrors the `dirty` computation in DiaryEditor. */
function isDirty(
  current: { title: string; summary: string; content: string },
  initial: { title: string; summary: string; content: string },
): boolean {
  return (
    current.title !== initial.title ||
    current.summary !== initial.summary ||
    current.content !== initial.content
  );
}

/** Mirrors the `canSave` computation in DiaryEditor. */
function canSave(
  current: { title: string; summary: string; content: string },
  initial: { title: string; summary: string; content: string },
  isSaving: boolean,
): boolean {
  return current.content.trim().length > 0 && isDirty(current, initial) && !isSaving;
}

const initial = {
  title: "两只鹦鹉生病了",
  summary: "鹦鹉生病，仓鼠和小火龙照常",
  content: "两只鹦鹉生病了。\n\n上午我把谷物放在掌心喂它们。",
};

describe("dirty detection", () => {
  it("is false when nothing changed", () => {
    expect(isDirty(initial, initial)).toBe(false);
  });

  it("detects a title-only change", () => {
    expect(isDirty({ ...initial, title: "掌心喂食" }, initial)).toBe(true);
  });

  it("detects a summary-only change", () => {
    expect(isDirty({ ...initial, summary: "改过的摘要" }, initial)).toBe(true);
  });

  it("detects a body-only change", () => {
    expect(isDirty({ ...initial, content: "完全不同的正文" }, initial)).toBe(true);
  });

  it("treats whitespace-only differences as a change (save then trims)", () => {
    expect(isDirty({ ...initial, content: `${initial.content} ` }, initial)).toBe(true);
  });
});

describe("save gating", () => {
  it("allows saving a real edit", () => {
    expect(canSave({ ...initial, title: "掌心喂食" }, initial, false)).toBe(true);
  });

  it("blocks saving when nothing changed", () => {
    expect(canSave(initial, initial, false)).toBe(false);
  });

  it("blocks saving an empty body", () => {
    expect(canSave({ ...initial, content: "" }, initial, false)).toBe(false);
  });

  it("blocks saving a whitespace-only body", () => {
    expect(canSave({ ...initial, content: "   \n\t  " }, initial, false)).toBe(false);
  });

  it("blocks a second save while one is in flight", () => {
    expect(canSave({ ...initial, title: "改" }, initial, true)).toBe(false);
  });

  it("allows clearing the title (title is optional)", () => {
    expect(canSave({ ...initial, title: "" }, initial, false)).toBe(true);
  });

  it("allows clearing the summary", () => {
    expect(canSave({ ...initial, summary: "" }, initial, false)).toBe(true);
  });
});

describe("payload trimming", () => {
  it("trims surrounding whitespace before saving", () => {
    const draft = { title: "  掌心喂食  ", summary: " 摘要 ", content: " 正文 " };
    const payload = {
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      content: draft.content.trim(),
    };
    expect(payload).toEqual({ title: "掌心喂食", summary: "摘要", content: "正文" });
  });
});
