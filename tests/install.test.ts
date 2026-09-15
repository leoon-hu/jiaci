import { describe, expect, it } from "vitest";
import { INSTALL_SNOOZE_MS, installKind, installSteps, type InstallEnv } from "@/lib/install";

const base: InstallEnv = { standalone: false, installed: false, hasPrompt: false, touch: true, inApp: false, ios: false };

describe("installKind（需求 4.1，四个站统一的规则）", () => {
  it("拿到安装事件最优先，电脑也算", () => {
    expect(installKind({ ...base, hasPrompt: true })).toBe("prompt");
    expect(installKind({ ...base, hasPrompt: true, touch: false })).toBe("prompt");
    expect(installKind({ ...base, hasPrompt: true, inApp: true, ios: true })).toBe("prompt");
  });
  it("电脑没有安装事件不引导；内嵌浏览器先于 iOS；其它触屏浏览器走菜单", () => {
    expect(installKind({ ...base, touch: false })).toBeNull();
    expect(installKind({ ...base, touch: false, ios: true })).toBeNull();
    expect(installKind({ ...base, inApp: true, ios: true })).toBe("inapp");
    expect(installKind({ ...base, ios: true })).toBe("ios");
    expect(installKind(base)).toBe("menu");
  });
  it("已以应用方式打开 / 装过不引导；静默 3 天", () => {
    expect(installKind({ ...base, standalone: true, hasPrompt: true })).toBeNull();
    expect(installKind({ ...base, installed: true, hasPrompt: true })).toBeNull();
    expect(INSTALL_SNOOZE_MS).toBe(3 * 24 * 3600 * 1000);
  });
});

describe("installSteps（「怎么做」弹窗）", () => {
  it("iOS：Safari 三步、非 Safari 先换 Safari 并带上域名；iPad 分享在右上角", () => {
    expect(installSteps("ios", { iosSafari: true, ipad: false })[0]).toEqual({ text: "点底部工具栏的分享按钮", share: true });
    const chrome = installSteps("ios", { iosSafari: false, ipad: true, host: "jiaci.app" });
    expect(chrome).toHaveLength(4);
    expect(chrome[0].text).toBe("先用 Safari 打开本站（jiaci.app）");
    expect(chrome[1]).toEqual({ text: "点右上角的分享按钮", share: true });
  });
  it("内嵌浏览器与其它浏览器各三步；prompt 没有步骤", () => {
    expect(installSteps("inapp", { iosSafari: false, ipad: false }).map((s) => s.text)[1]).toBe("选「在浏览器打开」");
    expect(installSteps("menu", { iosSafari: false, ipad: false })).toHaveLength(3);
    expect(installSteps("prompt", { iosSafari: false, ipad: false })).toEqual([]);
  });
});
