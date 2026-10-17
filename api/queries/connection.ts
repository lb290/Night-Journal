import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

type Db = ReturnType<typeof drizzle<typeof fullSchema>>;

let instance: Db | undefined;

/**
 * Build a pool whose every connection runs with a UTC session.
 *
 * TIMESTAMP columns are converted between the session timezone and UTC on
 * write and read, while the driver parses the returned string as if it were
 * UTC. When the session zone is left on SYSTEM (a plain local MySQL defaults
 * to +08:00) the two disagree and every timestamp is shifted by the offset.
 *
 * The Docker image ships TZ=UTC, which is why the bug only showed up on a
 * local Mac. Pinning the session on each pooled connection fixes both, and
 * costs one extra round trip per connection.
 */
function createDb(): Db {
  const pool = createPool({
    uri: env.databaseUrl,
    // Parse DATETIME/TIMESTAMP as UTC rather than the process timezone.
    timezone: "Z",
    // Keep DATE columns as plain "YYYY-MM-DD" strings.
    dateStrings: ["DATE"],
  });

  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  return drizzle(pool, { mode: "planetscale", schema: fullSchema });
}

export function getDb(): Db {
  if (!instance) {
    instance = createDb();
  }
  return instance;
}
