/**
 * Guards the title guidance in the default diary prompt.
 *
 * The prompt previously said nothing about titles, which is why the model
 * returned "十月十八日" for one entry and a flat "画完了" for another. These
 * assertions fail loudly if the rules are ever dropped in a refactor.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_DIARY_SYSTEM_PROMPT } from "@contracts/prompts";

describe("default diary prompt: title guidance", () => {
  const prompt = DEFAULT_DIARY_SYSTEM_PROMPT;

  it("has a dedicated title section", () => {
    expect(prompt).toContain("标题怎么写");
  });

  it("forbids dates as titles", () => {
    expect(prompt).toMatch(/禁止用日期当标题/);
  });

  it("forbids generic filler words", () => {
    expect(prompt).toMatch(/日记.*记录.*一天.*今天/);
  });

  it("asks for a concrete image rather than a mood summary", () => {
    expect(prompt).toMatch(/具体的动作、物件或细节/);
  });

  it("specifies a length range", () => {
    expect(prompt).toMatch(/4 到 10 个字/);
  });

  it("keeps the factual discipline intact", () => {
    // The title rules must not weaken the no-invention rule
    expect(prompt).toContain("唯一的事实来源是「今日碎片」");
    expect(prompt).toMatch(/不许出现碎片里没有的事实/);
  });

  it("still asks for JSON with a title field", () => {
    expect(prompt).toContain('"title"');
  });
});
