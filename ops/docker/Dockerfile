ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ARG POSTGRES_IMAGE=postgres:18-bookworm@sha256:ece55f7868da684e400f82f1030a050718adbdd65c23aa500c486f6e2950dc0f
ARG NGINX_IMAGE=nginx:stable-alpine@sha256:901e593c95dc85f5a729f5765516321366ef4ac401821431d408897e95287d0a

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY packages/content/package.json packages/content/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --no-audit --no-fund

FROM dependencies AS runtime-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM dependencies AS frontend
COPY server server/
COPY packages packages/
COPY web web/
RUN npm run build --workspace web

FROM ${NODE_IMAGE} AS app
WORKDIR /app
RUN install -d -o node -g node -m 0700 /var/lib/orgmap
COPY --chown=node:node --from=runtime-dependencies /app /app
COPY --chown=node:node LICENSE ./
COPY --chown=node:node server server/
COPY --chown=node:node packages packages/
COPY --chown=node:node scripts/iam-mail.ts scripts/
COPY --chown=node:node ops/vps/supervisor.mjs ops/vps/
COPY --chown=node:node ops/docker/runtime.ts ops/docker/
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node", "--import", "tsx", "ops/docker/runtime.ts"]

FROM ${POSTGRES_IMAGE} AS operator
WORKDIR /app
RUN install -d -o 1000 -g 1000 -m 0700 /var/lib/orgmap /backups
COPY --chown=1000:1000 --from=app /usr/local/bin/node /usr/local/bin/node
COPY --chown=1000:1000 --from=app /app /app
COPY --chown=1000:1000 ops/docker/operator.ts ops/docker/
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "ops/docker/operator.ts"]
CMD ["prepare"]

FROM ${NGINX_IMAGE} AS web
COPY ops/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx LICENSE /usr/share/nginx/html/LICENSE
COPY --chown=nginx:nginx --from=frontend /app/web/dist /usr/share/nginx/html
