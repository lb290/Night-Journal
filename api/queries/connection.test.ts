/**
 * Regression tests for timestamp timezone consistency.
 *
 * Root cause: TIMESTAMP columns are converted between the session timezone and
 * UTC on write/read, but the driver parses the returned string as if it were
 * already UTC. When the session is left on SYSTEM (a plain local MySQL
 * defaults to +08:00) the two disagree, so every timestamp comes back shifted
 * by the host's UTC offset. The Docker image ships TZ=UTC, which masked the
 * bug in the author's environment.
 *
 * The fix pins both sides to UTC:
 *   - pool connection event runs `SET time_zone = '+00:00'`
 *   - the driver is created with timezone: "Z"
 *
 * These tests assert the wiring rather than a live database, so they stay
 * fast and hermetic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const querySpy = vi.fn();
const onSpy = vi.fn();
const poolMock = {
  on: onSpy,
  query: querySpy,
};

vi.mock("mysql2", () => ({
  createPool: vi.fn(() => poolMock),
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({ __isDb: true })),
}));

vi.mock("../lib/env", () => ({
  env: {
    appSecret: "test-secret-that-is-long-enough-32c",
    databaseUrl: "mysql://user:pw@localhost:3306/db",
    isProduction: false,
    ownerUnionId: "",
  },
}));

vi.mock("@db/schema", () => ({}));
vi.mock("@db/relations", () => ({}));

describe("database connection timezone wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("asks the driver to parse timestamps as UTC", async () => {
    const { createPool } = await import("mysql2");
    const { getDb } = await import("./connection");
    getDb();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "Z",
        dateStrings: ["DATE"],
      }),
    );
  });

  it("pins every pooled connection to a UTC session", async () => {
    const { getDb } = await import("./connection");
    getDb();

    // The pool must subscribe to the per-connection event...
    expect(onSpy).toHaveBeenCalledWith("connection", expect.any(Function));

    // ...and running that handler must set the session timezone to UTC.
    const handler = onSpy.mock.calls.find((c) => c[0] === "connection")?.[1];
    expect(typeof handler).toBe("function");

    const connection = { query: vi.fn() };
    handler(connection);
    expect(connection.query).toHaveBeenCalledWith("SET time_zone = '+00:00'");
  });

  it("reuses a single pool across calls", async () => {
    const { createPool } = await import("mysql2");
    const { getDb } = await import("./connection");
    getDb();
    getDb();
    getDb();
    expect(createPool).toHaveBeenCalledTimes(1);
  });
});
