/**
 * README 与落地页用的截图：自动登录一个临时账号 → 把「雅思核心」设为当前词库并打几个分让列表有四色 → 截三张图到 public/shots/
 * 用法：npm run dev 后执行 `npm run readme:shots`。需要本机有内置词库与 AI 资料，且未配置 RESEND_API_KEY（验证码由接口直接返回）。
 * 环境变量：BASE_URL、CHROME、BOOK（词库名，默认 雅思核心）
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteTestAccounts } from "./cleanup.mjs";

const CH = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const BOOK = process.env.BOOK || "学术词汇";
const [W, H, SCALE] = [390, 844, 2];
const outDir = new URL("../public/shots", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "readme-shots-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EMAIL = `shots-readme-${Date.now()}@example.com`;
let h;
const call = async (path, init) => {
  const r = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(h ?? {}), ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r;
};

// 登录 → 当前词库 → 打分（前五个认识、再三个已掌握，列表与首页才有内容可看）
const r1 = await call("/api/auth/request-otp", { method: "POST", body: JSON.stringify({ email: EMAIL }) });
const { devCode } = await r1.json();
if (!devCode) throw new Error("需要开发模式（未配置 RESEND_API_KEY）才能自动登录");
const r2 = await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ email: EMAIL, code: devCode }) });
const cookie = /aiword_session=([^;]+)/.exec(r2.headers.get("set-cookie") ?? "")?.[1];
if (!cookie) throw new Error("登录失败");
h = { cookie: `aiword_session=${cookie}` };
const { wordbooks } = await (await call("/api/wordbooks")).json();
const book = wordbooks.find((b) => b.type === "builtin" && b.name === BOOK);
if (!book) throw new Error(`本机没有内置词库「${BOOK}」，先 npm run wordbooks:build`);
await call("/api/wordbooks/current", { method: "PUT", body: JSON.stringify({ wordbookId: book.id }) });
const { rows } = await (await call(`/api/wordbooks/${book.id}/words?limit=12`)).json();
const today = new Date().toLocaleDateString("sv-SE");
for (const [k, row] of rows.entries()) {
  const result = k < 5 ? "know" : k < 8 ? "master" : null;
  if (result) await call("/api/study/rate", { method: "POST", body: JSON.stringify({ wordId: row.id, result, date: today, clientTs: `shots-${k}` }) });
}

const SHOTS = [
  // 学习卡：点开答案，再关掉首次出现的长按提示条
  ["study", "/study", ["document.querySelector('.front')?.click()", "document.querySelector('.lp-tip-close')?.click()"]],
  ["word", "/word/abandon", ""],
  // 单词列表：往下滚过词库头，让筛选行吸顶、单词行占满屏幕
  ["wordbook", `/wordbooks/${book.id}`, "window.scrollTo(0, 196)"],
  ["home", "/home", ""],
];
const port = 9433 + Math.floor(Math.random() * 100);
const chrome = spawn(CH, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, "--no-first-run", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
async function json(u) { for (let i = 0; i < 40; i++) { try { return await (await fetch(u)).json(); } catch { await sleep(250); } } throw new Error("chrome not ready"); }
const targets = await json(`http://127.0.0.1:${port}/json`);
const page = targets.find((t) => t.type === "page") ?? targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); console.log("TIMEOUT " + method); r({ result: {} }); } }, 20000); });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: true });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
// 安装引导横幅（需求 4.1）不进预览图：预先写一个很远的静默期，首页截的是干净的学习首页
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('aiword.installTip',String(Date.now()+1e11))}catch(e){}" });
await send("Network.setCookie", { name: "aiword_session", value: cookie, url: BASE, domain: new URL(BASE).hostname, path: "/", httpOnly: true });
try {
  for (const [name, path, js] of SHOTS) {
    await send("Page.navigate", { url: BASE + path });
    await sleep(3000);
    for (const step of Array.isArray(js) ? js : js ? [js] : []) { await send("Runtime.evaluate", { expression: step }); await sleep(1500); }
    // 开发模式左下角的 Next 调试按钮不该出现在截图里
    await send("Runtime.evaluate", { expression: "document.querySelector('nextjs-portal')?.remove()" });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (!shot.result?.data) throw new Error("截图失败：" + name);
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
    console.log("✓", name);
  }
} finally {
  await deleteTestAccounts(EMAIL).then((n) => console.log(`清理：测试账号 ${n} 个`), (e) => console.log("清理失败：" + e.message));
  ws.close();
  // Chrome 退出后才能删临时 profile，否则它还在往里写
  await new Promise((r) => { chrome.once("exit", r); chrome.kill(); });
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
