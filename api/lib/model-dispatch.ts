/**
 * Model dispatch — one call site for every provider the diary can use.
 *
 * Two kinds of provider exist:
 *
 *   - `openai-compatible`: any endpoint speaking the OpenAI chat protocol,
 *     configured with a base URL and an API key.
 *   - `workbuddy`: the Tencent WorkBuddy gateway, reached with an OAuth token
 *     obtained through the in-app login flow. It speaks its own dialect
 *     (streaming-only, system prompt first), so it goes through the dedicated
 *     client in ./workbuddy rather than the generic one.
 *
 * Keeping the branch here means diary generation, Dream memory synthesis and
 * the settings-page probes all pick a provider the same way.
 */

import { callChatModel } from "./openai";
import { chatCompletion, ensureSystemPrompt } from "./workbuddy/chat";
import { productById } from "./workbuddy/product";
import type { WorkBuddyProduct } from "./workbuddy/product";

/** Which backend serves the request. */
export type ProviderKind = "openai-compatible" | "workbuddy";

export interface ModelRequest {
  kind: ProviderKind;
  /** OpenAI-compatible only. */
  apiKey?: string;
  /** OpenAI-compatible only. */
  baseUrl?: string;
  /** Model id, e.g. `gpt-4o-mini` or `deepseek-v4.1-flash`. */
  model?: string;
  /** WorkBuddy only: the access token from the login flow. */
  accessToken?: string;
  /** WorkBuddy only: which regional build to talk to. */
  productId?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Run a chat completion against whichever provider the request names.
 *
 * Throws when the request is missing the credentials its provider needs, so a
 * half-configured setting surfaces as a clear message instead of a 401 from
 * somewhere far away.
 */
export async function complete(request: ModelRequest): Promise<string> {
  if (request.kind === "workbuddy") {
    const product: WorkBuddyProduct = productById(request.productId);
    // What the settings layer stores is the serialized credential, not a bare
    // token: it carries the refresh token and expiry too. Accept either shape
    // so a caller passing a plain token still works.
    const accessToken = readAccessToken(request.accessToken);
    if (accessToken === "") {
      throw new Error(
        "WorkBuddy is selected but no credential is stored. Sign in again from Settings.",
      );
    }
    const model = request.model ?? "deepseek-v4.1-flash";
    return chatCompletion({
      product,
      accessToken,
      model,
      // The gateway requires a leading system message; normalise here so
      // callers cannot trip over it.
      messages: ensureSystemPrompt(request.messages),
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      timeoutMs: request.timeoutMs,
    });
  }

  return callChatModel({
    apiKey: request.apiKey ?? "",
    baseUrl: request.baseUrl,
    model: request.model,
    // callChatModel narrows the role union to system/user. A diary prompt never
    // carries an assistant turn, and the cast keeps the public request type
    // uniform across both providers.
    messages: request.messages as Array<{ role: "system" | "user"; content: string }>,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs,
  });
}

/**
 * Pull the bearer token out of a stored credential.
 *
 * The WorkBuddy credential is persisted as a JSON object (access token,
 * refresh token, expiry, account), because a refresh needs the extra fields.
 * Only the access token belongs in an Authorization header — sending the raw
 * JSON produces a 401 that looks like an auth failure but is really a shape
 * mismatch.
 */
export function readAccessToken(stored: string | null | undefined): string {
  if (typeof stored !== "string" || stored.trim() === "") return "";
  const trimmed = stored.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { access_token?: unknown };
    return typeof parsed.access_token === "string" ? parsed.access_token : "";
  } catch {
    return "";
  }
}

/**
 * Read the provider kind from a stored setting, defaulting to the
 * OpenAI-compatible path so existing configurations keep working untouched.
 */
export function providerKindOf(value: string | null | undefined): ProviderKind {
  return value === "workbuddy" ? "workbuddy" : "openai-compatible";
}
