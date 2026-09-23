import { describe, expect, it, vi } from "vitest";
import {
  APP_VERSION,
  UPDATE_CHECK_MS,
  UPDATE_NOTE_KEY,
  UPDATE_SLOW_MS,
  applyUpdate,
  checkVersion,
  noteUpdate,
  reinstall,
  takeUpdateNote,
  type CheckDeps,
  type ContainerLike,
  type NoteStore,
  type RegistrationLike,
  type WorkerLike,
} from "@/lib/version";

const NOW = 1_700_000_000_000;
function deps(res: { ok?: boolean; body?: unknown; throws?: boolean }, online = true) {
  const fetch = vi.fn<CheckDeps["fetch"]>(async () => {
    if (res.throws) throw new TypeError("network");
    return { ok: res.ok ?? true, json: async () => res.body };
  });
  return { fetch, online: () => online, now: () => NOW };
}

describe("当前版本（3.5 设置「关于 → 版本」）", () => {
  it("构建时内联；测试里没有构建，是空串", () => {
    expect(typeof APP_VERSION).toBe("string");
  });
});

describe("检查更新：checkVersion", () => {
  it("不走缓存问 /api/version（带时间戳）", async () => {
    const d = deps({ body: { version: "v1" } });
    await checkVersion("v1", d);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toBe(`/api/version?t=${NOW}`);
    expect(init.cache).toBe("no-store");
  });
  it("一样 → latest；不一样 → newer 并带上服务器的版本", async () => {
    expect(await checkVersion("v1", deps({ body: { version: "v1" } }))).toEqual({ kind: "latest" });
    expect(await checkVersion("v1", deps({ body: { version: " v2 " } }))).toEqual({ kind: "newer", version: "v2" });
  });
  it("没网 → offline，不发请求；请求失败时按有没有网分 offline / failed", async () => {
    const d = deps({ body: { version: "v1" } }, false);
    expect(await checkVersion("v1", d)).toEqual({ kind: "offline" });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(await checkVersion("v1", deps({ throws: true }))).toEqual({ kind: "failed" });
    let calls = 0;
    const flaky = { ...deps({ throws: true }), online: () => calls++ === 0 };
    // 第一次问（发请求前）说有网，请求失败后再问说没网
    expect(await checkVersion("v1", flaky)).toEqual({ kind: "offline" });
  });
  it("服务器回错误 / 格式不对 → failed", async () => {
    expect(await checkVersion("v1", deps({ ok: false }))).toEqual({ kind: "failed" });
    expect(await checkVersion("v1", deps({ body: null }))).toEqual({ kind: "failed" });
    expect(await checkVersion("v1", deps({ body: { version: 3 } }))).toEqual({ kind: "failed" });
    expect(await checkVersion("v1", deps({ body: { version: "" } }))).toEqual({ kind: "failed" });
  });
});

function fakeWorker(state = "installing"): WorkerLike & { set(s: string): void; posted: unknown[] } {
  const fns: Array<() => void> = [];
  const w = {
    state,
    posted: [] as unknown[],
    postMessage: (m: unknown) => void w.posted.push(m),
    addEventListener: (_t: "statechange", fn: () => void) => void fns.push(fn),
    set(s: string) {
      w.state = s;
      fns.forEach((fn) => fn());
    },
  };
  return w;
}
function fakeContainer(reg: RegistrationLike | undefined): ContainerLike & { change(): void } {
  const fns: Array<() => void> = [];
  return {
    getRegistration: async () => reg,
    addEventListener: (_t, fn) => void fns.push(fn),
    change: () => fns.forEach((fn) => fn()),
  };
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("更新：applyUpdate", () => {
  it("没有 SW / 没注册上：直接重新载入", async () => {
    const reload = vi.fn();
    void applyUpdate({ sw: null, reload, wait: () => new Promise(() => {}) });
    await tick();
    expect(reload).toHaveBeenCalledTimes(1);
    const reload2 = vi.fn();
    void applyUpdate({ sw: fakeContainer(undefined), reload: reload2, wait: () => new Promise(() => {}) });
    await tick();
    expect(reload2).toHaveBeenCalledTimes(1);
  });
  it("update 后没有在装的（新 SW 早已接管）：重新载入", async () => {
    const reg: RegistrationLike = { update: vi.fn(async () => undefined), installing: null, waiting: null, unregister: async () => true };
    const reload = vi.fn();
    void applyUpdate({ sw: fakeContainer(reg), reload, wait: () => new Promise(() => {}) });
    await tick();
    expect(reg.update).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("有新 SW 在装：装好发 SKIP_WAITING，接管后重新载入（只一次）", async () => {
    const w = fakeWorker();
    const reg: RegistrationLike = { update: async () => undefined, installing: null, waiting: null, unregister: async () => true };
    reg.update = async () => void (reg.installing = w);
    const sw = fakeContainer(reg);
    const reload = vi.fn();
    void applyUpdate({ sw, reload, wait: () => new Promise(() => {}) });
    await tick();
    expect(reload).not.toHaveBeenCalled();
    w.set("installed");
    expect(w.posted).toEqual([{ type: "SKIP_WAITING" }]);
    sw.change();
    w.set("activated");
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("已经有等着的：马上发 SKIP_WAITING", async () => {
    const w = fakeWorker("installed");
    const reg: RegistrationLike = { update: async () => undefined, installing: null, waiting: w, unregister: async () => true };
    void applyUpdate({ sw: fakeContainer(reg), reload: vi.fn(), wait: () => new Promise(() => {}) });
    await tick();
    expect(w.posted).toEqual([{ type: "SKIP_WAITING" }]);
  });
  it("一直没接管 → slow；新 SW 装失败 → failed", async () => {
    const waits: number[] = [];
    const w = fakeWorker();
    const reg: RegistrationLike = { update: async () => undefined, installing: w, waiting: null, unregister: async () => true };
    const slow = await applyUpdate({ sw: fakeContainer(reg), reload: vi.fn(), wait: async (ms) => void waits.push(ms) });
    expect(slow).toBe("slow");
    expect(waits).toEqual([UPDATE_CHECK_MS, UPDATE_SLOW_MS]);
    const w2 = fakeWorker();
    const reg2: RegistrationLike = { update: async () => undefined, installing: w2, waiting: null, unregister: async () => true };
    const p = applyUpdate({ sw: fakeContainer(reg2), reload: vi.fn(), wait: (ms) => (ms === UPDATE_CHECK_MS ? Promise.resolve() : new Promise(() => {})) });
    await tick();
    w2.set("redundant");
    expect(await p).toBe("failed");
  });
});

describe("清除缓存重新加载：reinstall", () => {
  it("注销全部 SW、删掉全部缓存、重新载入；没有 SW / 缓存、出错也照样重新载入", async () => {
    const unregister = vi.fn(async () => true);
    const reg: RegistrationLike = { update: async () => undefined, installing: null, waiting: null, unregister };
    const sw: ContainerLike = { getRegistration: async () => reg, getRegistrations: async () => [reg, reg], addEventListener: () => {} };
    const deleted: string[] = [];
    const reload = vi.fn();
    await reinstall({ sw, caches: { keys: async () => ["a", "audio"], delete: async (n) => (deleted.push(n), true) }, reload });
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual(["a", "audio"]);
    expect(reload).toHaveBeenCalledTimes(1);
    const reload2 = vi.fn();
    await reinstall({ sw: null, caches: null, reload: reload2 });
    expect(reload2).toHaveBeenCalledTimes(1);
    const reload3 = vi.fn();
    const broken: ContainerLike = { getRegistration: async () => Promise.reject(new Error("x")), addEventListener: () => {} };
    await reinstall({ sw: broken, caches: { keys: async () => Promise.reject(new Error("x")), delete: async () => true }, reload: reload3 });
    expect(reload3).toHaveBeenCalledTimes(1);
  });
});

describe("重新载入后的结果：noteUpdate / takeUpdateNote", () => {
  function store(): NoteStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }
  it("版本到了 → updated；没到 → incomplete；取一次就清掉", () => {
    const s = store();
    noteUpdate("update", "v2", s);
    expect(s.data.has(UPDATE_NOTE_KEY)).toBe(true);
    expect(takeUpdateNote("v2", s)).toBe("updated");
    expect(takeUpdateNote("v2", s)).toBeNull();
    noteUpdate("update", "v2", s);
    expect(takeUpdateNote("v1", s)).toBe("incomplete");
  });
  it("重新安装（不知道目标版本）→ reinstalled；坏数据 / 没有存储 → null", () => {
    const s = store();
    noteUpdate("reinstall", "", s);
    expect(takeUpdateNote("v1", s)).toBe("reinstalled");
    s.setItem(UPDATE_NOTE_KEY, "{oops");
    expect(takeUpdateNote("v1", s)).toBeNull();
    expect(takeUpdateNote("v1", null)).toBeNull();
    noteUpdate("update", "v2", null);
  });
});
