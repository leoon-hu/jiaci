-- 表、字段、枚举类型的中文注释（仅注释，不改结构）
COMMENT ON TYPE "WordbookType" IS '词库类型：builtin 内置 / import 用户导入 / custom 用户自建';
COMMENT ON TYPE "WordbookStatus" IS '词库状态：ready 可用 / generating 导入后 AI 资料生成中';
COMMENT ON TYPE "GenStatus" IS '词条资料生成状态：none 未生成 / generating 生成中 / ok 已生成 / failed 生成失败';
COMMENT ON TYPE "ProgressStatus" IS '用户对单词的学习状态：new 已加入未开始 / learning 学习中 / mastered 已掌握 / removed 已移出学习';
COMMENT ON TYPE "StudyResult" IS '学习记录结果：know 认识 / fuzzy 模糊 / master 标记已掌握 / reset 重新记 / remove 移出';

COMMENT ON TABLE "user_profile" IS '用户档案表：一个邮箱一个账号，设置以 JSON 保存';
COMMENT ON COLUMN "user_profile"."id" IS '用户 ID（cuid）';
COMMENT ON COLUMN "user_profile"."email" IS '登录邮箱（小写，唯一）';
COMMENT ON COLUMN "user_profile"."settings" IS '用户设置 JSON：每日新词量、复习上限、学习顺序、口音、朗读、主题、列表显示模式等';
COMMENT ON COLUMN "user_profile"."created_at" IS '注册时间';
COMMENT ON COLUMN "user_profile"."deleted_at" IS '注销时间；非空表示已注销，30 天后由清理脚本物理删除';

COMMENT ON TABLE "otp_code" IS '邮箱验证码表：每次发送一条，验证成功或作废后 used_at 置值';
COMMENT ON COLUMN "otp_code"."id" IS '记录 ID';
COMMENT ON COLUMN "otp_code"."email" IS '接收验证码的邮箱（小写）';
COMMENT ON COLUMN "otp_code"."code_hash" IS '验证码哈希（sha256，含服务端密钥），不存明文';
COMMENT ON COLUMN "otp_code"."expires_at" IS '过期时间（默认发送后 10 分钟）';
COMMENT ON COLUMN "otp_code"."attempts" IS '已尝试错误次数，达到上限后作废';
COMMENT ON COLUMN "otp_code"."used_at" IS '使用或作废时间；为空表示仍有效';
COMMENT ON COLUMN "otp_code"."created_at" IS '发送时间，用于 60 秒重发间隔与每日上限统计';

COMMENT ON TABLE "session" IS '登录会话表：会话 ID 存于 HttpOnly Cookie，90 天有效，活跃自动续期';
COMMENT ON COLUMN "session"."id" IS '会话 ID（随机 64 位十六进制）';
COMMENT ON COLUMN "session"."user_id" IS '所属用户';
COMMENT ON COLUMN "session"."expires_at" IS '过期时间';
COMMENT ON COLUMN "session"."created_at" IS '创建时间';
COMMENT ON COLUMN "session"."last_seen" IS '最近活跃时间，超过一天再次访问时续期';

COMMENT ON TABLE "wordbook" IS '词库表：内置词库由运营方直接 INSERT（owner_id 为空），导入 / 自建词库归属用户';
COMMENT ON COLUMN "wordbook"."id" IS '词库 ID';
COMMENT ON COLUMN "wordbook"."name" IS '词库名称';
COMMENT ON COLUMN "wordbook"."type" IS '词库类型：builtin 内置 / import 导入 / custom 自建';
COMMENT ON COLUMN "wordbook"."owner_id" IS '所属用户 ID；内置词库为空';
COMMENT ON COLUMN "wordbook"."word_count" IS '词数（冗余统计，增删单词时维护）';
COMMENT ON COLUMN "wordbook"."status" IS '状态：ready 可用 / generating 导入后资料生成中';
COMMENT ON COLUMN "wordbook"."created_at" IS '创建时间';

COMMENT ON TABLE "word" IS '全局单词表：同一拼写只有一条，AI 生成的资料缓存在 ai_data 供所有用户共用';
COMMENT ON COLUMN "word"."id" IS '单词 ID';
COMMENT ON COLUMN "word"."spelling" IS '拼写（小写，唯一）';
COMMENT ON COLUMN "word"."ai_data" IS 'AI 生成的词条资料 JSON：phonetic、meanings、examples、mnemonic、collocations、confusables、meta';
COMMENT ON COLUMN "word"."ai_version" IS '生成时使用的提示词版本（对应 system_config.ai.prompt_version）';
COMMENT ON COLUMN "word"."gen_status" IS '生成状态：none 未生成 / generating 生成中 / ok 已生成 / failed 失败';
COMMENT ON COLUMN "word"."gen_error" IS '最近一次生成失败的错误信息';
COMMENT ON COLUMN "word"."generating_at" IS '开始生成的时间；超过 60 秒视为锁失效，可被其它请求重新生成';
COMMENT ON COLUMN "word"."created_at" IS '首次入库时间';

COMMENT ON TABLE "wordbook_word" IS '词库与单词关联表：一个词库内单词按 sort_order 排序';
COMMENT ON COLUMN "wordbook_word"."wordbook_id" IS '词库 ID';
COMMENT ON COLUMN "wordbook_word"."word_id" IS '单词 ID';
COMMENT ON COLUMN "wordbook_word"."sort_order" IS '在词库中的顺序（从 0 开始）';

COMMENT ON TABLE "user_word_note" IS '用户单词备注表：每人每词一条，仅本人可见';
COMMENT ON COLUMN "user_word_note"."user_id" IS '用户 ID';
COMMENT ON COLUMN "user_word_note"."word_id" IS '单词 ID';
COMMENT ON COLUMN "user_word_note"."note" IS '备注内容，最多 200 字';
COMMENT ON COLUMN "user_word_note"."updated_at" IS '最近修改时间';

COMMENT ON TABLE "user_word_progress" IS '用户单词学习进度表（SM-2 简化版）：无记录 = 未学过';
COMMENT ON COLUMN "user_word_progress"."user_id" IS '用户 ID';
COMMENT ON COLUMN "user_word_progress"."word_id" IS '单词 ID';
COMMENT ON COLUMN "user_word_progress"."interval" IS '当前复习间隔（天），阶梯 1/3/7/15/30/60；0 表示新词';
COMMENT ON COLUMN "user_word_progress"."ease" IS '难度因子，初始 2.5，范围 1.3–3.0；认识 +0.1，模糊 −0.2';
COMMENT ON COLUMN "user_word_progress"."due_date" IS '下次复习日期；已掌握 / 已移出为空';
COMMENT ON COLUMN "user_word_progress"."reps" IS '学习次数（累计打分次数）';
COMMENT ON COLUMN "user_word_progress"."lapses" IS '模糊次数（累计打「模糊」的次数）';
COMMENT ON COLUMN "user_word_progress"."status" IS '状态：new 已加入未开始 / learning 学习中 / mastered 已掌握 / removed 已移出';
COMMENT ON COLUMN "user_word_progress"."updated_at" IS '最近更新时间';

COMMENT ON TABLE "study_log" IS '学习记录表：每次打分或状态操作一条，用于「今日已完成」统计与详情页学习记录时间线';
COMMENT ON COLUMN "study_log"."id" IS '记录 ID';
COMMENT ON COLUMN "study_log"."user_id" IS '用户 ID';
COMMENT ON COLUMN "study_log"."word_id" IS '单词 ID';
COMMENT ON COLUMN "study_log"."result" IS '结果：know 认识 / fuzzy 模糊 / master 已掌握 / reset 重新记 / remove 移出';
COMMENT ON COLUMN "study_log"."next_interval" IS '打分后的下次间隔（天）：0 = 今日再出现，-1 = 不再出现';
COMMENT ON COLUMN "study_log"."client_ts" IS '客户端提交标识，用于离线重试时去重（同一用户内唯一）';
COMMENT ON COLUMN "study_log"."studied_at" IS '打分时间';

COMMENT ON TABLE "user_current_wordbook" IS '用户当前学习词库表：每人同一时间只有一个当前词库';
COMMENT ON COLUMN "user_current_wordbook"."user_id" IS '用户 ID';
COMMENT ON COLUMN "user_current_wordbook"."wordbook_id" IS '当前学习的词库 ID';

COMMENT ON TABLE "system_config" IS '系统配置表：键值对，运营方直接用 SQL 维护，服务端读取带 60 秒缓存';
COMMENT ON COLUMN "system_config"."key" IS '配置键，如 site.name、ai.model、legal.privacy_policy';
COMMENT ON COLUMN "system_config"."value" IS '配置值（文本；数字、Markdown 正文均以文本存放）';
COMMENT ON COLUMN "system_config"."description" IS '配置说明';
COMMENT ON COLUMN "system_config"."updated_at" IS '最近修改时间';
