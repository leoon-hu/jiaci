/**
 * 页面截图回归：自动用开发模式验证码登录 → 逐页导航 → 截图 + 收集控制台错误
 * 用法：npm run dev 后执行 `npm run e2e:shots [-- 390 844]`（默认手机视口；桌面用 1280 900）
 * 需要未配置 RESEND_API_KEY（验证码由接口直接返回）。环境变量：BASE_URL、CHROME
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { deleteTestAccounts } from "./cleanup.mjs";
const CH = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const [,, width = "390", height = "844"] = process.argv;
const outDir = new URL(`./out/shots-${width}`, import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
// 通过接口登录拿到会话 Cookie（开发模式验证码直接返回）
const EMAIL = `shots-${Date.now()}@example.com`;
async function loginCookie() {
  const email = EMAIL;
  const r1 = await fetch(`${BASE}/api/auth/request-otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const { devCode } = await r1.json();
  if (!devCode) throw new Error("需要开发模式（未配置 RESEND_API_KEY）才能自动登录");
  const r2 = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code: devCode }) });
  const cookie = r2.headers.get("set-cookie") ?? "";
  const m = /aiword_session=([^;]+)/.exec(cookie);
  if (!m) throw new Error("登录失败");
  // 新用户自建一个截图用词库（不依赖内置词库；词来自 dict_entry）并设为当前，让列表与学习页有内容
  const h = { "Content-Type": "application/json", cookie: `aiword_session=${m[1]}` };
  const book = await (await fetch(`${BASE}/api/wordbooks`, { method: "POST", headers: h, body: JSON.stringify({ name: "截图测试词库" }) })).json();
  if (!book.id) throw new Error("新建词库失败：" + JSON.stringify(book));
  await fetch(`${BASE}/api/wordbooks/${book.id}/words`, { method: "POST", headers: h, body: JSON.stringify({ input: ["abandon", "benevolent", "candid", "diligent", "eloquent", "feasible", "gregarious", "hypothesis", "abolish", "abrupt", "absurd", "abundant", "give up", "as well"].join("\n") }) });
  await fetch(`${BASE}/api/wordbooks/current`, { method: "PUT", headers: h, body: JSON.stringify({ wordbookId: book.id }) });
  return m[1];
}
const sessionCookie = await loginCookie();
const PAGES = [
  ["login", "/login", ""],
  ["home", "/home", ""],
  ["wordbooks", "/wordbooks", ""],
  ["wordbook", "/wordbooks/__BOOK__", ""],
  ["wordbook-zh", "/wordbooks/__BOOK__", "document.querySelectorAll('.seg button')[2].click()"],
  ["word", "/word/abandon", ""],
  ["word-phrase", "/word/give%20up", ""],
  ["word-note", "/word/abandon", "[...document.querySelectorAll('.detail-ops button')].find(b=>b.textContent.includes('备注'))?.click()"],
  ["study-front", "/study", ""],
  ["study-answer", "/study", "document.querySelector('.front')?.click()"],
  // 跑步模式：点「准备音频」，等音频准备好（现成片段几秒钟）再截「开始播放」态
  ["run", "/run", "new Promise(r=>{const t=Date.now();let clicked=false;(function w(){const p=document.querySelector('.run-prepare');if(p&&!clicked){clicked=true;p.click();}if(document.querySelector('.run-start')||Date.now()-t>60000)r();else setTimeout(w,300)})()})"],
  ["import", "/import", ""],
  ["new", "/wordbooks/new", ""],
  ["settings", "/settings", ""],
  ["done", "/study/done?new=20&review=18&rate=92%25", ""],
];
const port = 9333 + Math.floor(Math.random() * 100);
const chrome = spawn(CH, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`, "--no-first-run", "--user-data-dir=" + outDir + "/profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(u) { for (let i = 0; i < 40; i++) { try { const r = await fetch(u); return await r.json(); } catch { await sleep(250); } } throw new Error("chrome not ready"); }
const targets = await json(`http://127.0.0.1:${port}/json`);
const page = targets.find((t) => t.type === "page") ?? targets[0];
console.log("targets:", targets.map((t) => t.type + ":" + t.url).join(", "));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); console.log("TIMEOUT " + method); r({ result: {} }); } }, 20000); });
await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 1, mobile: +width < 700 });
const ck = await send("Network.setCookie", { name: "aiword_session", value: sessionCookie, url: BASE, domain: new URL(BASE).hostname, path: "/", httpOnly: true });
console.log("setCookie:", JSON.stringify(ck.result));
// 找词库 id
const nav = await send("Page.navigate", { url: BASE + "/api/wordbooks" });
console.log("navigate:", JSON.stringify(nav.result ?? nav.error));
let book = null;
for (let i = 0; i < 30 && !book; i++) {
  await sleep(1000);
  const wb = await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
  try { book = JSON.parse(wb.result?.result?.value ?? "").wordbooks[0].id; } catch { /* not ready */ }
}
if (!book) { console.log("无法读取词库列表（可能未登录）"); ws.close(); chrome.kill(); process.exit(1); }
console.log("book", book);
const report = [];
for (const [name, path, js] of PAGES) {
  console.log("→ " + name); events.length = 0;
  await send("Page.navigate", { url: BASE + path.replace("__BOOK__", book) });
  await sleep(2600);
  if (js) { await send("Runtime.evaluate", { expression: js, awaitPromise: true }); await sleep(2200); }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot.result?.data) writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
  const errs = events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") || (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
    .map((e) => e.method === "Runtime.exceptionThrown" ? "EXC " + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text) : e.method === "Log.entryAdded" ? "LOG " + e.params.entry.text : "CON " + e.params.args.map((a) => a.value ?? a.description).join(" "))
    .filter((t) => !/favicon|dictionaryapi|net::ERR_/i.test(t));
  const title = (await send("Runtime.evaluate", { expression: "document.title + ' | ' + location.pathname", returnByValue: true })).result?.result?.value ?? "?";
  report.push(`${errs.length ? "✗" : "✓"} ${name.padEnd(14)} ${title}${errs.length ? "\n    " + errs.slice(0, 3).join("\n    ").slice(0, 900) : ""}`);
}
console.log(report.join("\n"));
ws.close(); chrome.kill();
try { await deleteTestAccounts(EMAIL); console.log("清理：测试账号已删除"); } catch (e) { console.log("清理测试账号失败：" + e.message); }
process.exit(report.some((r) => r.startsWith("✗")) ? 1 : 0);
