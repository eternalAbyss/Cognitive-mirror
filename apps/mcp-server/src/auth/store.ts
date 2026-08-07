import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Persistence for the OAuth authorization server.
 *
 * `node:sqlite` for the same reason the job queue uses it: no native build step,
 * so the published package stays installable everywhere.
 *
 * Nothing secret is stored in the clear. Authorization codes, access tokens and
 * refresh tokens are kept as SHA-256 hashes, so a copy of this file cannot be
 * replayed against the server — the same reason you don't store passwords. The
 * plaintext exists only in the response that issues it.
 */

/** SHA-256, hex. Fine for high-entropy random tokens; these are not passwords. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time string compare that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return timingSafeEqual(ab, ab) && false;
  return timingSafeEqual(ab, bb);
}

export interface StoredCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string | null;
  expiresAt: number;
}

export interface StoredToken {
  clientId: string;
  scopes: string[];
  resource: string | null;
  expiresAt: number;
}

interface ClientRow {
  client_id: string;
  data: string;
}
interface CodeRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string | null;
  expires_at: number;
}
interface TokenRow {
  client_id: string;
  scopes: string;
  resource: string | null;
  expires_at: number;
}

export class AuthStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,            -- 'access' | 'refresh'
        client_id TEXT NOT NULL,
        scopes TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_client ON oauth_tokens (client_id);
    `);
    this.purgeExpired();
  }

  // ── clients ────────────────────────────────────────────────────────────────

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db
      .prepare("SELECT client_id, data FROM oauth_clients WHERE client_id = ?")
      .get(clientId) as ClientRow | undefined;
    return row ? (JSON.parse(row.data) as OAuthClientInformationFull) : undefined;
  }

  saveClient(client: OAuthClientInformationFull): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO oauth_clients (client_id, data, created_at) VALUES (?, ?, ?)",
      )
      .run(client.client_id, JSON.stringify(client), Date.now());
  }

  countClients(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number };
    return row.n;
  }

  // ── authorization codes ────────────────────────────────────────────────────

  saveCode(code: string, data: StoredCode): void {
    this.db
      .prepare(
        `INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scopes, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(code),
        data.clientId,
        data.redirectUri,
        data.codeChallenge,
        JSON.stringify(data.scopes),
        data.resource,
        data.expiresAt,
      );
  }

  peekCode(code: string): StoredCode | undefined {
    const row = this.db
      .prepare(
        `SELECT client_id, redirect_uri, code_challenge, scopes, resource, expires_at
           FROM oauth_codes WHERE code_hash = ?`,
      )
      .get(hashToken(code)) as CodeRow | undefined;
    if (!row || row.expires_at < Date.now()) return undefined;
    return {
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      scopes: JSON.parse(row.scopes) as string[],
      resource: row.resource,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Read a code and delete it in the same breath.
   *
   * Authorization codes are single-use by spec. Deleting on read — rather than
   * after the exchange succeeds — means a replayed code finds nothing, even if
   * two requests arrive at once.
   */
  consumeCode(code: string): StoredCode | undefined {
    const found = this.peekCode(code);
    this.db.prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(hashToken(code));
    return found;
  }

  // ── tokens ─────────────────────────────────────────────────────────────────

  saveToken(token: string, kind: "access" | "refresh", data: StoredToken): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_tokens (token_hash, kind, client_id, scopes, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(token),
        kind,
        data.clientId,
        JSON.stringify(data.scopes),
        data.resource,
        data.expiresAt,
      );
  }

  getToken(token: string, kind: "access" | "refresh"): StoredToken | undefined {
    const row = this.db
      .prepare(
        "SELECT client_id, scopes, resource, expires_at FROM oauth_tokens WHERE token_hash = ? AND kind = ?",
      )
      .get(hashToken(token), kind) as TokenRow | undefined;
    if (!row || row.expires_at < Date.now()) return undefined;
    return {
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes) as string[],
      resource: row.resource,
      expiresAt: row.expires_at,
    };
  }

  revokeToken(token: string): void {
    this.db.prepare("DELETE FROM oauth_tokens WHERE token_hash = ?").run(hashToken(token));
  }

  /** Drop every token for a client — used when a refresh token is replayed. */
  revokeClientTokens(clientId: string): void {
    this.db.prepare("DELETE FROM oauth_tokens WHERE client_id = ?").run(clientId);
  }

  purgeExpired(now = Date.now()): void {
    this.db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now);
  }

  close(): void {
    this.db.close();
  }
}
