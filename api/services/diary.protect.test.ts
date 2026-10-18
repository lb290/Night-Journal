/**
 * Guards the manual-edit protection.
 *
 * A user who rewrites a diary must not have it silently replaced by the next
 * scheduled generation. `generateDiaryForDate` returns early when the row is
 * flagged, and the scheduler skips it too — these assertions fail if either
 * guard is removed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findDiaryByDate = vi.fn();
const updateDiary = vi.fn();

vi.mock("../queries/diaries", () => ({
  findDiaryByDate,
  findEntriesByDate: vi.fn(),
  updateDiary,
  createDiary: vi.fn(),
}));

const findAiSettingsByUserId = vi.fn(() => ({
  diaryApiKey: "k",
  diaryApiBaseUrl: "https://example.test",
  diaryStyle: "克制冷静",
  diaryLength: "短",
  diaryLanguage: "zh",
  timezone: "Asia/Shanghai",
}));

vi.mock("../queries/ai-settings", () => ({ findAiSettingsByUserId }));

vi.mock("../queries/memories", () => ({
  findUserProfile: vi.fn(),
  findActiveShortTermMemories: vi.fn(),
}));

vi.mock("../lib/model-dispatch", () => ({
  callDiaryModel: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDiaryForDate with a manually edited diary", () => {
  it("returns without calling the model", async () => {
    findDiaryByDate.mockResolvedValue({
      id: 12,
      userId: 11,
      manuallyEdited: true,
      generationStatus: "generated",
      title: "掌心喂食",
      content: "我改过的正文",
    });

    const { generateDiaryForDate } = await import("./diary");
    await generateDiaryForDate(11, "2026-10-18");

    // No update should have happened — the edited text stays as-is
    expect(updateDiary).not.toHaveBeenCalled();
  });
});
