FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY scripts/container-error-intake.sh /usr/local/bin/container-error-intake.sh
RUN chmod +x /usr/local/bin/container-error-intake.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

ENV SHELL_REPORT_PROXY_SHARED_SECRET=dashboard-shell-local-proxy-secret
ENV SHELL_CONTAINER_NAME=dashboard-shell
ENV SHELL_CONTAINER_ERROR_INTAKE_DIR=/dashboard-shell-analysis
ENTRYPOINT ["/usr/local/bin/container-error-intake.sh"]
CMD ["/docker-entrypoint.sh", "nginx", "-g", "daemon off;"]
