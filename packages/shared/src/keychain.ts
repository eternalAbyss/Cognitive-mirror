import { execFileSync } from "node:child_process";

/**
 * Best-effort macOS Keychain read (design §4: secrets in Keychain, never plaintext
 * env on the Mac Mini). Returns undefined on any platform other than macOS, or
 * when the item is missing — callers fall back to environment variables.
 *
 *   security add-generic-password -a "$USER" -s cm-anthropic-api-key -w "sk-ant-..."
 */
export function getSecret(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
