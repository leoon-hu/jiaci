-- 会话表主键改存 Cookie 里随机值的 SHA-256：库里不再有可直接冒用的凭证。
-- 已有行原地换成哈希，浏览器里的 Cookie 不变、用户不会被登出（新代码用同一算法查找）。
UPDATE "session" SET "id" = encode(sha256(convert_to("id", 'UTF8')), 'hex');

COMMENT ON TABLE "session" IS '登录会话表：会话凭证存于 HttpOnly Cookie，90 天有效，活跃自动续期';
COMMENT ON COLUMN "session"."id" IS '会话 ID：Cookie 里那串随机值（32 字节）的 SHA-256 十六进制。库里只存哈希，库被拖走也拿不到可用的会话';
