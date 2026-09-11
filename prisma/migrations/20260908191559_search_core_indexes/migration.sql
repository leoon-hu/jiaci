-- 列表搜索：核心义按包含匹配（ILIKE '%…%'）。原来写成 LEFT JOIN 两张 AI 表再 OR 一个 ILIKE，
-- 规划器会把整张 word_ai_deepseek（线上 8968 行 / 49 MB）拉进内存哈希，单次搜索 90–105 ms、读盘 14 MB。
-- (core, word_id) 覆盖索引让任何关键词都只扫几百 KB 的索引；trigram GIN 让 3 字符以上的关键词直接定位
-- （中文两字词提不出 trigram，用不上它，所以两个索引都要）。
-- pg_trgm 是 Postgres 自带 contrib，自 PG13 起是 trusted 扩展，库属主即可安装。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "word_ai_deepseek_core_word_id_idx" ON "word_ai_deepseek"("core", "word_id");

-- CreateIndex
CREATE INDEX "word_ai_deepseek_core_idx" ON "word_ai_deepseek" USING GIN ("core" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "word_ai_openai_core_word_id_idx" ON "word_ai_openai"("core", "word_id");

-- CreateIndex
CREATE INDEX "word_ai_openai_core_idx" ON "word_ai_openai" USING GIN ("core" gin_trgm_ops);
