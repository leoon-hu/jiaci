-- 学习日期：打分时采用的客户端本地日期（审计 F035）
-- 原来「今天」是按 study_log.studied_at（服务器 UTC 时刻）切的，而打分日期用的是客户端本地日期，
-- 两者不一致时：本地日期领先 UTC 的用户（如北京 0–8 点）刚打的分不算数、新词配额可无限重置；
-- 本地日期落后 UTC 的用户（如美西 17 点后）当晚的记录落进「明天」，次日一个新词都拿不到。

-- AlterTable
ALTER TABLE "study_log" ADD COLUMN     "study_date" DATE NOT NULL DEFAULT CURRENT_DATE;

-- CreateIndex
CREATE INDEX "study_log_user_id_study_date_idx" ON "study_log"("user_id", "study_date");

-- 存量行按 studied_at 的 UTC 日期回填（拿不到当时的客户端日期，这是最接近的近似）
UPDATE "study_log" SET "study_date" = ("studied_at" AT TIME ZONE 'UTC')::date;

-- 字段注释（本仓库约定：所有表 / 字段都有中文注释）
COMMENT ON COLUMN "study_log"."study_date" IS '学习日期：打分时采用的客户端本地日期；今日队列、今日已完成、学习记录时间线都按它算';
