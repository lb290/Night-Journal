/**
 * Tests for WorkBuddy credential resolution.
 *
 * Two stores can hold the same account's token: the DSH credential store (when
 * the Our Free Model plugin is signed in) and this app's own database. DSH wins
 * when present so one login serves both tools; the database copy is the
 * standalone fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("node:fs", () => ({
  default: { readFileSync: vi.fn() },
}));

import { readAccessToken, readDshWorkbuddyToken, resolveWorkbuddyToken } from "./credential";

const readFileMock = vi.mocked(fs.readFileSync);

/** Build a credential-store file containing one WorkBuddy account. */
function storeWith(token: string): string {
  // The plugin stores the credential as a single-quoted YAML scalar whose value
  // is a JSON object, all on one line.
  const payload = JSON.stringify({ access_token: token, refresh_token: "r" });
  return "version: 1\nrecords:\n  WORKBUDDY_ACCOUNT_37ECB20A: '" + payload + "'\nrefs: {}\n";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readAccessToken", () => {
  it("extracts the token from a serialized credential", () => {
    const stored = JSON.stringify({ access_token: "eyJhbGciOi.payload.sig" });
    expect(readAccessToken(stored)).toBe("eyJhbGciOi.payload.sig");
  });

  it("passes a bare token through unchanged", () => {
    expect(readAccessToken("eyJhbGciOi.payload.sig")).toBe("eyJhbGciOi.payload.sig");
  });

  it("returns an empty string for blank, missing, or malformed input", () => {
    expect(readAccessToken(null)).toBe("");
    expect(readAccessToken("")).toBe("");
    expect(readAccessToken("   ")).toBe("");
    expect(readAccessToken(JSON.stringify({ refresh_token: "r" }))).toBe("");
    expect(readAccessToken("{not json")).toBe("");
  });
});

describe("readDshWorkbuddyToken", () => {
  it("reads the token from the plugin's credential store", () => {
    readFileMock.mockReturnValue(storeWith("eyJdshTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") as never);
    expect(readDshWorkbuddyToken()).toBe("eyJdshTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("returns an empty string when the store does not exist", () => {
    readFileMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(readDshWorkbuddyToken()).toBe("");
  });

  it("returns an empty string when no WorkBuddy account is stored", () => {
    readFileMock.mockReturnValue("records:\n  DEEPSEEK_API_KEY: 'x'\n" as never);
    expect(readDshWorkbuddyToken()).toBe("");
  });
});

describe("resolveWorkbuddyToken", () => {
  const dshToken = "eyJdshTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const dbToken = "eyJdbTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  it("prefers the DSH store over the database copy", () => {
    readFileMock.mockReturnValue(storeWith(dshToken) as never);
    const resolved = resolveWorkbuddyToken(JSON.stringify({ access_token: dbToken }));
    expect(resolved.accessToken).toBe(dshToken);
    expect(resolved.source).toBe("dsh");
  });

  it("falls back to the database when DSH is absent", () => {
    readFileMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const resolved = resolveWorkbuddyToken(JSON.stringify({ access_token: dbToken }));
    expect(resolved.accessToken).toBe(dbToken);
    expect(resolved.source).toBe("database");
  });

  it("reports none when neither store has a token", () => {
    readFileMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const resolved = resolveWorkbuddyToken(null);
    expect(resolved.accessToken).toBe("");
    expect(resolved.source).toBe("none");
  });
});
