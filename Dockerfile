# jiaci 生产镜像：standalone 产物 + 运维工具（prisma CLI / tsx，用于 migrate deploy、seed、provision）
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
# /dict 首页在构建期预渲染（revalidate=86400），需要可连通的 PostgreSQL（构建期专用，与运行库无关）
ARG SITE_HOST
ARG SITE_URL
ENV SITE_HOST=$SITE_HOST \
    SITE_URL=$SITE_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=DATABASE_URL,env=DATABASE_URL,required=true \
    npx prisma generate && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AUDIO_DIR=/data/audio \
    NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p /data/audio && chown -R node:node /data /app
COPY --from=build --chown=node:node /app/.next/standalone /app/
COPY --from=build --chown=node:node /app/.next/static /app/.next/static/
COPY --from=build --chown=node:node /app/public /app/public/
# 完整依赖（含 prisma CLI、tsx）覆盖 standalone 的精简 node_modules，供一次性运维命令使用；
# 补上 build 阶段已生成的 prisma client（deps 层从未 generate）
COPY --from=deps --chown=node:node /app/node_modules /app/node_modules/
COPY --from=build --chown=node:node /app/node_modules/.prisma /app/node_modules/.prisma/
COPY --from=build --chown=node:node /app/prisma /app/prisma/
COPY --from=build --chown=node:node /app/scripts /app/scripts/
COPY --from=build --chown=node:node /app/src/lib /app/src/lib/
USER node
EXPOSE 3000
CMD ["node", "server.js"]
