/**
 * WorkBuddy credential resolution.
 *
 * Two sources can hold the same account's token:
 *
 *   1. The DSH credential store, when the Our Free Model plugin is installed
 *      and signed in. Reading it here means one login serves both tools, and a
 *      refresh performed by either side is picked up by the other.
 *   2. This app's own database, for deployments that have no DSH.
 *
 * Order matters: DSH wins when present, because that store is the one the
 * user actually logs into. The database copy stays as the fallback so the app
 * keeps working standalone.
 *
 * Nothing is written back to the DSH store — it belongs to another program.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where a resolved credential came from, for logging and the UI. */
export type CredentialSource = "dsh" | "database" | "none";

export interface ResolvedCredential {
  accessToken: string;
  source: CredentialSource;
}

/**
 * Locate the DSH home directory.
 *
 * DSH_HOME wins so a non-default install can be pointed at explicitly;
 * otherwise it is the conventional ~/.dsh.
 */
function dshHome(): string {
  const override = (process.env.DSH_HOME ?? "").trim();
  return override !== "" ? override : path.join(os.homedir(), ".dsh");
}

/**
 * The provider key under which the plugin stores the WorkBuddy account.
 *
 * The plugin names accounts `<PROVIDER>_ACCOUNT_<HASH>`, and the hash is
 * derived from the account id, so the exact suffix is not predictable from
 * here. We therefore scan for any WorkBuddy account entry and take the first.
 */
const WORKBUDDY_KEY_PATTERN = /^\s*WORKBUDDY_ACCOUNT_[A-Z0-9]+\s*:/m;

/**
 * Pull the access token out of a credential-store entry.
 *
 * The value is a YAML string containing JSON, so it is matched rather than
 * parsed: a full YAML parse would drag in a dependency for one field, and the
 * token is unambiguous (a long JWT).
 */
function tokenFromCredentialBlock(block: string): string {
  const match = block.match(/access_token\\?["']?\s*:\s*\\?["']?([A-Za-z0-9_.-]{40,})/);
  return match ? match[1] : "";
}

/**
 * Read the WorkBuddy access token from the DSH credential store.
 *
 * Returns an empty string when DSH is absent, the file is unreadable, or no
 * WorkBuddy account is stored. Every failure is treated as "not available"
 * rather than an error: a machine without DSH is a supported configuration.
 */
export function readDshWorkbuddyToken(): string {
  const file = path.join(dshHome(), ".credentials.yaml");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }

  const keyMatch = WORKBUDDY_KEY_PATTERN.exec(text);
  if (!keyMatch) return "";

  // The entry is a single quoted YAML scalar; read to the end of that line.
  const start = keyMatch.index;
  const lineEnd = text.indexOf("\n", start);
  const block = lineEnd === -1 ? text.slice(start) : text.slice(start, lineEnd);
  return tokenFromCredentialBlock(block);
}

/**
 * Resolve the credential to use, preferring DSH over the local database copy.
 *
 * @param storedInDatabase  The decrypted credential from ai_settings, if any.
 */
export function resolveWorkbuddyToken(
  storedInDatabase: string | null | undefined,
): ResolvedCredential {
  const fromDsh = readDshWorkbuddyToken();
  if (fromDsh !== "") {
    return { accessToken: fromDsh, source: "dsh" };
  }
  const fromDb = readAccessToken(storedInDatabase);
  if (fromDb !== "") {
    return { accessToken: fromDb, source: "database" };
  }
  return { accessToken: "", source: "none" };
}

/**
 * Extract the bearer token from a stored credential, which may be either a
 * serialized JSON object or a bare token.
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
