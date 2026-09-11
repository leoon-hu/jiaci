-- AlterTable
ALTER TABLE "system_config" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "wordbook" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "study_log_word_id_idx" ON "study_log"("word_id");

-- CreateIndex
CREATE INDEX "user_current_wordbook_wordbook_id_idx" ON "user_current_wordbook"("wordbook_id");

-- CreateIndex
CREATE INDEX "user_word_note_word_id_idx" ON "user_word_note"("word_id");

-- CreateIndex
CREATE INDEX "user_word_progress_word_id_idx" ON "user_word_progress"("word_id");

-- 字段注释（本仓库约定：所有表 / 字段都有中文注释）
COMMENT ON COLUMN "wordbook"."sort_order" IS '内置词库的展示顺序（scripts/wordbooks.ts 的 BOOKS 下标）；导入 / 自建词库为 0，按创建时间排';

-- 回填内置词库的展示顺序（与迁移当时的 BOOKS 定义一致；以后由 wordbooks:build 维护）
UPDATE "wordbook" SET "sort_order" = 0 WHERE "type" = 'builtin' AND "name" = '高频核心';
UPDATE "wordbook" SET "sort_order" = 1 WHERE "type" = 'builtin' AND "name" = '高频进阶';
UPDATE "wordbook" SET "sort_order" = 2 WHERE "type" = 'builtin' AND "name" = '高频拓展';
UPDATE "wordbook" SET "sort_order" = 3 WHERE "type" = 'builtin' AND "name" = '中考词汇';
UPDATE "wordbook" SET "sort_order" = 4 WHERE "type" = 'builtin' AND "name" = '高考词汇';
UPDATE "wordbook" SET "sort_order" = 5 WHERE "type" = 'builtin' AND "name" = '四级词汇';
UPDATE "wordbook" SET "sort_order" = 6 WHERE "type" = 'builtin' AND "name" = '六级词汇';
UPDATE "wordbook" SET "sort_order" = 7 WHERE "type" = 'builtin' AND "name" = '考研词汇';
UPDATE "wordbook" SET "sort_order" = 8 WHERE "type" = 'builtin' AND "name" = '托福词汇';
UPDATE "wordbook" SET "sort_order" = 9 WHERE "type" = 'builtin' AND "name" = '雅思词汇';
UPDATE "wordbook" SET "sort_order" = 10 WHERE "type" = 'builtin' AND "name" = 'GRE 词汇';
UPDATE "wordbook" SET "sort_order" = 11 WHERE "type" = 'builtin' AND "name" = '学术词汇';
UPDATE "wordbook" SET "sort_order" = 12 WHERE "type" = 'builtin' AND "name" = '常用短语';
UPDATE "wordbook" SET "sort_order" = 13 WHERE "type" = 'builtin' AND "name" = '常用词组';
UPDATE "wordbook" SET "sort_order" = 14 WHERE "type" = 'builtin' AND "name" = '海外生活 · 租房与家居';
UPDATE "wordbook" SET "sort_order" = 15 WHERE "type" = 'builtin' AND "name" = '海外生活 · 看病与药房';
UPDATE "wordbook" SET "sort_order" = 16 WHERE "type" = 'builtin' AND "name" = '海外生活 · 银行税务办事';
UPDATE "wordbook" SET "sort_order" = 17 WHERE "type" = 'builtin' AND "name" = '海外生活 · 职场与邮件';
UPDATE "wordbook" SET "sort_order" = 18 WHERE "type" = 'builtin' AND "name" = '海外生活 · 孩子上学';
UPDATE "wordbook" SET "sort_order" = 19 WHERE "type" = 'builtin' AND "name" = '海外生活 · 数字生活';

-- system_config.updated_at：@updatedAt 只在经过 Prisma 时生效，运营用 SQL 改值时不会变。
-- 加一个触发器，让直接用 SQL 改配置也能看出最后修改时间（审计 F109）
CREATE OR REPLACE FUNCTION set_system_config_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_config_set_updated_at ON "system_config";
CREATE TRIGGER system_config_set_updated_at BEFORE UPDATE ON "system_config"
  FOR EACH ROW EXECUTE FUNCTION set_system_config_updated_at();
