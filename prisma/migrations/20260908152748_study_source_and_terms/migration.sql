-- 打分来源与条款同意记录（审计 F024 / F171）
-- source：列表页的「已掌握 / 移出 / 重新记」也写 study_log，原来会一起算进首页的「今日已完成」；
--         存量行按 study 回填（此前的批量操作分不出来，占比很小，不值得猜）。
-- terms_*：记录用户同意的条款版本与时间，条款更新后才能判断谁需要重新确认。

-- CreateEnum
CREATE TYPE "StudySource" AS ENUM ('study', 'list');

-- AlterTable
ALTER TABLE "study_log" ADD COLUMN     "source" "StudySource" NOT NULL DEFAULT 'study';

-- AlterTable
ALTER TABLE "user_profile" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;

-- 字段注释（本仓库约定：所有表 / 字段都有中文注释）
COMMENT ON COLUMN "study_log"."source" IS '来源：study 学习卡片 / list 单词列表的批量操作；今日已完成只算 study';
COMMENT ON COLUMN "user_profile"."terms_version" IS '用户同意的条款版本（对应 system_config 的 legal.version）；为空表示这条记录早于同意机制';
COMMENT ON COLUMN "user_profile"."terms_accepted_at" IS '同意条款的时间';
