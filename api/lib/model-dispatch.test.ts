/**
 * Tests for provider dispatch.
 *
 * The dispatch layer is the single call site for both providers: it routes to
 * the OpenAI-compatible client or the WorkBuddy channel depending on the
 * configured kind. Credential resolution itself lives in
 * workbuddy/credential.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./openai", () => ({ callChatModel: vi.fn() }));
vi.mock("./workbuddy/chat", () => ({
  chatCompletion: vi.fn(),
  ensureSystemPrompt: (m: unknown) => m,
}));
vi.mock("./workbuddy/credential", () => ({
  resolveWorkbuddyToken: vi.fn(),
}));

import { callChatModel } from "./openai";
import { chatCompletion } from "./workbuddy/chat";
import { resolveWorkbuddyToken } from "./workbuddy/credential";
import { complete, providerKindOf } from "./model-dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("providerKindOf", () => {
  it("defaults to the OpenAI-compatible path", () => {
    expect(providerKindOf(null)).toBe("openai-compatible");
    expect(providerKindOf(undefined)).toBe("openai-compatible");
    expect(providerKindOf("")).toBe("openai-compatible");
    expect(providerKindOf("openai-compatible")).toBe("openai-compatible");
  });

  it("recognises the WorkBuddy channel", () => {
    expect(providerKindOf("workbuddy")).toBe("workbuddy");
  });

  it("treats an unknown value as the default rather than failing", () => {
    expect(providerKindOf("something-else")).toBe("openai-compatible");
  });
});

describe("complete", () => {
  it("routes an openai-compatible request to the generic client", async () => {
    vi.mocked(callChatModel).mockResolvedValue("hi");
    const text = await complete({
      kind: "openai-compatible",
      apiKey: "k",
      baseUrl: "https://api.test/v1",
      model: "m",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(text).toBe("hi");
    expect(callChatModel).toHaveBeenCalledTimes(1);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("routes a workbuddy request to the channel client", async () => {
    vi.mocked(resolveWorkbuddyToken).mockReturnValue({ accessToken: "tok", source: "dsh" });
    vi.mocked(chatCompletion).mockResolvedValue("日记");

    const text = await complete({
      kind: "workbuddy",
      model: "deepseek-v4.1-flash",
      productId: "workbuddy",
      messages: [{ role: "user", content: "写日记" }],
    });

    expect(text).toBe("日记");
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(callChatModel).not.toHaveBeenCalled();
  });

  it("fails with a clear message when no WorkBuddy credential is found", async () => {
    vi.mocked(resolveWorkbuddyToken).mockReturnValue({ accessToken: "", source: "none" });

    await expect(
      complete({
        kind: "workbuddy",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(/no credential was found/i);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
