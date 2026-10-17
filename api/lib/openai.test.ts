/**
 * Tests for the private-host allowlist that lets a self-hosted deployment point
 * at its own OpenAI-compatible gateway on loopback.
 *
 * Default posture stays strict: loopback and RFC1918 are refused. Operators opt
 * in per endpoint with ALLOW_PRIVATE_MODEL_HOSTS, which must match the exact
 * host (optionally with port) so a typo cannot open the whole private range.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const envState = { allowlist: new Set<string>() };

vi.mock("./env", () => ({
  env: {
    appSecret: "test-secret-that-is-long-enough-32c",
    databaseUrl: "mysql://root:pw@localhost/db",
    isProduction: false,
    ownerUnionId: "",
    get privateHostAllowlist() {
      return envState.allowlist;
    },
  },
}));

vi.mock("./url-guard", () => ({
  isPrivateHost: (h: string) =>
    h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("192.168."),
  isPrivateResolvedHost: async () => false,
}));

import { testModelConnection } from "./openai";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  envState.allowlist = new Set<string>();
  vi.stubGlobal("fetch", fetchMock);
});

describe("SSRF guard and the private-host allowlist", () => {
  it("refuses loopback by default", async () => {
    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://127.0.0.1:8326" }),
    ).rejects.toThrow(/private\/internal network/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a private RFC1918 address by default", async () => {
    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://192.168.1.5:8080" }),
    ).rejects.toThrow(/private\/internal network/);
  });

  it("allows an allowlisted host when the port matches", async () => {
    envState.allowlist = new Set(["127.0.0.1:8326"]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ model: "workbuddy/hy3", choices: [{ message: { content: "ok" } }] }),
    });

    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://127.0.0.1:8326" }),
    ).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an allowlisted host without a port when no port is given", async () => {
    envState.allowlist = new Set(["localhost"]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ model: "m", choices: [{ message: { content: "ok" } }] }),
    });

    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://localhost" }),
    ).resolves.toBeTruthy();
  });

  it("still refuses a different port on an allowlisted host", async () => {
    envState.allowlist = new Set(["127.0.0.1:8326"]);
    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://127.0.0.1:9999" }),
    ).rejects.toThrow(/private\/internal network/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses a different private host on the same port", async () => {
    envState.allowlist = new Set(["127.0.0.1:8326"]);
    await expect(
      testModelConnection({ apiKey: "k", baseUrl: "http://192.168.1.5:8326" }),
    ).rejects.toThrow(/private\/internal network/);
  });
});
