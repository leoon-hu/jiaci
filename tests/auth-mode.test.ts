import { afterEach, describe, expect, it, vi } from "vitest";
import { getPrivateUserEmailForKey, getPrivateUserEmails } from "@/lib/auth-mode";

const alice = { email: "alice@example.com", key: "a".repeat(64) };
const bob = { email: "bob@example.com", key: "B".repeat(64) };
const legacy = { email: "old@example.com", key: "c".repeat(64) };

describe("密钥登录的邮箱绑定", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("按密钥解析邮箱，同一邮箱可配置多把密钥，且优先使用新配置", () => {
    const secondAliceKey = "d".repeat(64);
    vi.stubEnv("AUTH_API_KEYS", JSON.stringify([
      { email: " Alice@Example.com ", key: alice.key },
      bob,
      { email: alice.email, key: secondAliceKey },
    ]));
    vi.stubEnv("AUTH_API_KEY", legacy.key);
    vi.stubEnv("AUTH_PRIVATE_USER", legacy.email);

    expect(getPrivateUserEmailForKey(alice.key)).toBe(alice.email);
    expect(getPrivateUserEmailForKey(bob.key)).toBe(bob.email);
    expect(getPrivateUserEmailForKey(secondAliceKey)).toBe(alice.email);
    expect(getPrivateUserEmailForKey(bob.key.toLowerCase())).toBeNull();
    expect(getPrivateUserEmailForKey(legacy.key)).toBeNull();
    expect(getPrivateUserEmails()).toEqual([alice.email, bob.email]);
  });

  it("新配置留空时兼容旧密钥和邮箱", () => {
    vi.stubEnv("AUTH_API_KEYS", "");
    vi.stubEnv("AUTH_API_KEY", ` ${legacy.key} `);
    vi.stubEnv("AUTH_PRIVATE_USER", " Old@Example.com ");

    expect(getPrivateUserEmailForKey(legacy.key)).toBe(legacy.email);
    expect(getPrivateUserEmails()).toEqual([legacy.email]);
  });

  it("拒绝将同一密钥配置给多个邮箱", () => {
    vi.stubEnv("AUTH_API_KEYS", JSON.stringify([alice, { email: bob.email, key: ` ${alice.key} ` }]));

    expect(() => getPrivateUserEmailForKey(alice.key)).toThrow("AUTH_API_KEYS must contain unique keys");
  });

  it.each([
    { name: "空列表", value: [] },
    { name: "无效密钥", value: [alice, { ...bob, key: "invalid" }] },
    { name: "无效邮箱", value: [alice, { ...bob, email: "invalid" }] },
  ])("拒绝含有$name的显式配置", ({ value }) => {
    vi.stubEnv("AUTH_API_KEY", legacy.key);
    vi.stubEnv("AUTH_PRIVATE_USER", legacy.email);
    vi.stubEnv("AUTH_API_KEYS", JSON.stringify(value));

    expect(() => getPrivateUserEmailForKey(alice.key)).toThrow(/^AUTH_API_KEYS must provide at least one binding/);
  });

  it("JSON 解析错误省略配置内容", () => {
    vi.stubEnv("AUTH_API_KEYS", `not-json-${alice.key}`);

    expect(() => getPrivateUserEmails()).toThrow(/^AUTH_API_KEYS must be a JSON array$/);
  });
});
