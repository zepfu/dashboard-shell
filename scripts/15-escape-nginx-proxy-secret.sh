#!/bin/sh
# Escape SHELL_REPORT_PROXY_SHARED_SECRET for nginx double-quoted set directive.
# Runs from /docker-entrypoint.d before envsubst renders nginx.conf.template.
# Without this, a secret containing " or ; would break or inject nginx config (P13-F04).
set -eu

if [ -z "${SHELL_REPORT_PROXY_SHARED_SECRET+x}" ]; then
  exit 0
fi

# Escape backslash first, then double-quote. Semicolon is safe inside nginx double quotes.
escaped=$(printf '%s' "$SHELL_REPORT_PROXY_SHARED_SECRET" | sed 's/\\/\\\\/g; s/"/\\"/g')
export SHELL_REPORT_PROXY_SHARED_SECRET="$escaped"
