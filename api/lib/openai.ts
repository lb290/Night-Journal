/**
 * OpenAI-compatible API helpers for testing connections and calling vision models.
 */

import { isPrivateHost, isPrivateResolvedHost } from "./url-guard";
import { env } from "./env";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  model: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, "");
  // If user provides base like https://api.openai.com/v1, keep as-is
  // If they provide https://api.openai.com, append /v1
  if (!url.endsWith("/v1")) {
    url += "/v1";
  }
  return url;
}

/**
 * Is this endpoint explicitly allowlisted for private-network use?
 *
 * Self-hosted deployments often run an OpenAI-compatible gateway on loopback
 * (e.g. 127.0.0.1:8326). Operators opt in per endpoint through
 * ALLOW_PRIVATE_MODEL_HOSTS so the SSRF guard stays on for everything else.
 */
function isAllowlistedPrivateHost(hostname: string, port: string): boolean {
  const allowed = env.privateHostAllowlist;
  if (allowed.size === 0) return false;
  const host = hostname.toLowerCase();
  const effectivePort = port !== "" ? port : "80";
  return allowed.has(host) || allowed.has(`${host}:${effectivePort}`);
}

async function validateBaseUrl(baseUrl: string): Promise<void> {
  const normalized = normalizeBaseUrl(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Invalid API base URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("API base URL must use http or https");
  }

  // An explicit allowlist entry wins over the private-range check below. This
  // keeps the default posture (block loopback/RFC1918) while letting a
  // self-hosted operator point at their own local gateway.
  if (isAllowlistedPrivateHost(parsed.hostname, parsed.port)) {
    return;
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new Error("API base URL must not point to a private/internal network address");
  }

  if (await isPrivateResolvedHost(parsed.hostname)) {
    throw new Error("API base URL resolves to a private/internal network address");
  }
}

/**
 * Test an OpenAI-compatible API connection by making a minimal chat completion request.
 * Returns the model's reply on success, throws on failure.
 */
export async function testModelConnection(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ success: true; model: string; message: string }> {
  const rawBase = opts.baseUrl || "https://api.openai.com";
  await validateBaseUrl(rawBase);
  const base = normalizeBaseUrl(rawBase);
  const model = opts.model || "gpt-4o-mini";
  const url = `${base}/chat/completions`;

  const body = {
    model,
    // Some gateways (e.g. WorkBuddy) reject a conversation that does not open
    // with a system message, so lead with one. It also matches how the real
    // diary call is shaped, making the probe representative.
    messages: [
      { role: "system", content: "You are a connectivity probe. Reply briefly." },
      { role: "user", content: "Hi. Reply with exactly: ok" },
    ] as ChatMessage[],
    max_tokens: 4,
    temperature: 0,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = "";
      try {
        const json = JSON.parse(text);
        detail = json.error?.message || json.message || text.slice(0, 200);
      } catch {
        detail = text.slice(0, 200);
      }
      throw new Error(`API returned ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const reply = data.choices?.[0]?.message?.content ?? "";
    return {
      success: true,
      model: data.model || model,
      message: `连接成功，模型回复: ${reply.trim()}`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("连接超时（15秒），请检查 API Base URL 是否正确");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call a vision model to analyze an image.
 * Sends the image as a base64 data URL along with context text.
 */
export async function callVisionModel(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
}): Promise<string> {
  const rawBase = opts.baseUrl || "https://api.openai.com";
  await validateBaseUrl(rawBase);
  const base = normalizeBaseUrl(rawBase);
  const model = opts.model || "gpt-4o";
  const url = `${base}/chat/completions`;

  const dataUrl = `data:${opts.imageMimeType};base64,${opts.imageBase64}`;

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ] as ChatMessage[],
    max_tokens: 1024,
    temperature: 0.3,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vision API returned ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call a generic chat completion model with a system/user message pair.
 * Used for diary generation.
 */
export async function callChatModel(opts: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const rawBase = opts.baseUrl || "https://api.openai.com";
  await validateBaseUrl(rawBase);
  const base = normalizeBaseUrl(rawBase);
  const model = opts.model || "gpt-4o-mini";
  const url = `${base}/chat/completions`;

  const body = {
    model,
    messages: opts.messages as ChatMessage[],
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Chat API returned ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("聊天 API 请求超时");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
