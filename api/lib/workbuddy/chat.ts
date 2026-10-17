/**
 * Streaming chat client for the WorkBuddy gateway.
 *
 * The endpoint only answers streaming requests: a non-streaming call comes
 * back with `code 11101, "Non-stream chat request is currently not
 * supported"`. So this client always sends `stream: true` and rebuilds the
 * reply from the SSE chunks.
 *
 * The conversation must also open with a system message, otherwise the
 * gateway rejects it with "first message is not system prompt". That is
 * enforced here rather than left to callers, since forgetting it produces a
 * confusing 400 far from the actual mistake.
 */

import { attributionHeaders } from "./auth";
import type { WorkBuddyProduct } from "./product";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  product: WorkBuddyProduct;
  accessToken: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Ensures the conversation starts with a system message, as the gateway
 * requires. A blank or missing system prompt gets a neutral default.
 */
export function ensureSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
  const first = messages[0];
  if (first !== undefined && first.role === "system" && first.content.trim() !== "") {
    return messages;
  }
  const rest = first !== undefined && first.role === "system" ? messages.slice(1) : messages;
  return [{ role: "system", content: "You are a helpful assistant." }, ...rest];
}

/**
 * Read an SSE stream and accumulate the assistant text.
 *
 * Reasoning deltas (`reasoning_content`) are deliberately dropped: they are
 * the model thinking aloud, not part of the diary.
 */
async function collectStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  try {
    for (;;) {
      if (signal?.aborted) throw new Error("WorkBuddy request aborted");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; keep the trailing partial.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string") text += delta;
          } catch {
            // A malformed chunk is not worth failing the whole reply over;
            // the surrounding chunks still carry the text.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}

/**
 * Send a chat completion and return the assembled assistant text.
 * Throws on transport errors, non-2xx responses, and empty replies.
 */
export async function chatCompletion(options: ChatOptions): Promise<string> {
  const { product, accessToken, model } = options;
  const messages = ensureSystemPrompt(options.messages);
  const url = `${product.endpoint}/v2/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
    // Mandatory: the gateway refuses non-streaming requests.
    stream: true,
  };
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...attributionHeaders(product),
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `WorkBuddy chat failed: HTTP ${res.status} ${detail.slice(0, 300)}`.trim(),
      );
    }
    if (!res.body) {
      throw new Error("WorkBuddy chat returned no body");
    }

    const text = await collectStream(res.body, options.signal);
    if (text.trim() === "") {
      throw new Error("WorkBuddy chat returned an empty reply");
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("WorkBuddy request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
