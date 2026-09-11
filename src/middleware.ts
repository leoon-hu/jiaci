import { NextResponse, type NextRequest } from "next/server";

/** 未登录仅可见登录页与静态页（需求 A5）：这里只检查 Cookie 是否存在，具体有效性由页面 / API 校验 */
const PUBLIC = [/^\/login/, /^\/legal\//, /^\/api\//, /^\/_next\//, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon\.ico$/, /^\/icon\.svg$/, /^\/apple-touch-icon\.png$/, /^\/logo-wordmark\.svg$/, /^\/sw\.js$/,
  // 落地页用的截图、分享卡片图与爬虫入口
  /^\/shots\//, /^\/og\.png$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 把路径透给 Server Component：会话过期（Cookie 还在但已失效）时页面要靠它拼出带 next 的登录地址（审计 NU09）
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers } });
  };
  if (PUBLIC.some((re) => re.test(pathname))) return pass();
  if (pathname === "/") return pass();
  if (!req.cookies.get("aiword_session")?.value) {
    // 反向代理后 req.nextUrl 的主机是内部的 localhost:3000，跳转地址要按代理传来的协议与主机拼。
    // 主机名来自请求头、攻击者可控，所以配了 SITE_HOST 就只认它，避免把登录页指到别的站（审计 F006）
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
    const claimed = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const allowed = process.env.SITE_HOST?.trim();
    const host = allowed && claimed !== allowed ? allowed : claimed;
    return NextResponse.redirect(`${proto}://${host}/login?next=${encodeURIComponent(pathname)}`);
  }
  return pass();
}

// 静态文件不必进 middleware：线上这些路径已由 nginx 直接发送，本机开发下也只是白跑一次函数
export const config = { matcher: ["/((?!_next/static|_next/image|icons/|shots/|favicon\\.ico|apple-touch-icon\\.png|logo-wordmark\\.svg|og\\.png|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|sw\\.js).*)"] };
