import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isValidEmail, normalizeEmail } from "./email";

/** Both modes are exclusive. Unknown settings fail closed instead of falling back. */
export type AuthMode = "email" | "api_key";

export function getAuthMode(): AuthMode {
  const mode = (process.env.AUTH_MODE ?? "email").trim().toLowerCase();
  if (mode === "email" || mode === "api_key") return mode;
  throw new Error("AUTH_MODE must be email or api_key");
}

const bindingsSchema = z.array(z.object({
  email: z.string().transform(normalizeEmail).refine((email) => email.length <= 254 && isValidEmail(email)),
  key: z.string().trim().regex(/^[0-9a-fA-F]{64}$/),
})).min(1);

function getPrivateApiKeyBindings() {
  const configured = process.env.AUTH_API_KEYS?.trim();
  let input: unknown = [{ email: process.env.AUTH_PRIVATE_USER, key: process.env.AUTH_API_KEY }];
  if (configured) {
    try { input = JSON.parse(configured); }
    catch { throw new Error("AUTH_API_KEYS must be a JSON array"); }
  }

  const parsed = bindingsSchema.safeParse(input);
  if (!parsed.success) {
    const name = configured ? "AUTH_API_KEYS" : "AUTH_API_KEY and AUTH_PRIVATE_USER";
    throw new Error(`${name} must provide at least one binding with a valid email and a 64-character hexadecimal key`);
  }
  if (new Set(parsed.data.map(({ key }) => key)).size !== parsed.data.length) {
    throw new Error("AUTH_API_KEYS must contain unique keys");
  }
  return parsed.data;
}

export function getPrivateUserEmails(): string[] {
  return [...new Set(getPrivateApiKeyBindings().map(({ email }) => email))];
}

export function getPrivateUserEmailForKey(candidate: string): string | null {
  const candidateHash = createHash("sha256").update(candidate).digest();
  let matchedEmail: string | null = null;
  for (const { email, key } of getPrivateApiKeyBindings()) {
    const keyHash = createHash("sha256").update(key).digest();
    if (timingSafeEqual(candidateHash, keyHash)) matchedEmail = email;
  }
  return matchedEmail;
}
