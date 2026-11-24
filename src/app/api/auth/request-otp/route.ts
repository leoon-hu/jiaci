import { z } from "zod";
import { handle, ok, readJson, fail } from "@/lib/api";
import { requestOtp } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { getAuthMode } from "@/lib/auth-mode";

export const POST = handle(async (req) => {
  // The email endpoint is disabled server-side, not merely hidden in the UI.
  if (getAuthMode() !== "email") return fail(404, "接口不可用", "not_found");
  const { email } = z.object({ email: z.string().max(254) }).parse(await readJson(req));
  const r = await requestOtp(email, clientIp(req));
  return ok({ sent: true, resendSeconds: r.resendSeconds, ...(r.devCode ? { devCode: r.devCode } : {}) });
});
