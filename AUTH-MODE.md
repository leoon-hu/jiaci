# AI加词 (Jiaci) 双模式认证与部署

## 效果

- `AUTH_MODE=email`：保留原版邮箱验证码登录及首次登录自动注册；`/api/auth/api-key-login` 返回 404。
- `AUTH_MODE=api_key` 显示密钥登录页，两个邮箱验证码端点返回 404。服务端按密钥找到已初始化的邮箱账号，再签发 `aiword_session` HttpOnly Cookie。
- 两种登录方式都按邮箱查找用户，词库、设置和学习记录关联同一个用户 ID。一个邮箱可以绑定多把密钥，每把密钥在配置中必须唯一。
- 未知 `AUTH_MODE` 会抛错，拒绝不明确的配置。

## 1. 准备项目

在包含本说明的 `jiaci/` 目录执行下面的命令。已有部署可以继续使用原数据库。

## 2. 初始化 `.env`

新部署可从 `.env.example` 创建 `.env`。已有部署在现有 `.env` 中添加认证配置。

```bash
openssl rand -hex 32   # 为每把登录密钥分别执行一次
openssl rand -hex 32   # 单独生成 SESSION_SECRET
```

在 `.env` 填写：

```dotenv
NODE_ENV=production
AUTH_MODE=api_key
AUTH_API_KEYS='[{"email":"alice@example.com","key":"REPLACE_WITH_ALICE_KEY"},{"email":"bob@example.com","key":"REPLACE_WITH_BOB_KEY"}]'
SESSION_SECRET=另一组独立随机密钥
RESEND_API_KEY=
DATABASE_URL="postgresql://aiword:数据库密码@127.0.0.1:5432/aiword?schema=public"
SITE_HOST=words.example.com
SITE_URL=https://words.example.com
```

将示例邮箱替换为各用户实际能收件的邮箱，并将每个 `key` 替换为独立生成的 64 字符十六进制密钥。`AUTH_API_KEYS` 只存放在服务端环境，生产环境通过 HTTPS 接收登录请求。

省略或留空 `AUTH_API_KEYS` 时，服务端兼容旧的 `AUTH_API_KEY` 与 `AUTH_PRIVATE_USER`。填写 `AUTH_API_KEYS` 后，以整份列表为准。

`AUTH_MODE=email` 时密钥绑定可留空。生产环境需配置 `RESEND_API_KEY` 和 `mail.from_address`，使用已验证的发件域名。

注意：修改 `.env` 后要重启 Next.js 服务，不建议直接修改线上容器环境而不重启。页面使用运行时动态渲染，所以切换模式不需要重新构建前端逻辑；若采用平台将 env 固化进构建产物，则以实际部署平台行为为准。

## 3. 初始化数据库与绑定账号

按 [本地开发](README.md#本地开发) 准备 PostgreSQL，更新 `.env` 中的 `DATABASE_URL`。

```bash
npm install
npx prisma generate
npm run db:migrate
npm run db:seed
npx tsx scripts/provision-private-user.ts
```

最后一步按邮箱批量初始化账号，可以重复执行。配置里的邮箱已存在时，密钥登录会使用该邮箱对应的原账号。新增绑定后运行同一个脚本即可初始化新账号。

旧账号若使用 `owner@private.invalid` 等占位地址，管理员需先确认实际邮箱由账号所有者控制、且尚未被其他账号使用，再更新原用户记录的 `user_profile.email` 和 `.env` 中的绑定。词库和学习记录继续关联该用户的原 ID。

按 [内容数据](README.md#内容数据) 获取 ECDICT `ecdict.csv` 至 `data/ecdict/`，运行：

```bash
npm run dict:load
npm run dict:sync
npm run wordbooks:build
npm run categories:build
```

AI 资料批量生成与发音预生成见 [内容数据](README.md#内容数据)。

## 4. 安全切换认证模式，撤销旧会话

Session 有长期有效期。切换登录模式、移除密钥或更改密钥绑定时，按以下步骤撤销旧会话。

1. 停掉正在运行的应用或阻止新登录。
2. 修改 `.env` 中的 `AUTH_MODE` 和相应配置。切入 `api_key` 时运行账号初始化脚本。切入 `email` 时配置邮件服务。
3. 运行以下命令撤销数据库中的所有 Session。

   ```bash
   CONFIRM_CLEAR_SESSIONS=YES npx tsx scripts/clear-auth-sessions.ts
   ```

4. 重启应用，所有设备以当前模式重新登录。切换到邮箱模式后，用户用绑定的同一邮箱收取验证码，继续使用原有数据。

撤销会话只删除 `session` 表数据，不删除用户、词库或学习记录。**不要期望轮换 `SESSION_SECRET` 能撤销这些随机 Session。**

## 5. 构建与启动

```bash
npm run typecheck
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

将 Next.js 放到 systemd/进程管理器中常驻。建议使用带 TLS 的反向代理，必须覆写 `X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto` 以避免来自客户端的伪造请求头影响登录限流和 Cookie Secure 标记。

示例 Nginx 配置（替换域名和证书，由你的环境安装证书）：

```nginx
server {
    listen 443 ssl http2;
    server_name words.example.com;
    ssl_certificate /etc/letsencrypt/live/words.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/words.example.com/privkey.pem;

    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

特别注意：`/dict` 等公开词典页面可匿名访问。如需限制访问，可使用 VPN、IP 白名单或反向代理的访问控制。

## 6. 上线验证

用浏览器访问 `https://words.example.com/login`：私有模式只应看到一个 API Key 输入框；正常登录之后继续进入 `/home`，学习记录保存到 PostgreSQL。

以下请求均**无需提交真实密钥**：

```bash
# 私有模式下，原邮箱接口应都返回 HTTP 404
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/auth/request-otp -H 'Content-Type: application/json' --data '{"email":"x@example.com"}'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/auth/verify -H 'Content-Type: application/json' --data '{"email":"x@example.com","code":"000000"}'
# 在 email 模式，私有登录接口应返回 404
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/auth/api-key-login -H 'Content-Type: application/json' --data '{"apiKey":"invalid"}'
```

错误密钥应返回 401。用两位测试用户的密钥分别登录，确认 `/api/me` 返回各自绑定的邮箱和用户 ID。切到 `email` 模式后，用同一邮箱登录，确认对应的用户 ID 和学习数据仍可访问。

## 7. 限制和运维

- 此方案的“API Key”是**网页登录凭证**，不是供外部程序直接访问业务 API 的 Bearer Token。成功登录后沿用 Session Cookie。
- 同一个邮箱下的所有密钥都能访问该账号的学习数据。为不同用户分别配置自己的邮箱和密钥。
- 登录密钥独立于 `DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`，只通过登录表单提交。
- 限流使用仓库现有**单进程内存**实现，不能作为公网的唯一防护。多进程/多实例需 Redis 等共享限流，或在反向代理增加限流。
- `.env` 建议 `chmod 600 .env`，保持在 `.gitignore` 中，定期备份 PostgreSQL 和音频文件目录。
- 发现密钥泄漏时，轮换该密钥并按第 4 节撤销旧会话。
