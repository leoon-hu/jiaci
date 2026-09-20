/**
 * 路径分类（中间件用，纯函数便于测试）：
 * - public：不登录也能看——落地页、登录、法务、公开词条页、静态资源，以及接口（接口自己校验会话）；
 * - app：登录后才有的页面（与 src/app/(app)/ 下的目录一致），匿名访问跳登录并带上原路径；
 * - unknown：都不是，交给 Next 出 404。
 * 以前匿名访问任何未知路径都跳登录页，搜索引擎把页面里长得像路径的文本当链接去抓，
 * Search Console 里就多出一堆「/xxx 重定向到 /login?next=/xxx」的网址；现在这些直接 404。
 */
const PUBLIC = [/^\/login/, /^\/legal\//, /^\/api\//, /^\/_next\//, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon\.ico$/, /^\/icon\.svg$/, /^\/apple-touch-icon\.png$/, /^\/logo-wordmark\.svg$/, /^\/sw\.js$/,
  // 落地页用的截图、分享卡片图、站长微信二维码与爬虫入口
  /^\/shots\//, /^\/og\.png$/, /^\/wechat-qrcode\.jpg$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/sitemap\//,
  // 匿名可看的词条与词库页（供搜索引擎收录）
  /^\/dict(\/|$)/];
const APP = /^\/(home|study|wordbooks|import|settings|run)(\/|$)|^\/word\//;

export type PathKind = "public" | "app" | "unknown";

export function classifyPath(pathname: string): PathKind {
  if (pathname === "/" || PUBLIC.some((re) => re.test(pathname))) return "public";
  return APP.test(pathname) ? "app" : "unknown";
}
