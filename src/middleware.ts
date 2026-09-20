import { NextResponse, type NextRequest } from "next/server";
import { classifyPath } from "@/lib/routes";

/** 未登录仅可见登录页、静态页与公开词条页（需求 A5）：这里只检查 Cookie 是否存在，具体有效性由页面 / API 校验 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 把路径透给 Server Component：会话过期（Cookie 还在但已失效）时页面要靠它拼出带 next 的登录地址（审计 NU09）
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };
  // 不存在的路径不跳登录，交给 Next 出 404（登录与否都一样）
  if (classifyPath(pathname) !== "app") return pass();
  if (!req.cookies.get("aiword_session")?.value) {
    // 反向代理后 req.nextUrl 的主机是内部的 localhost:3000，跳转地址要按代理传来的协议与主机拼。
    // 主机名来自请求头、攻击者可控，所以配了 SITE_HOST 就只认它，避免把登录页指到别的站（审计 F006）
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
    const claimed = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const allowed = process.env.SITE_HOST?.trim();
    const host = allowed && claimed !== allowed ? allowed : claimed;
    // 分享出去的 /word/… 链接：没登录的人看公开词条页（URL 里空格写成下划线），页面上再引导登录
    if (pathname.startsWith("/word/")) return NextResponse.redirect(`${proto}://${host}/dict/${pathname.slice(6).replace(/%20| /g, "_")}`);
    return NextResponse.redirect(`${proto}://${host}/login?next=${encodeURIComponent(pathname)}`);
  }
  return pass();
}

// 静态文件不必进 middleware：线上这些路径已由 nginx 直接发送，本机开发下也只是白跑一次函数
export const config = { matcher: ["/((?!_next/static|_next/image|icons/|shots/|favicon\\.ico|apple-touch-icon\\.png|logo-wordmark\\.svg|og\\.png|wechat-qrcode\\.jpg|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js).*)"] };
