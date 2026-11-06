# Chime web: TanStack Start (SSR) served by Bun.
# Build from the web/ directory:  docker build -t chime-web web
#
# VITE_* values are compiled into the client bundle at build time (they're public: an API
# origin and an OAuth client ID), so they're build args, not runtime env.

FROM oven/bun:1.4.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
ARG VITE_API_URL=https://chime.ferg.al
ARG VITE_GOOGLE_CLIENT_ID=175545279310-mv915frs730ggui2gjc5lap94sdaqusf.apps.googleusercontent.com
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY . .
RUN bun run build

# The SSR bundle imports its dependencies at runtime, so the image needs production node_modules.
FROM oven/bun:1.4.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && rm -rf /root/.bun/install/cache
COPY --from=build /app/dist ./dist
COPY server.js ./

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["bun", "server.js"]
