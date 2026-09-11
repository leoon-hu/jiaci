import { Resend } from "resend";
import { getConfig } from "./config";
import { ApiError } from "./api";

/** 日志里的邮箱只留首字符与域名，避免服务端日志沉淀完整地址（审计 F009 / F168） */
export const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

/**
 * 发送验证码邮件：有 RESEND_API_KEY 时真实发送；没有 Key 时只在非生产环境把验证码返回给页面显示。
 * 生产环境缺 Key 一律拒绝发送——否则「开发模式」判定条件（无 Key）与生产漏配完全重合，
 * 任何人都能从接口响应里读到别人的验证码（审计 F001）。
 */
export async function sendOtpMail(to: string, code: string): Promise<{ delivered: boolean; devCode?: string }> {
  const key = process.env.RESEND_API_KEY;
  const siteName = await getConfig("site.name");
  const expire = await getConfig("otp.expire_minutes");
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[mail] 未配置 RESEND_API_KEY，拒绝发送验证码 → ${maskEmail(to)}`);
      throw new ApiError(503, "邮件服务未配置，暂时无法登录，请稍后再试", "mail_unconfigured");
    }
    console.log(`[mail:dev] 验证码 ${code} → ${to}（${expire} 分钟内有效）`);
    return { delivered: false, devCode: code };
  }
  const resend = new Resend(key);
  const from = `${await getConfig("mail.from_name")} <${await getConfig("mail.from_address")}>`;
  const domain = await getConfig("site.domain");
  // 验证码不放进主题：锁屏 / 列表的通知预览就能看到（审计 F172）
  const { error } = await resend.emails.send({
    from,
    to,
    subject: `${siteName} 登录验证码`,
    text: `你的 ${siteName}（${domain}）登录验证码是 ${code}，${expire} 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
  });
  // Resend SDK 不抛错，失败放在返回值的 error 里；发不出去要明确告诉用户，并把原因记到日志
  if (error) {
    console.error(`[mail] 发送失败 → ${maskEmail(to)}：${error.name} ${error.message}`);
    throw new ApiError(502, "验证码邮件发送失败，请稍后再试或换一个邮箱", "mail_failed");
  }
  return { delivered: true };
}
