# Multi-stage build for efficient container size.
#
# Notes on `oracledb`:
# - We rely on `oracledb` Thin mode (default since 6.0), which is pure JS and
#   does NOT require Oracle Instant Client. That lets us stay on the standard
#   `node:22-alpine` base used by the rest of the WYRE MCP fleet.
# - If a future feature needs Thick mode (Advanced Queuing, Sharded DB, etc.)
#   switch the base image to `node:22-bookworm-slim` and `apt-get install` the
#   Instant Client before pulling that work in.
FROM node:26-alpine AS builder

ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG NODE_AUTH_TOKEN

WORKDIR /app

COPY package*.json .npmrc ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN rm -f .npmrc

FROM node:26-alpine AS production

RUN addgroup -g 1001 -S iqms && \
    adduser -S iqms -u 1001 -G iqms

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p /app/logs && chown -R iqms:iqms /app

USER iqms

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080
ENV MCP_HTTP_HOST=0.0.0.0
ENV AUTH_MODE=env

VOLUME ["/app/logs"]

CMD ["node", "dist/http.js"]

ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

LABEL io.modelcontextprotocol.server.name="io.github.wyre-technology/iqms-mcp"
LABEL maintainer="engineering@wyre.ai"
LABEL version="${VERSION}"
LABEL description="IQMS / DELMIAworks MCP Server"
LABEL org.opencontainers.image.title="iqms-mcp"
LABEL org.opencontainers.image.description="MCP server for IQMS / DELMIAworks (EnterpriseIQ) — manufacturing ERP integration"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/wyre-technology/iqms-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/wyre-technology/iqms-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/wyre-technology/iqms-mcp/pkgs/container/iqms-mcp"
LABEL org.opencontainers.image.vendor="Wyre Technology"
LABEL org.opencontainers.image.licenses="Apache-2.0"
