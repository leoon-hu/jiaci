import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requestOtp } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

export const POST = handle(async (req) => {
  const { email } = z.object({ email: z.string().max(254) }).parse(await readJson(req));
  const r = await requestOtp(email, clientIp(req));
  return ok({ sent: true, resendSeconds: r.resendSeconds, ...(r.devCode ? { devCode: r.devCode } : {}) });
});
