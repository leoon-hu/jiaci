"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import Modal from "@/components/Modal";
import InstallGuide from "@/components/InstallGuide";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/client/api";
import { resetMeCache, useMe } from "@/lib/client/useMe";
import { useInstall } from "@/lib/client/install";
import type { UserSettings } from "@/lib/settings";
import { SISTER_SITES } from "@/lib/sites";
import "./settings.css";

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, label]) => <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>{label}</button>)}</div>;
}
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>;
}

/** 设置（需求 3.5） */
export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { me, settings, update, loading, failed } = useMe();
  const [s, setS] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  // 安装为应用（需求 4.1）：首页横幅关掉了也能从这里装；已安装或浏览器不支持时不显示这一行
  const inst = useInstall();
  useEffect(() => { setS(settings); }, [settings]);

  async function save(patch: Partial<UserSettings>) {
    const before = s;
    setS({ ...s, ...patch });
    // 保存失败要退回原值，否则界面显示的是没存上的设置（审计 F060）
    try { await update(patch); setSaved(true); setTimeout(() => setSaved(false), 1200); }
    catch (e) { setS(before); toast(`没有保存成功：${(e as Error).message}`); }
  }
  async function logout() { await api("/api/auth/logout", { method: "POST" }); resetMeCache(); router.replace("/login"); }
  async function deleteAccount() {
    try { await api("/api/account/delete", { method: "POST", json: { email: confirmEmail } }); toast("账号已注销"); resetMeCache(); router.replace("/login"); }
    catch (e) { toast((e as Error).message); }
  }

  return (
    <AppShell nav="settings">
      <main className="page narrow">
        <div className="page-head"><div><h1 className="page-title">设置</h1><p className="page-sub">修改后自动保存 <span className={"saved" + (saved ? " show" : "")}>✓ 已保存</span></p></div></div>
        {loading ? <p className="muted">加载中…</p> : failed ? (
          // 拿不到 /api/me 时不能把默认值当成用户设置显示、还允许存回去（审计 F069）
          <p className="muted">设置加载失败，请检查网络后<button className="btn btn-ghost btn-sm" onClick={() => location.reload()}>重新加载</button></p>
        ) : (
          <>
            <div className="section-title">学习计划</div>
            <div className="list edge">
              <div className="row setting wrapm"><div className="main"><div className="title">每日新词量</div><div className="desc">5–200，建议 20–50</div></div>
                <div className="ctl"><input type="range" className="range" min={5} max={200} step={5} value={s.newWords} onChange={(e) => setS({ ...s, newWords: Number(e.target.value) })} onMouseUp={() => save({ newWords: s.newWords })} onTouchEnd={() => save({ newWords: s.newWords })} /><input className="input num" type="number" min={5} max={200} value={s.newWords} onChange={(e) => setS({ ...s, newWords: Number(e.target.value) })} onBlur={() => save({ newWords: Math.min(200, Math.max(5, s.newWords || 20)) })} /></div></div>
              <div className="row setting"><div className="main"><div className="title">每日复习上限</div><div className="desc">20–1000，超出的到期词顺延到次日</div></div>
                <div className="ctl"><input className="input num" type="number" min={20} max={1000} step={10} value={s.reviewLimit} onChange={(e) => setS({ ...s, reviewLimit: Number(e.target.value) })} onBlur={() => save({ reviewLimit: Math.min(1000, Math.max(20, s.reviewLimit || 200)) })} /></div></div>
              <div className="row setting wrapm"><div className="main"><div className="title">学习顺序</div><div className="desc">先复习到期词再学新词，或两者混合</div></div><div className="ctl"><Seg value={s.order} options={[["review-first", "先复习后新词"], ["mixed", "混合"]]} onChange={(v) => save({ order: v })} /></div></div>
              <div className="row setting wrapm"><div className="main"><div className="title">新词顺序</div></div><div className="ctl"><Seg value={s.newOrder} options={[["book", "词库顺序"], ["random", "随机"]]} onChange={(v) => save({ newOrder: v })} /></div></div>
            </div>
            <div className="section-title">发音</div>
            <div className="list edge">
              <div className="row setting"><div className="main"><div className="title">口音</div></div><div className="ctl"><Seg value={s.accent} options={[["us", "美音"], ["uk", "英音"]]} onChange={(v) => save({ accent: v })} /></div></div>
              <div className="row setting"><div className="main"><div className="title">声音</div><div className="desc">与口音组合，单词与例句朗读共用</div></div><div className="ctl"><Seg value={s.voice} options={[["female", "女声"], ["male", "男声"]]} onChange={(v) => save({ voice: v })} /></div></div>
              <div className="row setting wrapm"><div className="main"><div className="title">例句小喇叭位置</div><div className="desc">单词详情页每条例句的朗读按钮</div></div><div className="ctl"><Seg value={s.exSpeaker} options={[["right", "右侧"], ["left", "左侧"]]} onChange={(v) => save({ exSpeaker: v })} /></div></div>
              <div className="row setting"><div className="main"><div className="title">翻到卡片时自动发音</div><div className="desc">学习卡片正面出现时读单词</div></div><div className="ctl"><Switch checked={s.autoPlay} onChange={(v) => save({ autoPlay: v })} /></div></div>
              <div className="row setting"><div className="main"><div className="title">进入单词详情自动朗读</div><div className="desc">依次读单词和第一个例句；点击单词弹出小框时读该词</div></div><div className="ctl"><Switch checked={s.autoReadDetail} onChange={(v) => save({ autoReadDetail: v })} /></div></div>
            </div>
            <div className="section-title">交互</div>
            <div className="list edge">
              <div className="row setting wrapm"><div className="main"><div className="title">主题</div></div><div className="ctl"><Seg value={s.theme} options={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} onChange={(v) => save({ theme: v })} /></div></div>
              {inst.kind && (
                <div className="row setting"><div className="main"><div className="title">安装为应用</div><div className="desc">{inst.touch ? "加到主屏幕，像 App 一样全屏打开" : "安装到电脑桌面，独立窗口打开"}</div></div><div className="ctl">
                  {inst.kind === "prompt"
                    ? <button className="btn btn-secondary btn-sm" onClick={() => { void inst.install(); }}>安装</button>
                    : <button className="btn btn-secondary btn-sm" onClick={() => setGuideOpen(true)}>查看步骤</button>}
                </div></div>
              )}
              <div className="row setting wrapm"><div className="main"><div className="title">词条资料来源</div><div className="desc">释义、例句、辨析等由哪家模型填充；「自动」按 DeepSeek、OpenAI 顺序取有资料的，没有资料时显示词典释义</div></div><div className="ctl"><Seg value={s.aiProvider} options={[["auto", "自动"], ["deepseek", "DeepSeek"], ["openai", "OpenAI"]]} onChange={(v) => save({ aiProvider: v })} /></div></div>
            </div>
            <div className="section-title">账号</div>
            <div className="list edge">
              <div className="row setting"><div className="main"><div className="title">当前邮箱</div><div className="desc">{me?.email}</div></div></div>
              <div className="row setting"><div className="main"><div className="title">导出我的数据</div><div className="desc">词库、学习记录、备注（JSON）</div></div><div className="ctl"><a className="btn btn-secondary btn-sm" href="/api/account/export" download>导出</a></div></div>
              <div className="row setting"><div className="main"><div className="title">退出登录</div><div className="desc">清除本设备的登录凭证</div></div><div className="ctl"><button className="btn btn-secondary btn-sm" onClick={() => setLogoutOpen(true)}>退出</button></div></div>
              <div className="row setting danger-zone"><div className="main"><div className="title">注销账号</div><div className="desc">30 天内彻底删除全部数据</div></div><div className="ctl"><button className="btn btn-danger-soft btn-sm" onClick={() => setDelOpen(true)}>注销</button></div></div>
            </div>
            <div className="section-title">关于</div>
            <div className="list edge">
              <div className="row setting"><div className="main"><div className="title">版本</div></div><div className="ctl muted small">v0.1.0</div></div>
              <Link className="row setting link" href="/legal/privacy"><div className="main"><div className="title">隐私政策</div></div><span className="chev">›</span></Link>
              <Link className="row setting link" href="/legal/terms"><div className="main"><div className="title">服务条款</div></div><span className="chev">›</span></Link>
            </div>
            {/* 登录后看不到落地页，另外三个站的链接在这里再给一份（需求 4.1「四个站互相链接」） */}
            <div className="section-title">更多应用</div>
            <div className="list edge">
              {SISTER_SITES.map((site) => (
                <a key={site.url} className="row setting link" href={site.url} target="_blank" rel="noopener"><div className="main"><div className="title">{site.name}</div><div className="desc">{site.desc}</div></div><span className="chev">↗</span></a>
              ))}
            </div>
          </>
        )}
      </main>
      <InstallGuide open={guideOpen} onClose={() => setGuideOpen(false)} kind={inst.kind} iosSafari={inst.iosSafari} ipad={inst.ipad} />
      <Modal open={logoutOpen} onClose={() => setLogoutOpen(false)}>
        <h3>退出登录？</h3><p>学习记录已同步到账号，下次用邮箱验证码即可重新登录。</p>
        <div className="actions"><button className="btn btn-secondary" onClick={() => setLogoutOpen(false)}>取消</button><button className="btn btn-danger" onClick={logout}>退出登录</button></div>
      </Modal>
      <Modal open={delOpen} onClose={() => setDelOpen(false)}>
        <h3>注销账号</h3><p>注销后账号将立即不可用，你的词库、学习记录等全部数据会在 30 天内彻底删除，无法恢复。建议先导出数据。</p>
        <div className="field"><label>输入邮箱确认</label><input className="input" placeholder={me?.email} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} /></div>
        <div className="actions"><button className="btn btn-secondary" onClick={() => setDelOpen(false)}>取消</button><button className="btn btn-danger" onClick={deleteAccount}>确认注销</button></div>
      </Modal>
    </AppShell>
  );
}
