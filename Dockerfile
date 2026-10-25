FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter '@openminutes/web...' --filter '@openminutes/worker...' --filter '@openminutes/bot...'
RUN pnpm --filter '@openminutes/web...' --filter '@openminutes/worker...' --filter '@openminutes/bot...' build
RUN pnpm --filter @openminutes/web deploy --prod /out/web \
 && pnpm --filter @openminutes/worker deploy --prod /out/worker \
 && pnpm --filter @openminutes/bot deploy --prod /out/bot

FROM node:22-bookworm-slim AS runtime
ARG OPENMINUTES_VERSION
ENV NODE_ENV=production
ENV OPENMINUTES_VERSION=${OPENMINUTES_VERSION}
ENV OPENMINUTES_DATA_DIR=/data
RUN mkdir /data && chown node:node /data
VOLUME /data
WORKDIR /app

FROM runtime AS web
COPY --from=build /out/web ./
RUN chmod +x dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/openminutes
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/version').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]

FROM runtime AS worker
COPY --from=build /out/worker ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "dist/index.js"]

FROM runtime AS bot
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DISPLAY=:99
COPY --from=build /out/bot ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg pulseaudio pulseaudio-utils xvfb \
 && node node_modules/playwright-core/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright
COPY apps/bot/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER node
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
