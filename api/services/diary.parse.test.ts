/**
 * Regression tests for newline decoding in generated diary content.
 *
 * Root cause: models frequently return content whose newlines are escaped
 * twice ("line1\\nline2"). After JSON.parse the value still contains the
 * literal two-character sequence backslash+n, so the rendered diary collapses
 * into a single unbroken paragraph.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/env", () => ({
  env: {
    appSecret: "test-secret-that-is-long-enough-32c",
    databaseUrl: "mysql://root:pw@localhost/db",
    isProduction: false,
    ownerUnionId: "",
  },
}));

vi.mock("../queries/entries", () => ({
  findEntriesByDate: vi.fn(),
  updateEntry: vi.fn(),
}));
vi.mock("../queries/ai-settings", () => ({
  findAiSettingsByUserId: vi.fn(),
}));
vi.mock("../queries/diaries", () => ({
  findDiaryByDate: vi.fn(),
  updateDiary: vi.fn(),
}));
vi.mock("../queries/memories", () => ({
  findProfileByUserId: vi.fn(),
  findActiveShortTermMemories: vi.fn(),
}));
vi.mock("../lib/openai", () => ({
  callChatModel: vi.fn(),
}));
vi.mock("./dream", () => ({
  dreamProfile: vi.fn(),
}));

import { parseDiaryResponse } from "./diary";

describe("parseDiaryResponse newline decoding", () => {
  it("turns literal backslash-n sequences into real newlines", () => {
    // The model returns JSON whose content field carries an extra level of
    // escaping, so JSON.parse leaves a literal backslash+n in the string.
    const raw = JSON.stringify({
      title: "下午的安静",
      summary: "咖啡馆里的一小时",
      content: "第一段。\\n\\n第二段。",
    });

    const parsed = parseDiaryResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.content).not.toContain("\\n");
    expect(parsed!.content.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("preserves real newlines that already arrived correctly", () => {
    const raw = JSON.stringify({
      title: "标题",
      summary: "摘要",
      content: "第一段。\n\n第二段。",
    });
    const parsed = parseDiaryResponse(raw);
    expect(parsed!.content.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("returns null when title or content is missing", () => {
    expect(parseDiaryResponse(JSON.stringify({ title: "", content: "x" }))).toBeNull();
    expect(parseDiaryResponse(JSON.stringify({ title: "t", content: "" }))).toBeNull();
  });
});
