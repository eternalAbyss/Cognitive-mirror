import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthStore } from "../src/auth/store.js";
import { CognitiveMirrorAuthProvider, MCP_SCOPE } from "../src/auth/provider.js";
import { hashPassphrase, verifyPassphrase } from "../src/auth/passphrase.js";

/**
 * These cover the parts of OAuth this project owns. The SDK supplies the
 * protocol handlers (discovery, DCR, the token endpoint, PKCE verification);
 * what's tested here is the provider's own decisions — code single-use, refresh
 * rotation, replay response, scope narrowing, and cross-client isolation.
 */

const CHALLENGE = createHash("sha256").update("a-code-verifier").digest("base64url");

function client(id = "client-a"): OAuthClientInformationFull {
  return {
    client_id: id,
    client_name: "Test Client",
    redirect_uris: ["https://example.test/callback"],
  } as OAuthClientInformationFull;
}

let store: AuthStore;
let provider: CognitiveMirrorAuthProvider;

beforeEach(() => {
  store = new AuthStore(":memory:");
  provider = new CognitiveMirrorAuthProvider({ store, passphraseHash: "unused-here" });
});

/** Drive authorize → consent → code, the way the HTTP layer does. */
function authorizeAndApprove(c = client()): string {
  store.saveClient(c);
  const id = randomBytes(8).toString("hex");
  // `authorize()` parks the request and redirects; park it directly so the test
  // doesn't need an express Response.
  (provider as unknown as { pending: Map<string, unknown> }).pending.set(id, {
    clientId: c.client_id,
    params: {
      redirectUri: c.redirect_uris[0]!,
      codeChallenge: CHALLENGE,
      scopes: [MCP_SCOPE],
      state: "xyz",
    },
    createdAt: Date.now(),
  });
  const approved = provider.approve(id);
  expect(approved).toBeDefined();
  return approved!.code;
}

describe("authorization code exchange", () => {
  it("issues an access token and a refresh token", async () => {
    const code = authorizeAndApprove();
    const tokens = await provider.exchangeAuthorizationCode(client(), code);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.scope).toBe(MCP_SCOPE);

    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info.clientId).toBe("client-a");
    expect(info.scopes).toEqual([MCP_SCOPE]);
  });

  it("returns the PKCE challenge recorded at authorize time", async () => {
    const code = authorizeAndApprove();
    await expect(provider.challengeForAuthorizationCode(client(), code)).resolves.toBe(CHALLENGE);
  });

  it("rejects a replayed authorization code", async () => {
    const code = authorizeAndApprove();
    await provider.exchangeAuthorizationCode(client(), code);
    await expect(provider.exchangeAuthorizationCode(client(), code)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects an unknown code", async () => {
    await expect(provider.exchangeAuthorizationCode(client(), "nope")).rejects.toThrow(/invalid or expired/);
  });

  it("rejects a code presented by a different client", async () => {
    const code = authorizeAndApprove();
    store.saveClient(client("client-b"));
    await expect(provider.exchangeAuthorizationCode(client("client-b"), code)).rejects.toThrow(
      /issued to another client/,
    );
  });

  it("rejects a mismatched redirect_uri", async () => {
    const code = authorizeAndApprove();
    await expect(
      provider.exchangeAuthorizationCode(client(), code, undefined, "https://evil.test/callback"),
    ).rejects.toThrow(/redirect_uri/);
  });

  it("expires a code that is past its TTL", async () => {
    const code = authorizeAndApprove();
    store.purgeExpired(Date.now() + 120_000);
    await expect(provider.exchangeAuthorizationCode(client(), code)).rejects.toThrow(/invalid or expired/);
  });
});

describe("refresh token rotation", () => {
  it("issues a new pair and invalidates the old refresh token", async () => {
    const first = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    const second = await provider.exchangeRefreshToken(client(), first.refresh_token!);

    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(provider.verifyAccessToken(second.access_token)).resolves.toMatchObject({
      clientId: "client-a",
    });
    // The spent refresh token is gone.
    await expect(provider.exchangeRefreshToken(client(), first.refresh_token!)).rejects.toThrow(
      /invalid or expired/,
    );
  });

  it("revokes every token for the client when a refresh token is replayed", async () => {
    const first = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    const second = await provider.exchangeRefreshToken(client(), first.refresh_token!);

    // Replaying the spent token is treated as theft, not as a retry: the
    // still-valid tokens from the legitimate rotation are dropped too.
    await expect(provider.exchangeRefreshToken(client(), first.refresh_token!)).rejects.toThrow();
    await expect(provider.verifyAccessToken(second.access_token)).rejects.toThrow(/invalid or expired/);
  });

  it("allows narrowing scope but not widening it", async () => {
    const first = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    await expect(
      provider.exchangeRefreshToken(client(), first.refresh_token!, ["admin"]),
    ).rejects.toThrow(/exceeds the original grant/);
  });
});

describe("access tokens", () => {
  it("rejects an unknown token", async () => {
    await expect(provider.verifyAccessToken("not-a-token")).rejects.toThrow(/invalid or expired/);
  });

  it("rejects an expired token", async () => {
    const tokens = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    store.purgeExpired(Date.now() + 2 * 60 * 60_000);
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow(/invalid or expired/);
  });

  it("revokes a token on request, idempotently", async () => {
    const tokens = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    await provider.revokeToken(client(), { token: tokens.access_token });
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
    // RFC 7009: revoking again must not error, or it becomes a token oracle.
    await expect(provider.revokeToken(client(), { token: tokens.access_token })).resolves.toBeUndefined();
  });

  it("never stores a token in the clear", async () => {
    const tokens = await provider.exchangeAuthorizationCode(client(), authorizeAndApprove());
    const raw = (
      store as unknown as { db: { prepare: (s: string) => { all: () => unknown[] } } }
    ).db
      .prepare("SELECT token_hash FROM oauth_tokens")
      .all() as Array<{ token_hash: string }>;
    expect(raw.length).toBeGreaterThan(0);
    for (const row of raw) {
      expect(row.token_hash).not.toBe(tokens.access_token);
      expect(row.token_hash).not.toBe(tokens.refresh_token);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("passphrase hashing", () => {
  it("verifies the correct passphrase and rejects a wrong one", async () => {
    const hash = await hashPassphrase("a long enough passphrase");
    await expect(verifyPassphrase("a long enough passphrase", hash)).resolves.toBe(true);
    await expect(verifyPassphrase("a long enough passphrasf", hash)).resolves.toBe(false);
  });

  it("salts, so the same passphrase hashes differently each time", async () => {
    const a = await hashPassphrase("same input");
    const b = await hashPassphrase("same input");
    expect(a).not.toBe(b);
    await expect(verifyPassphrase("same input", a)).resolves.toBe(true);
    await expect(verifyPassphrase("same input", b)).resolves.toBe(true);
  });

  it("rejects malformed stored hashes rather than throwing", async () => {
    for (const bad of ["", "garbage", "scrypt$only-two", "bcrypt$aa$bb", "scrypt$$"]) {
      await expect(verifyPassphrase("x", bad)).resolves.toBe(false);
    }
  });
});
