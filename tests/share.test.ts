import { describe, expect, it } from "vitest";
import { shareMessage, shareWay, siteRoot } from "@/lib/share";

describe("分享给朋友：按环境选做法（需求 4.1）", () => {
  const wechat = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.40";
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

  it("微信 / QQ 里教用右上角菜单，哪怕有 navigator.share", () => {
    expect(shareWay({ ua: wechat, canShare: true })).toBe("wechat");
    expect(shareWay({ ua: "QQ/8.9.0 Mobile", canShare: false })).toBe("wechat");
  });
  it("有系统分享面板就用它，没有就复制", () => {
    expect(shareWay({ ua: safari, canShare: true })).toBe("native");
    expect(shareWay({ ua: mac, canShare: false })).toBe("copy");
  });
  it("分享的是站点根地址，不带当前页面路径；非 http(s) 退到公开地址", () => {
    expect(siteRoot("https://jiaci.app/study/done?new=3", "x")).toBe("https://jiaci.app/");
    expect(siteRoot("http://localhost:3000/dict/abandon", "x")).toBe("http://localhost:3000/");
    expect(siteRoot("file:///x/index.html", "https://jiaci.app")).toBe("https://jiaci.app");
  });
  it("文案 + 换行 + 链接", () => {
    expect(shareMessage("一句话", "https://a/")).toBe("一句话\nhttps://a/");
  });
});
