import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (isProduction) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    console.warn(
      `[env] WARNING: ${name} is not set. Using an insecure fallback for development only.`,
    );
    return `dev-fallback-${name}-${Math.random().toString(36).slice(2)}`;
  }
  return value;
}

/**
 * Comma-separated host:port pairs that are allowed to point at a private
 * network address, e.g. a local OpenAI-compatible gateway on 127.0.0.1:8326.
 *
 * The SSRF guard blocks loopback and RFC1918 addresses by default, which is
 * the right call for a public deployment: it stops a user from making the
 * server probe internal services. Self-hosted users legitimately run their
 * model gateway on the same machine, so this allowlist lets them opt in for
 * specific endpoints only, instead of disabling the guard wholesale.
 */
function parsePrivateHostAllowlist(raw: string | undefined): Set<string> {
  const allowed = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim().toLowerCase();
    if (trimmed !== "") allowed.add(trimmed);
  }
  return allowed;
}

export const env = {
  // Core — always required
  appSecret: required("APP_SECRET"),
  isProduction,
  databaseUrl: required("DATABASE_URL"),
  // Optional — admin union_id (typically "local:<username>")
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // Optional — private-network endpoints exempt from the SSRF guard
  privateHostAllowlist: parsePrivateHostAllowlist(
    process.env.ALLOW_PRIVATE_MODEL_HOSTS,
  ),
};
