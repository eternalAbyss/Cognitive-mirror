import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { childLogger } from "@cm/shared";
import { AuthStore, newToken, safeEqual } from "./store.js";

const log = childLogger("mcp-server:auth");

/** Short, because a code is exchanged within seconds of being issued. */
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

/** The only scope. Every tool is equally sensitive; splitting them would imply otherwise. */
export const MCP_SCOPE = "mcp";

/** A pending authorize request, held between the redirect and the consent POST. */
interface PendingAuthorization {
  clientId: string;
  params: AuthorizationParams;
  createdAt: number;
}

/**
 * A single-user OAuth 2.1 authorization server for the MCP endpoint.
 *
 * The MCP SDK supplies the protocol surface — discovery metadata, dynamic client
 * registration, and the authorize/token/revoke handlers — so what's left is the
 * decisions those handlers delegate: who may log in, how long tokens live, and
 * what happens on replay. `skipLocalPkceValidation` stays false so the SDK
 * enforces S256 PKCE against the challenge recorded here.
 *
 * "Single-user" is the security model, not a limitation to route around: there
 * is one passphrase, held by the person whose graph this is. Registration is
 * open (Claude clients register themselves via DCR), but registering buys
 * nothing without the passphrase.
 */
export class CognitiveMirrorAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = false;

  private readonly store: AuthStore;
  private readonly passphraseHash: string;
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(opts: { store: AuthStore; passphraseHash: string }) {
    this.store = opts.store;
    this.passphraseHash = opts.passphraseHash;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: (client) => {
        const full = client as OAuthClientInformationFull;
        this.store.saveClient(full);
        log.info({ clientId: full.client_id, name: full.client_name }, "oauth client registered");
        return full;
      },
    };
  }

  // ── authorize ──────────────────────────────────────────────────────────────

  /**
   * Show the consent screen rather than redirecting straight back with a code.
   *
   * The SDK has already validated the client and redirect URI by this point;
   * what it cannot know is whether the human sitting here actually wants this.
   * The request is parked server-side and referenced by an opaque id, so nothing
   * about the flow is carried in a form field the browser could tamper with.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.sweepPending();
    const id = randomUUID();
    this.pending.set(id, { clientId: client.client_id, params, createdAt: Date.now() });
    res.redirect(`/authorize/consent?request=${encodeURIComponent(id)}`);
  }

  /** Look up a parked authorize request. */
  getPending(id: string): { clientId: string; params: AuthorizationParams } | undefined {
    const found = this.pending.get(id);
    if (!found || Date.now() - found.createdAt > 10 * 60_000) {
      this.pending.delete(id);
      return undefined;
    }
    return found;
  }

  /** Consume a parked request and mint the authorization code for it. */
  approve(id: string): { code: string; params: AuthorizationParams } | undefined {
    const found = this.getPending(id);
    if (!found) return undefined;
    this.pending.delete(id);

    const code = newToken();
    this.store.saveCode(code, {
      clientId: found.clientId,
      redirectUri: found.params.redirectUri,
      codeChallenge: found.params.codeChallenge,
      scopes: found.params.scopes?.length ? found.params.scopes : [MCP_SCOPE],
      resource: found.params.resource?.href ?? null,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    return { code, params: found.params };
  }

  get passphraseHashForVerification(): string {
    return this.passphraseHash;
  }

  private sweepPending(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, p] of this.pending) if (p.createdAt < cutoff) this.pending.delete(id);
  }

  // ── token exchange ─────────────────────────────────────────────────────────

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const found = this.store.peekCode(authorizationCode);
    if (!found) throw new InvalidGrantError("invalid or expired authorization code");
    return found.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Consuming (not just reading) makes the code single-use even under a race:
    // a replay finds nothing rather than racing the delete. PKCE itself was
    // already verified by the SDK's token handler against the challenge above.
    const found = this.store.consumeCode(authorizationCode);
    if (!found) throw new InvalidGrantError("invalid or expired authorization code");
    if (found.clientId !== client.client_id) {
      throw new InvalidGrantError("authorization code was issued to another client");
    }
    if (redirectUri !== undefined && !safeEqual(redirectUri, found.redirectUri)) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    if (resource && found.resource && resource.href !== found.resource) {
      throw new InvalidGrantError("resource does not match the authorization request");
    }
    return this.issue(client.client_id, found.scopes, found.resource);
  }

  /**
   * Exchange a refresh token, rotating it.
   *
   * The old refresh token is revoked as it is spent, so presenting one twice is
   * detectable. When that happens every token for the client is dropped: a
   * replay means either a bug or a stolen token, and the safe reading is theft.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const found = this.store.getToken(refreshToken, "refresh");
    if (!found) {
      // Unknown or already-spent. If it was ever valid for this client, assume
      // the worst and force a fresh authorization.
      this.store.revokeClientTokens(client.client_id);
      throw new InvalidGrantError("invalid or expired refresh token");
    }
    if (found.clientId !== client.client_id) {
      this.store.revokeClientTokens(client.client_id);
      throw new InvalidGrantError("refresh token was issued to another client");
    }
    this.store.revokeToken(refreshToken);

    // A refresh may narrow scope but never widen it.
    const granted = scopes?.length
      ? scopes.filter((s) => found.scopes.includes(s))
      : found.scopes;
    if (scopes?.length && granted.length !== scopes.length) {
      throw new InvalidScopeError("requested scope exceeds the original grant");
    }
    return this.issue(client.client_id, granted, resource?.href ?? found.resource);
  }

  private issue(clientId: string, scopes: string[], resource: string | null): OAuthTokens {
    const accessToken = newToken();
    const refreshToken = newToken();
    const now = Date.now();
    this.store.saveToken(accessToken, "access", {
      clientId, scopes, resource, expiresAt: now + ACCESS_TTL_MS,
    });
    this.store.saveToken(refreshToken, "refresh", {
      clientId, scopes, resource, expiresAt: now + REFRESH_TTL_MS,
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      scope: scopes.join(" "),
      refresh_token: refreshToken,
    };
  }

  // ── verification & revocation ──────────────────────────────────────────────

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const found = this.store.getToken(token, "access");
    // InvalidTokenError, not a plain Error: requireBearerAuth turns this into a
    // 401 with a WWW-Authenticate challenge, while anything else becomes a 500
    // — which tells a caller nothing and looks like the server is broken.
    if (!found) throw new InvalidTokenError("invalid or expired access token");
    return {
      token,
      clientId: found.clientId,
      scopes: found.scopes,
      expiresAt: Math.floor(found.expiresAt / 1000),
      ...(found.resource ? { resource: new URL(found.resource) } : {}),
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Per RFC 7009 revocation is idempotent and never reports "not found":
    // saying so would let a caller probe which tokens exist.
    this.store.revokeToken(request.token);
  }
}
