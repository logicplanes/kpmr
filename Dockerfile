FROM node:24.22.1-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm licenses:check

FROM node:24.22.1-alpine
ARG KPMR_REVISION=dev
LABEL org.opencontainers.image.title="kpmr" \
      org.opencontainers.image.description="KPMR, the Kaeso Provider & Model Registry: models.dev, corrected and extended, served to Kaeso as a signed catalogue" \
      org.opencontainers.image.source="https://github.com/logicplanes/kpmr" \
      org.opencontainers.image.revision="${KPMR_REVISION}"
ENV NODE_ENV=production \
    PORT=8080 \
    KPMR_DATA=/data \
    KPMR_REGISTRY=/app \
    KPMR_WEB=/app/dist/web \
    KPMR_REVISION=${KPMR_REVISION}
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/registry ./registry
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && find dist -name "*.map" -path "*/web/*" -delete \
    && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => r.json()).then((h) => process.exit(h.ready ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server/main.js"]
