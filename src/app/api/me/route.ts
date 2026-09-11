import { withUser, ok } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { getCurrentWordbookId } from "@/lib/study";
import { getConfig } from "@/lib/config";

export const GET = withUser(async (_req, _ctx, user) => {
  // settings 与 termsVersion 都在会话校验时读到的 user 行上（getSettings 走请求级缓存，不再查库）
  const [settings, currentWordbookId, version] = await Promise.all([
    getSettings(user.id), getCurrentWordbookId(user.id), getConfig("legal.version"),
  ]);
  // 同意的版本与当前版本不一致时前端提示重新确认（审计 F171）
  return ok({ id: user.id, email: user.email, settings, currentWordbookId, termsOutdated: user.termsVersion !== version });
});
