-- 用户发起的 AI 资料生成（需求 3.4 I8）：两张新表，生成记录 + 封禁；只新增，不动任何已有的表与数据。

-- CreateEnum
CREATE TYPE "AiRequestStatus" AS ENUM ('pending', 'ok', 'failed', 'refused');

-- CreateTable
CREATE TABLE "word_ai_request" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip" VARCHAR(64) NOT NULL,
    "spelling" TEXT NOT NULL,
    "status" "AiRequestStatus" NOT NULL,
    "reason" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_ai_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_ai_ban" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "ip" VARCHAR(64),
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_ai_ban_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "word_ai_request_user_id_created_at_idx" ON "word_ai_request"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "word_ai_request_ip_created_at_idx" ON "word_ai_request"("ip", "created_at");

-- CreateIndex
CREATE INDEX "word_ai_request_spelling_created_at_idx" ON "word_ai_request"("spelling", "created_at");

-- CreateIndex
CREATE INDEX "word_ai_ban_user_id_until_idx" ON "word_ai_ban"("user_id", "until");

-- CreateIndex
CREATE INDEX "word_ai_ban_ip_until_idx" ON "word_ai_ban"("ip", "until");

-- AddForeignKey
ALTER TABLE "word_ai_request" ADD CONSTRAINT "word_ai_request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_ai_ban" ADD CONSTRAINT "word_ai_ban_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TYPE "AiRequestStatus" IS '用户发起的 AI 资料生成每条记录的状态：pending 生成中 / ok 已写入 / failed 模型或接口出错 / refused 没放行（超限、已有资料等）';
COMMENT ON TABLE "word_ai_request" IS '用户发起的 AI 资料生成记录（需求 3.4 I8）：每次调用生成接口一行——放行的记 pending，写完改 ok、出错改 failed；没放行的记 refused。每人每天 / 每分钟的次数、每个 IP 每天的次数与「恶意调用」的判定都按这张表数；用户注销后随账号一起删';
COMMENT ON COLUMN "word_ai_request"."id" IS '记录 ID';
COMMENT ON COLUMN "word_ai_request"."user_id" IS '发起人';
COMMENT ON COLUMN "word_ai_request"."ip" IS '发起时的客户端 IP（反向代理传来的 X-Real-IP；本机开发是 local）';
COMMENT ON COLUMN "word_ai_request"."spelling" IS '要生成的词（拼写）；没放行的请求词条行可能还没建，所以记拼写、不挂外键';
COMMENT ON COLUMN "word_ai_request"."status" IS '状态：pending 生成中 / ok 已写入 / failed 出错 / refused 没放行';
COMMENT ON COLUMN "word_ai_request"."reason" IS '没放行的原因（limit_daily / limit_minute / limit_ip / busy / exists / unknown）或出错的错误摘要';
COMMENT ON COLUMN "word_ai_request"."duration_ms" IS '从发起到写完 / 出错用了多少毫秒（只有放行的有）';
COMMENT ON COLUMN "word_ai_request"."created_at" IS '发起时间';
COMMENT ON TABLE "word_ai_ban" IS '生成接口的封禁（需求 3.4 I8）：24 小时内被拒太多次就把账号与 IP 各封一行，到期自动失效；运营也可以手工插一行';
COMMENT ON COLUMN "word_ai_ban"."id" IS '记录 ID';
COMMENT ON COLUMN "word_ai_ban"."user_id" IS '被封的账号；按 IP 封的那一行为空';
COMMENT ON COLUMN "word_ai_ban"."ip" IS '被封的 IP；按账号封的那一行为空';
COMMENT ON COLUMN "word_ai_ban"."until" IS '封到什么时候';
COMMENT ON COLUMN "word_ai_ban"."reason" IS '原因（自动封禁写被拒的次数；手工封写明缘由）';
COMMENT ON COLUMN "word_ai_ban"."created_at" IS '封禁时间';
