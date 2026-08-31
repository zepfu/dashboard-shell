FROM node:22-alpine AS build

ARG VITE_SHOW_ANTHROPIC_PROVIDER_STATUS=false
ENV VITE_SHOW_ANTHROPIC_PROVIDER_STATUS=${VITE_SHOW_ANTHROPIC_PROVIDER_STATUS}

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/*.conf /etc/nginx/
# Escape " \ in SHELL_REPORT_PROXY_SHARED_SECRET before envsubst fills the template (P13-F04).
# Numbered 15- so it runs before the stock 20-envsubst-on-templates.sh hook.
COPY scripts/15-escape-nginx-proxy-secret.sh /docker-entrypoint.d/15-escape-nginx-proxy-secret.sh
COPY scripts/container-error-intake.sh /usr/local/bin/container-error-intake.sh
RUN chmod +x /usr/local/bin/container-error-intake.sh \
  /docker-entrypoint.d/15-escape-nginx-proxy-secret.sh

# Runtime boundary note (D1-446):
# The shell image intentionally runs as root for now.
# It ships nginx-alpine as a stock, port-80 runtime with default paths and entrypoint behavior.
# Moving to non-root needs a planned follow-up for port binding, temp/cache/pid ownership, and entrypoint startup behavior.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

ENV SHELL_REPORT_PROXY_SHARED_SECRET=dashboard-shell-local-proxy-secret
ENV SHELL_CONTAINER_NAME=dashboard-shell
ENV SHELL_CONTAINER_ERROR_INTAKE_DIR=/dashboard-shell-analysis
ENTRYPOINT ["/usr/local/bin/container-error-intake.sh"]
CMD ["/docker-entrypoint.sh", "nginx", "-g", "daemon off;"]
