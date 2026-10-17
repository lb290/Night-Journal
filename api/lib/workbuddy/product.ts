/**
 * WorkBuddy channel — a first-party client for the Tencent WorkBuddy
 * gateway, so the diary can use those models without any external plugin.

 * Protocol notes (reverse-engineered from the WorkBuddy CLI / IDE client):

 *   POST /v2/plugin/auth/state?platform=<platform>   → { state, authUrl }
 *   GET  /v2/plugin/auth/token?state=<state>         → poll for the token
 *   GET  /v2/plugin/login/account?state=<state>      → poll for the account
 *   POST /v2/plugin/auth/token/refresh               → refresh an access token
 *   POST /v2/chat/completions                        → streaming chat (stream:true only)

 * Two details cost real debugging time and are easy to lose:

 *   1. The chat endpoint refuses non-streaming requests outright
 *      (code 11101). Every call must send `stream: true` and be
 *      assembled from SSE chunks locally.
 *   2. The conversation must open with a system message. Without one the
 *      gateway answers "first message is not system prompt".

 * The region decides the model pool, and the pool is a property of the
 * endpoint: the international build serves gpt/gemini/claude families, the
 * China build serves glm/hy/deepseek families. Hence two products, not one.
 */

/** Region-specific product configuration. */
export interface WorkBuddyProduct {
  id: "workbuddy" | "workbuddy-cn";
  displayName: string;
  /** API base, without a trailing slash. */
  endpoint: string;
  /** Value of the `platform` query parameter and the login URL. */
  platform: string;
  /** `X-Domain` header: the hostname alone, no protocol. */
  apiDomain: string;
  /** `X-Product-Code` header. */
  productCode: string;
  /** Default User-Agent; the gateway attributes usage by this string. */
  userAgent: string;
  /** `X-Product` / `X-IDE-Name` / `X-IDE-Type` attribution value. */
  attributionName: string;
  clientVersion: string;
}

const UA_INTL = "WorkBuddy/5.5.2 WorkBuddy AI/5.5.2 CLI/5.5.2";
const UA_CN = "WorkBuddy/5.5.2 WorkBuddy/5.5.2 CLI/5.5.2";

/** International build — gpt / gemini / claude model families. */
export const WORKBUDDY: WorkBuddyProduct = {
  id: "workbuddy",
  displayName: "WorkBuddy (国际版)",
  endpoint: "https://www.workbuddy.ai",
  platform: "workbuddy-ai",
  apiDomain: "www.workbuddy.ai",
  productCode: "workbuddy",
  userAgent: UA_INTL,
  attributionName: "WorkBuddy",
  clientVersion: "5.5.2",
};

/** China build — glm / hunyuan / deepseek model families. */
export const WORKBUDDY_CN: WorkBuddyProduct = {
  id: "workbuddy-cn",
  displayName: "WorkBuddy (国内版)",
  endpoint: "https://www.codebuddy.cn",
  platform: "ide",
  apiDomain: "www.codebuddy.cn",
  productCode: "workbuddy",
  userAgent: UA_CN,
  attributionName: "WorkBuddy",
  clientVersion: "5.5.2",
};

export const ALL_PRODUCTS: readonly WorkBuddyProduct[] = [WORKBUDDY, WORKBUDDY_CN];

/** Resolve a product by its id; unknown ids fall back to the international build. */
export function productById(id: string | null | undefined): WorkBuddyProduct {
  return ALL_PRODUCTS.find((product) => product.id === id) ?? WORKBUDDY;
}

/**
 * The model families each build serves, used to pick a sensible default and
 * to keep the two regions from offering each other's models.
 */
export const PRODUCT_MODELS: Record<string, readonly string[]> = {
  workbuddy: [
    "deepseek-v4.1-flash",
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gemini-3.5-flash",
    "glm-5.3",
    "hy3",
  ],
  "workbuddy-cn": [
    "deepseek-v4.1-flash",
    "deepseek-v4-pro",
    "hy3",
    "hy4-preview",
    "glm-5.3",
    "glm-5.3-flash",
    "kimi-k3-1",
  ],
};
