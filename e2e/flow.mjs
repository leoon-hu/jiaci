/**
 * 端到端测试（Chrome 远程调试协议，无需 Playwright）：匿名的公开词条页与 sitemap → 登录页真实输入 → 自建测试词库（词典词 + 短语）→ 选词库 → 列表拖拽 + 撤销 + 长按多选 → 长按打分 → 详情页词典兜底
 * 不依赖任何内置词库：每次用新账号，在页面内通过接口新建「e2e 测试词库」，结束后删除。
 * 用法：npm run dev 后执行 `npm run e2e`（默认 http://localhost:3000，输出截图到 e2e/out）
 * 环境变量：BASE_URL、CHROME（Chrome 可执行文件路径）
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { deleteTestAccounts } from "./cleanup.mjs";
const CH = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const outDir = process.argv[2] || new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const port = 9500 + Math.floor(Math.random() * 100);
const chrome = spawn(CH, [`--remote-debugging-port=${port}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=390,844", "--no-first-run", "--user-data-dir=" + outDir + "/profile-e2e", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 轮询等待页面上的条件成立，最多等 ms 毫秒；比一串固定 sleep 稳（审计 F157） */
async function waitFor(expr, ms = 8000, step = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evalJs(`(()=>{try{return !!(${expr})}catch{return false}})()`)) return true;
    await sleep(step);
  }
  return false;
}
async function json(u) { for (let i = 0; i < 40; i++) { try { const r = await fetch(u); return await r.json(); } catch { await sleep(250); } } throw new Error("chrome not ready"); }
const targets = await json(`http://127.0.0.1:${port}/json`);
const page = targets.find((t) => t.type === "page") ?? targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);

// 收尾统一走这里：中途抛异常时 Chrome 不退出、测试账号与词库会留在库里（审计 F156）
let testEmail = null, cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { ws.close(); } catch { /* 已关闭 */ }
  try { chrome.kill(); } catch { /* 已退出 */ }
  if (testEmail) {
    try { await deleteTestAccounts(testEmail); console.log("清理：测试账号已删除"); }
    catch (e) { console.log("清理测试账号失败：" + e.message); }
  }
}
const bail = (e) => { console.error("e2e 中断：", e?.stack || e?.message || e); cleanup().finally(() => process.exit(1)); };
process.on("uncaughtException", bail);
process.on("unhandledRejection", bail);
process.on("SIGINT", () => cleanup().finally(() => process.exit(130)));
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); r({ timeout: true }); } }, 20000); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); if (s.result?.data) writeFileSync(`${outDir}/${name}.png`, Buffer.from(s.result.data, "base64")); };
const mouse = async (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
const rect = async (sel, idx = 0) => JSON.parse(await evalJs(`(()=>{const el=document.querySelectorAll(${JSON.stringify(sel)})[${idx}];if(!el)return "null";const r=el.getBoundingClientRect();return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height})})()`));
const log = [];
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

// ---- 0. 公开词条页（匿名，直接用 fetch，不带 Cookie）----
{
  const get = async (path) => { const r = await fetch(BASE + path, { redirect: "manual" }); return { status: r.status, location: r.headers.get("location") ?? "", body: r.status === 200 ? await r.text() : "" }; };
  const w = await get("/dict/abandon");
  log.push(`公开页：/dict/abandon → ${w.status} ${w.status === 200 ? "✓" : "✗"}，标题含「是什么意思」 ${w.body.includes("是什么意思") ? "✓" : "✗"}，正文有例句块 ${w.body.includes('id="examples"') ? "✓" : "✗"}，canonical ${/rel="canonical" href="[^"]*\/dict\/abandon"/.test(w.body) ? "✓" : "✗"}，无个人数据块 ${!w.body.includes("学习记录") && !w.body.includes("我的备注") ? "✓" : "✗"}`);
  const p = await get("/dict/give_up");
  log.push(`公开页：短语 /dict/give_up → ${p.status} ${p.status === 200 && p.body.includes("give up") ? "✓" : "✗"}`);
  const nf = await get("/dict/zzzzqqx");
  log.push(`公开页：查不到的词 → ${nf.status} ${nf.status === 404 ? "✓" : "✗"}`);
  const b = await get("/dict/book/ielts-core/2");
  log.push(`公开页：词库第 2 页 → ${b.status} ${b.status === 200 && b.body.includes("雅思核心") ? "✓" : "✗"}；/1 归到无页码地址 ${(await get("/dict/book/ielts-core/1")).status === 308 ? "✓" : "✗"}`);
  const r = await get("/word/give%20up");
  log.push(`公开页：匿名访问 /word/give%20up → ${r.status} 到 ${r.location} ${r.status === 307 && r.location.endsWith("/dict/give_up") ? "✓" : "✗"}；匿名访问 /home 仍跳登录 ${(await get("/home")).location.includes("/login") ? "✓" : "✗"}`);
  const sm = await get("/sitemap.xml");
  const shard = await get("/sitemap/words-0.xml");
  log.push(`公开页：sitemap 索引 ${sm.status === 200 && sm.body.includes("/sitemap/pages.xml") && sm.body.includes("/sitemap/words-0.xml") ? "✓" : "✗"}，分片有词条 ${shard.status === 200 && shard.body.includes("/dict/abandon") ? "✓" : "✗"}，robots 放行 /dict/ ${(await get("/robots.txt")).body.includes("Allow: /dict/") ? "✓" : "✗"}`);
}

// ---- 1. 登录流程 ----
await send("Page.navigate", { url: BASE + "/login" }); await sleep(3000);
const EMAIL = `e2e-${Date.now()}@example.com`;
testEmail = EMAIL;
await evalJs(`(()=>{const i=document.querySelector('#email');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(EMAIL)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await sleep(300);
await evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('发送验证码')).click()`);
await sleep(2500);
const devCode = await evalJs(`document.querySelector('.dev-code b')?.textContent`);
log.push(`登录：发送验证码 → 页面显示开发验证码 ${devCode ? "✓ " + devCode : "✗ 未显示"}`);
await shot("e2e-login-code");
if (devCode) {
  for (let i = 0; i < 6; i++) { await evalJs(`(()=>{const i=document.querySelectorAll('.code-boxes input')[${i}];const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'${devCode[i]}');i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(80); }
  await sleep(3500);
  log.push(`登录：输入验证码后跳转 → ${await evalJs("location.pathname")} ${(await evalJs("location.pathname")) === "/home" ? "✓" : "✗"}`);
}
// ---- 1b. 自建测试词库（不依赖内置词库；词来自 dict_entry，含短语）----
const FIXTURE_WORDS = ["abandon", "benevolent", "candid", "diligent", "eloquent", "feasible", "gregarious", "hypothesis", "abolish", "abrupt", "absurd", "abundant", "give up", "as well"];
const fixture = JSON.parse(await evalJs(`(async()=>{const r=await fetch('/api/wordbooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'e2e 测试词库'})});const b=await r.json();if(!b.id)return JSON.stringify({error:b});const a=await fetch('/api/wordbooks/'+b.id+'/words',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:${JSON.stringify(FIXTURE_WORDS.join("\n"))}})});const j=await a.json();return JSON.stringify({id:b.id,added:(j.added||[]).length,bad:j.bad})})()`) || "{}");
log.push(`准备：新建测试词库并添加 ${FIXTURE_WORDS.length} 个词条（含短语）→ 成功 ${fixture.added ?? 0} ${fixture.added === FIXTURE_WORDS.length ? "✓" : "✗ " + JSON.stringify(fixture)}`);
// ---- 2. 选择词库（新用户没有当前词库）----
await send("Page.navigate", { url: BASE + "/wordbooks" }); await sleep(3000);
const ROW = "[...document.querySelectorAll('.book-row')].find(r=>r.textContent.includes('e2e 测试词库'))";
const bookTabs = await evalJs("[...document.querySelectorAll('.books-tabs .tab')].map(t=>t.textContent).join('/')");
const activeTab = await evalJs("document.querySelector('.books-tabs .tab.active')?.textContent");
log.push(`词库：Tab ${bookTabs} ${/^正在学习\/我的词库 1\/内置词库/.test(bookTabs ?? "") ? "✓" : "✗"}；新用户没有当前词库、有自建词库 → 默认停在「${activeTab}」 ${activeTab?.startsWith("我的词库") ? "✓" : "✗"}`);
await evalJs(`[...(${ROW}?.querySelectorAll('button')||[])].find(b=>b.textContent.includes('设为当前学习'))?.click()`); await sleep(1500);
log.push(`词库：测试词库设为当前学习 → 标签 ${await evalJs(`${ROW}?.querySelector('.tag-current')?.textContent`) === "学习中" ? "✓" : "✗"}`);
await evalJs("document.querySelector('.books-tabs .tab')?.click()"); await sleep(500);
log.push(`词库：切到「正在学习」Tab → 显示 ${await evalJs("document.querySelector('#tabpanel-0 .book-row .title')?.textContent")} ${await evalJs("document.querySelector('#tabpanel-0 .book-row .title')?.textContent") === "e2e 测试词库" ? "✓" : "✗"}`);
// ---- 3. 列表拖拽：把词拖到「已掌握」按钮上 → 绿色实心，toast 上「撤销」→ 恢复；再拖一次等提交；长按多选批量已掌握 ----
await evalJs(`${ROW}?.click()`); await sleep(3000);
/** 把第 i 行滚到视口中间再量坐标：列表上方的说明文字长短会变，坐标不能提前算死一次用到底 */
const rowRect = async (i) => {
  await evalJs(`document.querySelectorAll('.s-content')[${i}]?.scrollIntoView({block:'center'})`);
  await sleep(300);
  return rect(".s-content", i);
};
const row = await rowRect(2);
/** 按住第 i 行往右拖一点，把行内的操作按钮条露出来；返回按下的坐标 */
const grabRow = async (i) => {
  const row = await rowRect(i);
  const y = row.y + row.h / 2;
  await mouse("mousePressed", row.x + 20, y); await sleep(50);
  for (let x = row.x + 30; x <= row.x + 90; x += 30) { await mouse("mouseMoved", x, y); await sleep(30); }
  return { row, y };
};
const optBox = (cls) => evalJs(`(()=>{const e=document.querySelector('.srow.dragging .s-opt.${cls}');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
const chipText = () => evalJs("document.querySelector('.s-chip .t')?.textContent");
/** 把第 i 行的词拖到某个操作按钮上松手（按类名定位，不写死按钮个数）；返回松手前高亮的按钮与卡片上的字 */
const dragToOpt = async (i, cls, shotName) => {
  const { row } = await grabRow(i);
  const b = await optBox(cls);
  for (let x = row.x + 120; x < b.x; x += 30) { await mouse("mouseMoved", x, b.y); await sleep(30); }
  await mouse("mouseMoved", b.x, b.y); await sleep(200);
  const picked = await evalJs("document.querySelector('.s-opt.active')?.textContent");
  const chip = await chipText();
  if (shotName) await shot(shotName);
  await mouse("mouseReleased", b.x, b.y); await sleep(600);
  return { picked, chip };
};
/** 拖到行外松手：按钮只在这一行里，行外没有落点，应当什么都不做 */
const dragOutside = async (i) => {
  const { row, y } = await grabRow(i);
  await mouse("mouseMoved", row.x + row.w / 2, y + 130); await sleep(200);
  const picked = await evalJs("document.querySelector('.s-opt.active')?.textContent");
  const chip = await chipText();
  await shot("e2e-drag-outside");
  await mouse("mouseReleased", row.x + row.w / 2, y + 130); await sleep(500);
  return { picked, chip };
};
const pieAt = (i) => evalJs(`document.querySelectorAll('.s-content .pie')[${i}]?.className`);
if (row) {
  const wordAt2 = await evalJs("document.querySelectorAll('.s-content .word')[2]?.textContent");
  // 拖出行外松手：不该有任何操作
  const outside = await dragOutside(2);
  const stOut = await pieAt(2);
  log.push(`列表：把第 3 行拖到行外 → 卡片跟到页面上「${outside.chip}」 ${outside.chip === wordAt2 ? "✓" : "✗"}，高亮「${outside.picked}」 ${outside.picked === "取消" ? "✓" : "✗"}，松手后状态不变 ${stOut?.includes("st-new") ? "✓" : `✗（${stOut}）`}`);
  // 加进度：按「认识」记一次，红色未开始 → 黄色学习中
  const before1 = await pieAt(1);
  const prog = await dragToOpt(1, "know", "e2e-drag-progress");
  const after1 = await pieAt(1);
  const progToast = await evalJs("document.querySelector('.toast.show')?.textContent");
  log.push(`列表：把第 2 行拖到「${prog.picked}」→ ${before1?.match(/st-\w+/)?.[0]} → ${after1?.match(/st-\w+/)?.[0]} ${before1?.includes("st-new") && after1?.includes("st-learning") ? "✓" : "✗"}，提示「${progToast}」 ${progToast?.includes("已记一次") ? "✓" : "✗"}`);
  const { picked, chip } = await dragToOpt(2, "master", "e2e-drag-row");
  log.push(`列表：把第 3 行拖到「已掌握」按钮上 → 跟手卡片「${chip}」 ${chip === wordAt2 ? "✓" : "✗"}，高亮按钮「${picked}」 ${picked?.startsWith("已掌握") ? "✓" : "✗"}`);
  const st1 = await pieAt(2);
  const undoBtn = await evalJs("document.querySelector('.toast.with-action.show .toast-btn')?.textContent");
  log.push(`列表：松手后第 3 行立即变为 ${st1} ${st1?.includes("st-mastered") ? "✓" : "✗"}，toast 带「${undoBtn}」按钮 ${undoBtn === "撤销" ? "✓" : "✗"}`);
  await evalJs("document.querySelector('.toast.with-action.show .toast-btn')?.click()"); await sleep(400);
  const st2 = await pieAt(2);
  log.push(`列表：点「撤销」后第 3 行恢复为 ${st2} ${st2?.includes("st-new") ? "✓" : "✗"}`);
  await dragToOpt(2, "master"); await sleep(6500);
  await send("Page.reload"); await sleep(3000);
  const st3 = await pieAt(2);
  log.push(`列表：再拖一次、等 5 秒提交后刷新，第 3 行仍为 ${st3} ${st3?.includes("st-mastered") ? "✓" : "✗"}`);
  await shot("e2e-drag-done");
  // 长按第 4 行进入多选，点第 5 行勾选，批量已掌握
  const r4 = await rowRect(3);
  if (r4) {
    await mouse("mousePressed", r4.x + r4.w / 2, r4.y + r4.h / 2); await sleep(700); await mouse("mouseReleased", r4.x + r4.w / 2, r4.y + r4.h / 2); await sleep(400);
    const bar = await evalJs("document.querySelector('.sel-bar .sel-count')?.textContent");
    await evalJs("document.querySelectorAll('.s-content')[4]?.click()"); await sleep(300);
    const cnt = await evalJs("document.querySelector('.sel-bar .sel-count')?.textContent");
    log.push(`列表：长按第 4 行 → 多选栏「${bar}」 ${bar === "已选 1 词" ? "✓" : "✗"}；点第 5 行 → 「${cnt}」 ${cnt === "已选 2 词" ? "✓" : "✗"}`);
    await evalJs("document.querySelectorAll('.s-content')[3]?.scrollIntoView({block:'center'})"); await sleep(300);
    await shot("e2e-multiselect");
    await evalJs("document.querySelector('.sel-bar .act-cancel')?.click()"); await sleep(300);
    const gone = await evalJs("!document.querySelector('.sel-bar') && !document.querySelector('.s-check')");
    log.push(`列表：点操作栏「取消」→ 退出多选、清空勾选 ${gone ? "✓" : "✗"}`);
    const r4b = await rowRect(3);
    await mouse("mousePressed", r4b.x + r4b.w / 2, r4b.y + r4b.h / 2); await sleep(700); await mouse("mouseReleased", r4b.x + r4b.w / 2, r4b.y + r4b.h / 2); await sleep(400);
    await evalJs("document.querySelectorAll('.s-content')[4]?.click()"); await sleep(300);
    await evalJs("document.querySelector('.sel-bar .act-master')?.click()"); await sleep(6500);
    await send("Page.reload"); await sleep(3000);
    const s4 = await pieAt(3), s5 = await pieAt(4);
    log.push(`列表：批量「已掌握」提交并刷新后第 4、5 行 ${s4?.includes("st-mastered") && s5?.includes("st-mastered") ? "✓" : `✗（${s4} / ${s5}）`}`);
  }
}
// ---- 3c. 详情浮层：点词开浮层、返回不重新加载列表（需求 3.2.5）----
await evalJs("window.scrollTo(0,240)"); await sleep(400);
await evalJs("window.__mark=1;window.__list=document.querySelector('.list')");
const sheetY = await evalJs("window.scrollY"), sheetRows = await evalJs("document.querySelectorAll('.srow').length");
await evalJs("document.querySelectorAll('.s-content')[5]?.click()");
const sheetOpen = await waitFor("document.querySelector('.word-sheet')", 10000); await sleep(600);
await shot("e2e-word-sheet");
const sheetPath = await evalJs("location.pathname");
const bgAlive = await evalJs("window.__mark===1 && window.__list===document.querySelector('.list')");
log.push(`详情浮层：点行 → 浮层打开 ${sheetOpen ? "✓" : "✗"}，地址 ${sheetPath} ${sheetPath?.startsWith("/word/") ? "✓" : "✗"}；底层列表没卸载、页面没刷新 ${bgAlive ? "✓" : "✗"}`);
await evalJs("document.querySelector('.word-sheet .back')?.click()");
const sheetClosed = await waitFor("!document.querySelector('.word-sheet')", 5000); await sleep(600);
const keptY = await evalJs("window.scrollY"), keptRows = await evalJs("document.querySelectorAll('.srow').length");
const kept = await evalJs("window.__mark===1 && window.__list===document.querySelector('.list')");
log.push(`详情浮层：返回 → 关闭 ${sheetClosed ? "✓" : "✗"}，列表没重新加载 ${kept ? "✓" : "✗"}，滚动位置 ${sheetY}→${keptY} ${Math.abs(sheetY - keptY) < 4 ? "✓" : "✗"}，行数 ${sheetRows}→${keptRows} ${sheetRows === keptRows ? "✓" : "✗"}`);

// ---- 3b. 内置词库：滚动到底自动加载下一批；排序加「按词频」 ----
await send("Page.navigate", { url: BASE + "/wordbooks" }); await sleep(3000);
await evalJs("[...document.querySelectorAll('.books-tabs .tab')].find(t=>t.textContent.startsWith('内置词库'))?.click()"); await sleep(500);
const BIG = "[...document.querySelectorAll('.book-row')].find(r=>r.textContent.includes('雅思词汇'))";
if (await evalJs(`!!${BIG}`)) {
  await evalJs(`${BIG}.click()`);
  await waitFor("document.querySelectorAll('.s-content').length > 0", 10000);
  const n1 = await evalJs("document.querySelectorAll('.s-content').length");
  await evalJs("window.scrollTo(0, document.body.scrollHeight)");
  await waitFor(`document.querySelectorAll('.s-content').length > ${n1}`, 10000);
  const n2 = await evalJs("document.querySelectorAll('.s-content').length");
  log.push(`内置词库：首屏 ${n1} 行，滚到底后 ${n2} 行 ${n1 > 0 && n2 > n1 ? "✓" : "✗"}`);
  await evalJs("window.scrollTo(0, 0)"); await sleep(300);
  await evalJs("document.querySelector('.toolbar .dd-btn')?.click()"); await sleep(300);
  const opt = await evalJs("[...document.querySelectorAll('.toolbar .dd-menu button')].map(o=>o.textContent.replace('✓','')).join('/')");
  await shot("e2e-sort-menu");
  await evalJs("[...document.querySelectorAll('.toolbar .dd-menu button')].find(b=>b.textContent.includes('按词频'))?.click()"); await sleep(2500);
  const first = await evalJs("document.querySelector('.s-content .word')?.textContent");
  log.push(`内置词库：排序选项 ${opt}，按词频第一个词「${first}」 ${opt.includes("按词频") && first ? "✓" : "✗"}`);
} else {
  // 没建内置词库的环境（还没跑 wordbooks:build）不算失败，但要说清楚少测了什么（审计 F157）
  log.push("内置词库：库里没有「雅思词汇」，跳过分页与排序检查（跑 npm run wordbooks:build 后再测）");
}
// ---- 4. 学习：正面 → 点击显示答案 → 长按认识上滑到已掌握 ----
await send("Page.navigate", { url: BASE + "/study" }); await sleep(4000);
await evalJs(`document.querySelector('.front')?.click()`); await sleep(3500);
const know = await rect(".rate-btn.rate-know");
log.push(`学习：点击正面显示答案 → 打分栏 ${know ? "✓" : "✗"}`);
if (know) {
  const cx = know.x + know.w / 2, cy = know.y + know.h / 2;
  await mouse("mousePressed", cx, cy); await sleep(600);
  const popped = await evalJs("!!document.querySelector('.rate-popup')");
  await mouse("mouseMoved", cx, cy - 10); await sleep(50);
  await mouse("mouseMoved", cx, cy - 50); await sleep(200);
  await shot("e2e-longpress");
  const hover = await evalJs("document.querySelector('.rate-popup')?.classList.contains('hover')");
  log.push(`学习：长按认识弹出「已掌握」${popped ? "✓" : "✗"}，上滑悬停高亮 ${hover ? "✓" : "✗"}`);
  await mouse("mouseReleased", cx, cy - 50); await sleep(2500);
  const toast = await evalJs("document.querySelector('.toast')?.textContent");
  log.push(`学习：松手 → 提示「${toast}」，回到正面 ${await evalJs("!!document.querySelector('.front')") ? "✓" : "✗"}，进度 ${await evalJs("document.querySelector('.study-top .count')?.textContent")}`);
  // 普通点击「模糊」
  await evalJs(`document.querySelector('.front')?.click()`); await sleep(3000);
  const fz = await rect(".rate-btn.rate-fuzzy");
  if (fz) { await mouse("mousePressed", fz.x + fz.w / 2, fz.y + fz.h / 2); await sleep(80); await mouse("mouseReleased", fz.x + fz.w / 2, fz.y + fz.h / 2); await sleep(2500); }
  log.push(`学习：点击模糊 → 提示「${await evalJs("document.querySelector('.toast')?.textContent")}」，进度 ${await evalJs("document.querySelector('.study-top .count')?.textContent")}`);
  await shot("e2e-after-fuzzy");
}
// ---- 5. 详情页：没有 AI 资料时用词典字段兜底（单词与短语）----
await send("Page.navigate", { url: BASE + "/word/abandon" }); await sleep(3500);
const ph = await evalJs("document.querySelector('.entry-sub .phonetic')?.textContent");
const def = await evalJs("document.querySelector('.core-def')?.textContent");
const tabs = await evalJs("[...document.querySelectorAll('.tabs .tab')].map(t=>t.textContent).join('/')");
const hasAi = await evalJs("!!document.querySelector('.example')");
log.push(`详情：abandon → 音标 ${ph}，核心义「${def?.slice(0, 24)}」${hasAi ? "（有 AI 例句）" : "（词典兜底，无例句区块）"} ${def?.includes("放弃") ? "✓" : "✗"}；Tab ${tabs} ${tabs === "释义/关联词/记忆/词频" ? "✓" : "✗"}`);
// 释义块默认折叠：标题行有摘要，点开后出现义项，「全部展开」变「全部收起」
const folded = await evalJs("!!document.querySelector('.fold:not(.open) .fold-sum') && !document.querySelector('.sense')");
const famOpenDefault = await evalJs("[...document.querySelectorAll('#tabpanel-0 .fold.open h4')].some(h=>h.textContent.startsWith('词族')) && ![...document.querySelectorAll('#tabpanel-0 .fold.open h4')].some(h=>h.textContent.startsWith('释义'))");
await evalJs("document.querySelector('.fold-all')?.click()"); await sleep(300);
const opened = await evalJs("document.querySelectorAll('.sense').length + '/' + document.querySelector('.fold-all')?.textContent");
log.push(`详情：释义默认折叠 ${folded ? "✓" : "✗"}；点「全部展开」后义项 ${opened} ${opened?.endsWith("全部收起") && !opened.startsWith("0/") ? "✓" : "✗"}`);
const famFirst = await evalJs("[...document.querySelectorAll('#tabpanel-0 .fold.open h4')].some(h=>h.textContent.startsWith('词族'))");
const famRelated = await evalJs("[...document.querySelectorAll('#tabpanel-1 h4')].some(h=>h.textContent.startsWith('词族'))");
log.push(`详情：词族默认展开、释义默认折叠 ${famOpenDefault ? "✓" : "✗"}；词族在首屏 Tab 里且「全部展开」后仍打开 ${famFirst ? "✓" : "✗"}；关联词 Tab 里不再有词族 ${!famRelated ? "✓" : "✗"}`);
await evalJs("document.querySelector('.word-top .dd-btn')?.click()"); await sleep(300);
const topOpts = await evalJs("[...document.querySelectorAll('.word-top .dd-menu button')].map(o=>o.textContent).join('/')");
await shot("e2e-word-source-menu");
const topBook = await evalJs("document.querySelector('.word-top .book')?.textContent");
const MENU_LABEL = { auto: "自动", deepseek: "DeepSeek", openai: "OpenAI" };
const pickProvider = async (v) => { if (!(await evalJs("!!document.querySelector('.word-top .dd-menu')"))) { await evalJs("document.querySelector('.word-top .dd-btn')?.click()"); await sleep(300); } await evalJs(`[...document.querySelectorAll('.word-top .dd-menu button')].find(b=>b.textContent.startsWith(${JSON.stringify(MENU_LABEL[v])}))?.click()`); };
// 等设置保存、详情重载后再读按钮上的文字与禁用状态
const selState = () => evalJs("document.querySelector('.word-top .dd-btn')?.textContent + '/' + document.querySelector('.word-top .dd-btn')?.disabled");
await pickProvider("deepseek"); await sleep(2500);
const sel1 = await selState();
const srcNote = await evalJs("document.querySelector('.ai-source')?.textContent");
await pickProvider("auto"); await sleep(2000);
const sel2 = await selState();
log.push(`详情：顶部「${topBook}」居中 ${topBook?.startsWith("当前词库：") ? "✓" : "✗"}；来源下拉 ${topOpts} ${topOpts === "✓自动/DeepSeek/OpenAI" ? "✓" : "✗"}；切到 DeepSeek → ${sel1}，「${srcNote}」 ${sel1 === "DeepSeek/false" && srcNote?.includes("DeepSeek") ? "✓" : "✗"}；切回自动 → ${sel2} ${sel2 === "自动/false" ? "✓" : "✗"}`);
const colored = await evalJs("document.querySelectorAll('.w-mastered,.w-learning,.w-new,.w-none,.legend').length");
log.push(`详情：页面不再按状态给单词着色 ${colored === 0 ? "✓" : "✗（" + colored + "）"}`);
await shot("e2e-word-dict");
// 发音音频：单词与例句的 mp3 由 /api/audio/ 提供，例句按规范化文本的 SHA-1 寻址；未登记的哈希 404 并带 X-Audio-Fallback
const ttsVoices = await evalJs("fetch('/api/config/public').then(r=>r.json()).then(d=>JSON.stringify(d.ttsVoices||{}))");
const voice = JSON.parse(ttsVoices || "{}").us_female;
const wordAudio = await evalJs(`fetch('/api/audio/word/${voice}/abandon.mp3').then(r=>r.status+' '+r.headers.get('content-type')+' '+r.headers.get('cache-control'))`);
const firstEx = await evalJs("fetch('/api/words/abandon').then(r=>r.json()).then(d=>d.view.examples[0]?.en||'')");
// abandon 没填 AI 例句的环境（还没跑 ai:fill）跳过例句音频这一项（审计 F157）
const exHash = firstEx ? createHash("sha1").update(firstEx.trim().replace(/\s+/g, " "), "utf8").digest("hex") : "";
const sentAudio = exHash
  ? await evalJs(`fetch('/api/audio/sent/${voice}/${exHash}.mp3').then(r=>r.status+' '+r.headers.get('content-type'))`)
  : null;
const rangeAudio = await evalJs(`fetch('/api/audio/word/${voice}/abandon.mp3',{headers:{Range:'bytes=0-99'}}).then(r=>r.status+' '+r.headers.get('content-range'))`);
const badAudio = await evalJs(`fetch('/api/audio/sent/${voice}/${"0".repeat(40)}.mp3').then(r=>r.status+' '+r.headers.get('x-audio-fallback'))`);
log.push(`发音：单词 mp3 ${wordAudio} ${wordAudio?.startsWith("200 audio/mpeg") && wordAudio.includes("immutable") ? "✓" : "✗"}；例句 mp3 ${sentAudio ?? "跳过（abandon 没有 AI 例句）"} ${sentAudio === null ? "—" : sentAudio === "200 audio/mpeg" ? "✓" : "✗"}；Range ${rangeAudio} ${rangeAudio?.startsWith("206 bytes 0-99/") ? "✓" : "✗"}；未登记哈希 ${badAudio} ${badAudio === "404 webspeech" ? "✓" : "✗"}`);
// 反馈：打开弹窗 → 填写 → 提交 → toast
await evalJs("[...document.querySelectorAll('.detail-ops button')].find(b=>b.textContent.includes('反馈'))?.click()"); await sleep(400);
await evalJs("(()=>{const t=document.querySelector('.fb-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'e2e 测试反馈：释义顺序建议调整'); t.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(200);
await evalJs("[...document.querySelectorAll('.modal .btn-primary')].find(b=>b.textContent==='提交')?.click()"); await sleep(1500);
const fbToast = await evalJs("document.querySelector('.toast.show')?.textContent");
const fbState = await evalJs("JSON.stringify({modal:!!document.querySelector('.modal-backdrop.open'), fbInput:!!document.querySelector('.fb-input'), toasts:[...document.querySelectorAll('.toast')].map(t=>t.className+':'+t.textContent)})");
log.push(`详情：提交反馈 → toast「${fbToast}」 ${fbToast?.includes("感谢反馈") ? "✓" : "✗ " + fbState}`);
await send("Page.navigate", { url: BASE + "/word/give%20up" }); await sleep(3500);
const pdef = await evalJs("document.querySelector('.core-def')?.textContent");
log.push(`详情：短语 give up → 标题「${await evalJs("document.querySelector('.entry-title .spelling')?.textContent")}」，核心义「${pdef?.slice(0, 24)}」 ${pdef?.includes("放弃") ? "✓" : "✗"}`);
// 清理测试词库
if (fixture.id) await evalJs(`fetch('/api/wordbooks/${fixture.id}',{method:'DELETE'}).then(r=>r.status)`);
log.push(`控制台异常：${errors.length ? errors.slice(0, 3).join(" | ") : "无"}`);
console.log(log.join("\n"));
await cleanup();
process.exit(log.some((l) => l.includes("✗")) || errors.length ? 1 : 0);
