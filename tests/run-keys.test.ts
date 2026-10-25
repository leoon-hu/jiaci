import { describe, it, expect } from "vitest";
import { RUN_KEYS, runShortcut } from "../src/lib/run-keys";

describe("跑步模式快捷键", () => {
  it("七个操作各有一个按键，1 / 3 与详情页的认识 / 已掌握同义", () => {
    expect(Object.keys(RUN_KEYS)).toEqual(["prev", "toggle", "stop", "next", "progress", "master", "replay"]);
    expect(runShortcut({ key: " " })).toBe("toggle");
    expect(runShortcut({ key: "ArrowLeft" })).toBe("prev");
    expect(runShortcut({ key: "ArrowRight" })).toBe("next");
    expect(runShortcut({ key: "s" })).toBe("stop");
    expect(runShortcut({ key: "1" })).toBe("progress");
    expect(runShortcut({ key: "3" })).toBe("master");
    expect(runShortcut({ key: "r" })).toBe("replay");
  });
  it("字母不分大小写；别的键、修饰键组合、输入框里打字都不算", () => {
    expect(runShortcut({ key: "S" })).toBe("stop");
    expect(runShortcut({ key: "R" })).toBe("replay");
    expect(runShortcut({ key: "2" })).toBeNull();
    expect(runShortcut({ key: "Enter" })).toBeNull();
    expect(runShortcut({ key: "Escape" })).toBeNull();
    expect(runShortcut({ key: "r", metaKey: true })).toBeNull();
    expect(runShortcut({ key: "r", ctrlKey: true })).toBeNull();
    expect(runShortcut({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(runShortcut({ key: " ", editing: true })).toBeNull();
  });
});
