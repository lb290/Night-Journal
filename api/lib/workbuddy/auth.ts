/**
 * WorkBuddy authentication: the polling login flow, token refresh, and the
 * credential shape persisted in the database.
 *
 * WorkBuddy does not use a local callback server. It hands back a `state`,
 * the user approves in a browser, and the client polls the token endpoint
 * until the approval lands. That makes the flow easy to drive from a server:
 * return the auth URL to the client, then poll in the background.
 */

import type { WorkBuddyProduct } from "./product";

/** Where a login attempt currently stands. */
export type LoginStatus = "pending" | "ready" | "expired";

/** Tokens as returned by the token endpoint. */
export interface WorkBuddyToken {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601, as reported by the gateway. */
  expiresAt: string;
  refreshExpiresAt: string;
  tokenType: string;
  scope: string;
  domain: string;
}

/** The account attached to a completed login. */
export interface WorkBuddyAccount {
  uid: string;
  nickname: string;
  enterpriseId: string;
  accountType: string;
}

/**
 * What we store. Mirrors the token payload plus the account, so a refresh can
 * run without another round trip.
 */
export interface WorkBuddyCredential {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  token_type: string;
  scope: string;
  domain: string;
  user_id?: string;
  nickname?: string;
  enterprise_id?: string;
  account_type?: string;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const STATE_REQUEST_TIMEOUT_MS = 15_000;

/** Token endpoint code meaning "not approved yet, keep polling". */
const CODE_TOKEN_NOT_READY = 11217;
/** Account endpoint code meaning "account not ready yet, keep polling". */
const CODE_ACCOUNT_NOT_READY = 12151;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Envelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

/**
 * POST/GET helper that always resolves with a status and a parsed body.
 * WorkBuddy answers with `{ code, msg, data }` even on failures, so the HTTP
 * status alone is not enough to tell what happened.
 */
async function request(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  options: { body?: unknown; timeoutMs: number; signal?: AbortSignal } = {
    timeoutMs: REQUEST_TIMEOUT_MS,
  },
): Promise<{ status: number; body: Envelope }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: Envelope = {};
    try {
      body = text === "" ? {} : (JSON.parse(text) as Envelope);
    } catch {
      body = { msg: text.slice(0, 300) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Headers every authenticated call carries. The gateway attributes usage by
 * these, so they are not optional cosmetics.
 */
export function attributionHeaders(product: WorkBuddyProduct): Record<string, string> {
  return {
    "X-Domain": product.apiDomain,
    "X-Product": product.attributionName,
    "X-Product-Code": product.productCode,
    "X-Agent-Purpose": "conversation",
    "X-IDE-Name": product.attributionName,
    "X-IDE-Type": product.attributionName,
    "X-IDE-Version": product.clientVersion,
    "User-Agent": product.userAgent,
  };
}

/** Step 1: ask for a state plus the URL the user must open. */
export async function fetchAuthState(
  product: WorkBuddyProduct,
  signal?: AbortSignal,
): Promise<{ state: string; authUrl: string }> {
  const url = `${product.endpoint}/v2/plugin/auth/state?platform=${encodeURIComponent(product.platform)}`;
  const { status, body } = await request("POST", url, {
    "X-Domain": product.apiDomain,
    "X-No-Authorization": "true",
    "X-No-User-Id": "true",
    "X-No-Enterprise-Id": "true",
    "X-No-Department-Info": "true",
    "User-Agent": product.userAgent,
    "content-type": "application/json",
  }, { body: {}, timeoutMs: STATE_REQUEST_TIMEOUT_MS, signal });

  if (status !== 200) {
    throw new Error(`WorkBuddy auth/state failed: HTTP ${status} ${body.msg ?? ""}`.trim());
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  const state = typeof data.state === "string" ? data.state : "";
  const authUrl = typeof data.authUrl === "string" ? data.authUrl : "";
  if (state === "" || authUrl === "") {
    throw new Error("WorkBuddy auth/state returned no state/authUrl");
  }
  return { state, authUrl };
}

/** Step 2: poll until the user approves, then return the tokens. */
export async function loopGetToken(
  product: WorkBuddyProduct,
  state: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal } = {},
): Promise<WorkBuddyToken> {
  const url = `${product.endpoint}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`;
  const headers: Record<string, string> = {
    "X-No-Authorization": "true",
    "User-Agent": product.userAgent,
  };
  const deadline = Date.now() + (options.timeoutMs ?? LOGIN_TIMEOUT_MS);
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error("WorkBuddy login timed out after 5 minutes");
    }
    if (options.signal?.aborted) {
      throw new Error("WorkBuddy login cancelled");
    }
    await sleep(interval);

    let result: { status: number; body: Envelope };
    try {
      result = await request("GET", url, headers, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal: options.signal,
      });
    } catch {
      // A transient network error must not end a login the user is
      // halfway through in their browser; keep polling.
      continue;
    }

    if (result.status === 200 && result.body.data !== undefined && result.body.data !== null) {
      return parseTokenData(result.body.data as Record<string, unknown>);
    }
    if (result.body.code === CODE_TOKEN_NOT_READY) continue;
    if (result.status === 200) continue;
    throw new Error(
      `WorkBuddy auth/token failed: HTTP ${result.status} code=${result.body.code ?? "?"} ${result.body.msg ?? ""}`.trim(),
    );
  }
}

/** Step 3: fetch the account that just signed in. */
export async function getAccount(
  product: WorkBuddyProduct,
  state: string,
  token: WorkBuddyToken,
  options: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal } = {},
): Promise<WorkBuddyAccount> {
  const url = `${product.endpoint}/v2/plugin/login/account?state=${encodeURIComponent(state)}`;
  const headers: Record<string, string> = {
    ...attributionHeaders(product),
    Authorization: `Bearer ${token.accessToken}`,
  };
  const deadline = Date.now() + (options.timeoutMs ?? LOGIN_TIMEOUT_MS);
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error("WorkBuddy account lookup timed out");
    }
    if (options.signal?.aborted) {
      throw new Error("WorkBuddy login cancelled");
    }
    const result = await request("GET", url, headers, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal: options.signal,
    });
    if (result.status === 200 && result.body.data !== undefined && result.body.data !== null) {
      const data = result.body.data as Record<string, unknown>;
      return {
        uid: typeof data.uid === "string" ? data.uid : "",
        nickname: typeof data.nickname === "string" ? data.nickname : "",
        enterpriseId: typeof data.enterprise_id === "string" ? data.enterprise_id : "",
        accountType: typeof data.account_type === "string" ? data.account_type : "",
      };
    }
    if (result.body.code === CODE_ACCOUNT_NOT_READY) {
      await sleep(interval);
      continue;
    }
    await sleep(interval);
  }
}

/** Map the token payload onto our credential shape. */
export function parseTokenData(data: Record<string, unknown>): WorkBuddyToken {
  const str = (key: string): string =>
    typeof data[key] === "string" ? (data[key] as string) : "";
  return {
    accessToken: str("access_token"),
    refreshToken: str("refresh_token"),
    expiresAt: str("expires_at"),
    refreshExpiresAt: str("refresh_expires_at"),
    tokenType: str("token_type"),
    scope: str("scope"),
    domain: str("domain"),
  };
}

/** Combine a token and its account into the stored credential. */
export function buildCredential(
  token: WorkBuddyToken,
  account: WorkBuddyAccount,
): WorkBuddyCredential {
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    refresh_expires_at: token.refreshExpiresAt,
    token_type: token.tokenType,
    scope: token.scope,
    domain: token.domain,
    user_id: account.uid,
    nickname: account.nickname,
    enterprise_id: account.enterpriseId,
    account_type: account.accountType,
  };
}

/** Can this credential be renewed without a fresh login? */
export function isRefreshable(credential: WorkBuddyCredential): boolean {
  return typeof credential.refresh_token === "string" && credential.refresh_token !== "";
}

/** Parse an expiry to epoch ms; unparseable values report 0 (unknown). */
export function expiryMs(value: string | undefined): number {
  if (typeof value !== "string" || value.trim() === "") return 0;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // A bare number is either seconds or milliseconds; 1e12 separates them.
    return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Thrown when the refresh token itself is dead and a new login is required. */
export class RefreshTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenExpiredError";
  }
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshToken(
  product: WorkBuddyProduct,
  credential: WorkBuddyCredential,
  signal?: AbortSignal,
): Promise<WorkBuddyToken> {
  if (!isRefreshable(credential)) {
    throw new RefreshTokenExpiredError("no refresh_token; please sign in again");
  }
  const url = `${product.endpoint}/v2/plugin/auth/token/refresh`;
  const headers: Record<string, string> = {
    ...attributionHeaders(product),
    Authorization: `Bearer ${credential.access_token}`,
    "X-Refresh-Token": credential.refresh_token,
    "X-Auth-Refresh-Source": "plugin",
    "content-type": "application/json",
  };
  const { status, body } = await request("POST", url, headers, {
    body: {},
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal,
  });

  if (status !== 200) {
    const message = body.msg ?? "";
    const expired =
      status === 401 ||
      status === 403 ||
      body.code === 401 ||
      body.code === 403 ||
      /expired|invalid/i.test(message);
    if (expired) {
      throw new RefreshTokenExpiredError(message !== "" ? message : `HTTP ${status}`);
    }
    throw new Error(`WorkBuddy token refresh failed: HTTP ${status} ${message}`.trim());
  }
  if (body.data === undefined || body.data === null) {
    throw new Error("WorkBuddy token refresh returned no data");
  }
  return parseTokenData(body.data as Record<string, unknown>);
}
