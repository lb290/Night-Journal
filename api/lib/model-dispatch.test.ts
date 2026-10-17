/**
 * Tests for the WorkBuddy credential shape.
 *
 * The stored credential is a JSON object carrying the access token, the refresh
 * token and the expiry. Only the access token belongs in an Authorization
 * header: sending the whole JSON yields a 401 that reads like an auth failure
 * but is really a shape mismatch.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./openai", () => ({ callChatModel: vi.fn() }));
vi.mock("./workbuddy/chat", () => ({
  chatCompletion: vi.fn(),
  ensureSystemPrompt: (m: unknown) => m,
}));

import { readAccessToken } from "./model-dispatch";

describe("readAccessToken", () => {
  it("extracts the token from a serialized credential", () => {
    const stored = JSON.stringify({
      access_token: "eyJhbGciOi.payload.sig",
      refresh_token: "r",
      expires_at: "2027-01-01T00:00:00Z",
    });
    expect(readAccessToken(stored)).toBe("eyJhbGciOi.payload.sig");
  });

  it("passes a bare token through unchanged", () => {
    expect(readAccessToken("eyJhbGciOi.payload.sig")).toBe("eyJhbGciOi.payload.sig");
  });

  it("returns an empty string for missing or blank input", () => {
    expect(readAccessToken(null)).toBe("");
    expect(readAccessToken(undefined)).toBe("");
    expect(readAccessToken("")).toBe("");
    expect(readAccessToken("   ")).toBe("");
  });

  it("returns an empty string when the credential has no access_token", () => {
    expect(readAccessToken(JSON.stringify({ refresh_token: "r" }))).toBe("");
  });

  it("returns an empty string for malformed JSON rather than throwing", () => {
    expect(readAccessToken("{not json")).toBe("");
  });
});
