/**
 * Tests for the WorkBuddy channel: credential parsing, the system-prompt
 * requirement, and SSE assembly.
 *
 * These run without network access. The protocol quirks they lock down are the
 * two that cost the most debugging time against the real gateway:
 *
 *   - it refuses non-streaming requests (code 11101)
 *   - it refuses a conversation that does not open with a system message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({
  attributionHeaders: () => ({ "X-Domain": "example.test" }),
}));

import { ensureSystemPrompt } from "./chat";

describe("ensureSystemPrompt", () => {
  it("leaves a conversation that already opens with a system message alone", () => {
    const messages = [
      { role: "system" as const, content: "be kind" },
      { role: "user" as const, content: "hi" },
    ];
    expect(ensureSystemPrompt(messages)).toEqual(messages);
  });

  it("prepends a default system message when the first turn is a user message", () => {
    const result = ensureSystemPrompt([{ role: "user", content: "hi" }]);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("system");
    expect(result[0].content.trim()).not.toBe("");
    expect(result[1]).toEqual({ role: "user", content: "hi" });
  });

  it("replaces a blank system message rather than keeping it", () => {
    const result = ensureSystemPrompt([
      { role: "system", content: "   " },
      { role: "user", content: "hi" },
    ]);
    expect(result[0].role).toBe("system");
    expect(result[0].content.trim()).not.toBe("");
    // The blank one is dropped, not duplicated.
    expect(result.filter((m) => m.role === "system")).toHaveLength(1);
  });
});

describe("chatCompletion streaming", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  /** Build an SSE body from a list of delta payloads. */
  function sseBody(chunks: Array<{ content?: string; reasoning?: string }>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const events = chunks
      .map((chunk) =>
        "data: " +
        JSON.stringify({
          choices: [{ delta: { content: chunk.content, reasoning_content: chunk.reasoning } }],
        }) +
        "\n\n",
      )
      .join("");
    const all = ": heartbeat\n\n" + events + "data: [DONE]\n\n";
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(all));
        controller.close();
      },
    });
  }

  it("always sends stream:true, because the gateway rejects non-streaming", async () => {
    const { chatCompletion } = await import("./chat");
    fetchMock.mockResolvedValue({ ok: true, body: sseBody([{ content: "hi" }]) });

    await chatCompletion({
      product: {
        id: "workbuddy",
        displayName: "t",
        endpoint: "https://example.test",
        platform: "p",
        apiDomain: "example.test",
        productCode: "pc",
        userAgent: "ua",
        attributionName: "n",
        clientVersion: "1",
      },
      accessToken: "tok",
      model: "m",
      messages: [{ role: "user", content: "hello" }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    // And it opened the conversation with a system message.
    expect(body.messages[0].role).toBe("system");
  });

  it("assembles the reply from SSE chunks and drops reasoning deltas", async () => {
    const { chatCompletion } = await import("./chat");
    fetchMock.mockResolvedValue({
      ok: true,
      body: sseBody([
        { reasoning: "thinking hard" },
        { content: "晚霞" },
        { content: "很美" },
        { content: "。" },
      ]),
    });

    const text = await chatCompletion({
      product: {
        id: "workbuddy",
        displayName: "t",
        endpoint: "https://example.test",
        platform: "p",
        apiDomain: "example.test",
        productCode: "pc",
        userAgent: "ua",
        attributionName: "n",
        clientVersion: "1",
      },
      accessToken: "tok",
      model: "m",
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    });

    expect(text).toBe("晚霞很美。");
    expect(text).not.toContain("thinking hard");
  });

  it("surfaces the gateway error body on a non-2xx response", async () => {
    const { chatCompletion } = await import("./chat");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"code":11101,"msg":"Non-stream chat request is currently not supported"}',
    });

    await expect(
      chatCompletion({
        product: {
          id: "workbuddy",
          displayName: "t",
          endpoint: "https://example.test",
          platform: "p",
          apiDomain: "example.test",
          productCode: "pc",
          userAgent: "ua",
          attributionName: "n",
          clientVersion: "1",
        },
        accessToken: "tok",
        model: "m",
        messages: [{ role: "system", content: "s" }],
      }),
    ).rejects.toThrow(/11101/);
  });

  it("fails loudly when the reply carries no text", async () => {
    const { chatCompletion } = await import("./chat");
    fetchMock.mockResolvedValue({ ok: true, body: sseBody([{ reasoning: "only thinking" }]) });

    await expect(
      chatCompletion({
        product: {
          id: "workbuddy",
          displayName: "t",
          endpoint: "https://example.test",
          platform: "p",
          apiDomain: "example.test",
          productCode: "pc",
          userAgent: "ua",
          attributionName: "n",
          clientVersion: "1",
        },
        accessToken: "tok",
        model: "m",
        messages: [{ role: "system", content: "s" }],
      }),
    ).rejects.toThrow(/empty reply/);
  });
});
