import { join } from "node:path";
import express, { type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { childLogger, loadConfig, resolveHomeDir } from "@cm/shared";
import { AuthStore } from "./store.js";
import { loginPage } from "./login.js";
import { verifyPassphrase } from "./passphrase.js";
import { CognitiveMirrorAuthProvider, MCP_SCOPE } from "./provider.js";

const log = childLogger("mcp-server:auth");

export interface AuthSetup {
  /** Mounted at the app root; supplies discovery, DCR, token, and revoke. */
  router: express.Router;
  /** Guards /mcp and /events. */
  guard: RequestHandler;
  store: AuthStore;
}

/**
 * Decide whether OAuth applies, and refuse to run misconfigured.
 *
 * The server binds 127.0.0.1 and therefore cannot tell a tunnelled request from
 * a local one — by the time it arrives, cloudflared has already made it look
 * local. So the trigger is intent, not observation: setting `MCP_PUBLIC_URL`
 * means "I am publishing this", and publishing without a passphrase is refused
 * outright rather than started in a weaker mode. Failing to boot is loud;
 * quietly serving an unauthenticated write API to the internet is not.
 */
export function setupAuth(): AuthSetup | null {
  const cfg = loadConfig();
  const publicUrl = cfg.MCP_PUBLIC_URL.trim();

  if (!publicUrl) {
    log.info("MCP_PUBLIC_URL not set — running localhost-only with no authentication");
    return null;
  }

  let issuer: URL;
  try {
    issuer = new URL(publicUrl);
  } catch {
    throw new Error(`MCP_PUBLIC_URL is not a valid URL: ${publicUrl}`);
  }
  if (issuer.protocol !== "https:") {
    throw new Error(
      `MCP_PUBLIC_URL must use https (got ${issuer.protocol}//). ` +
        "OAuth tokens would otherwise cross the network in the clear.",
    );
  }
  if (!cfg.MCP_AUTH_PASSPHRASE_HASH.trim()) {
    throw new Error(
      "MCP_PUBLIC_URL is set but MCP_AUTH_PASSPHRASE_HASH is empty.\n" +
        "  Refusing to expose an unauthenticated MCP server.\n" +
        "  Set a passphrase first:  cognitive-mirror auth set-passphrase",
    );
  }

  const store = new AuthStore(join(resolveHomeDir(), ".data", "oauth.sqlite"));
  const provider = new CognitiveMirrorAuthProvider({
    store,
    passphraseHash: cfg.MCP_AUTH_PASSPHRASE_HASH,
  });

  const router = express.Router();

  // Brute force is the realistic attack on a single passphrase, so the consent
  // POST is the one endpoint that needs its own limit — the SDK rate-limits its
  // own routes already.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", error_description: "Too many attempts. Try again later." },
  });

  router.get("/authorize/consent", (req, res) => {
    void (async () => {
      const id = String(req.query.request ?? "");
      const pending = provider.getPending(id);
      if (!pending) {
        res.status(400).send(errorPage("This authorisation request expired. Start again from your client."));
        return;
      }
      const client = await provider.clientsStore.getClient(pending.clientId);
      res.type("html").send(loginPage({ clientName: nameOf(client, pending.clientId), request: id }));
    })();
  });

  router.post(
    "/authorize/consent",
    loginLimiter,
    express.urlencoded({ extended: false }),
    (req, res) => {
      void (async () => {
        const body = req.body as { request?: string; passphrase?: string };
        const id = String(body.request ?? "");
        const pending = provider.getPending(id);
        if (!pending) {
          res.status(400).send(errorPage("This authorisation request expired. Start again from your client."));
          return;
        }
        const client = await provider.clientsStore.getClient(pending.clientId);
        const clientName = nameOf(client, pending.clientId);

        const ok = await verifyPassphrase(
          String(body.passphrase ?? ""),
          provider.passphraseHashForVerification,
        );
        if (!ok) {
          log.warn({ clientId: pending.clientId }, "failed authorisation attempt");
          res
            .status(401)
            .type("html")
            .send(loginPage({ clientName, request: id, error: "That passphrase is not correct." }));
          return;
        }

        const approved = provider.approve(id);
        if (!approved) {
          res.status(400).send(errorPage("This authorisation request expired. Start again from your client."));
          return;
        }

        const target = new URL(approved.params.redirectUri);
        target.searchParams.set("code", approved.code);
        if (approved.params.state) target.searchParams.set("state", approved.params.state);
        log.info({ clientId: pending.clientId }, "authorisation granted");
        res.redirect(target.href);
      })();
    },
  );

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      resourceServerUrl: issuer,
      scopesSupported: [MCP_SCOPE],
      resourceName: "Cognitive-mirror",
    }),
  );

  const guard = requireBearerAuth({
    verifier: provider,
    requiredScopes: [MCP_SCOPE],
    resourceMetadataUrl: new URL("/.well-known/oauth-protected-resource", issuer).href,
  });

  log.info({ issuer: issuer.href, clients: store.countClients() }, "OAuth enabled — /mcp requires a bearer token");
  return { router, guard, store };
}

function nameOf(client: { client_name?: string } | undefined, fallback: string): string {
  return client?.client_name?.trim() || fallback;
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cognitive-mirror</title>
<body style="margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color-scheme:light dark">
<p style="max-width:24rem;text-align:center">${message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</p>
</body>`;
}
