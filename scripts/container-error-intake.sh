#!/bin/sh
# PID 1 wrapper: forward signals, tee child stdout/stderr, append actionable errors to JSONL.
set -u

CONTAINER_NAME="${SHELL_CONTAINER_NAME:-unknown}"
INTAKE_DIR="${SHELL_CONTAINER_ERROR_INTAKE_DIR:-/dashboard-shell-analysis}"

strip_ansi() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'
}

compact_message() {
  printf '%s' "$1" | awk '
    function strip_ansi(s) {
      gsub(/\x1b\[[0-9;]*[A-Za-z]/, "", s)
      return s
    }
    BEGIN { ORS="" }
    {
      s = strip_ansi($0)
      gsub(/\r/, " ", s)
      gsub(/\n/, " ", s)
      gsub(/\t/, " ", s)
      gsub(/ +/, " ", s)
      sub(/^ /, "", s)
      sub(/ $/, "", s)
      if (length(s) > 280) s = substr(s, 1, 280)
      print s
    }
  '
}

is_informational_error_mention() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *appended*dashboard*log*error*row*) return 0 ;;
    *docker*log*error*row*) return 0 ;;
  esac
  if printf '%s' "$lower" | grep -Fq '] info:' || printf '%s' "$lower" | grep -Fq '] debug:'; then
    case "$lower" in
      *exception*|*traceback*|*connection\ refused*|*timed\ out*|*timeout*|*critical*|*fatal*) return 1 ;;
    esac
    [ -z "$(infer_status_code "$lower")" ] || return 1
    case "$lower" in
      *error*) return 0 ;;
    esac
    return 1
  fi
  case "$lower" in
    *info:*|*debug:*)
      case "$lower" in
        *exception*|*traceback*|*connection\ refused*|*timed\ out*|*timeout*|*critical*|*fatal*) return 1 ;;
      esac
      [ -z "$(infer_status_code "$lower")" ] || return 1
      case "$lower" in
        *error*) return 0 ;;
      esac
      ;;
  esac
  return 1
}

is_successful_http_access_log() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  # Ignore successful nginx access-log lines even when the URL/path contains "error".
  printf '%s' "$lower" | grep -Eq '^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+\[[^]]+\][[:space:]]+"[a-z]+ [^"]+ http/[0-9.]+"[[:space:]]+[23][0-9]{2}[[:space:]]+[0-9-]+' || return 1
  return 0
}

is_ignored_container_log_noise() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *user\ requested\ shutdown*|*ready\ to\ exit,\ bye\ bye*) return 0 ;;
  esac
  if printf '%s' "$lower" | grep -Eq '(^|[^[:alnum:]_])(added|audited)[[:space:]]+[0-9]+[[:space:]]+packages([^[:alnum:]_]|$)'; then
    return 0
  fi
  if printf '%s' "$lower" | grep -Eq '^[[:space:]]*[0-9]+[[:space:]]+vulnerabilities([^[:alnum:]_]|$)'; then
    return 0
  fi
  return 1
}

is_actionable_error_log() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *health/liveliness*|*health/readiness*|*\"get\ /health*) return 1 ;;
  esac
  if is_ignored_container_log_noise "$lower"; then
    return 1
  fi
  [ -z "$(infer_status_code "$lower")" ] || return 0
  case "$lower" in
    *connection\ refused*|*timed\ out*|*timeout*) return 0 ;;
  esac
  case "$lower" in
    *critical*|*fatal*|*exception*|*traceback*) return 0 ;;
  esac
  if is_informational_error_mention "$lower"; then
    return 1
  fi
  if is_successful_http_access_log "$lower"; then
    return 1
  fi
  case "$lower" in
    *critical*|*fatal*|*error*|*exception*|*traceback*|*failed*|*rate\ limit*|*overloaded*) return 0 ;;
  esac
  return 1
}

infer_log_level() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *critical*|*fatal*) printf 'critical'; return ;;
  esac
  case "$lower" in
    *error*|*exception*|*traceback*|*failed*|*connection\ refused*|*timed\ out*|*timeout*) printf 'error'; return ;;
  esac
  if [ -n "$(infer_status_code "$lower")" ]; then
    printf 'error'
    return
  fi
  case "$lower" in
    *warn*|*warning*) printf 'warning'; return ;;
  esac
  printf 'error'
}

infer_status_code() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  printf '%s' "$lower" | awk '''
    function add_code(code) {
      if (code !~ /^[45][0-9]{2}$/) return
      n = code + 0
      if (n < 400 || n > 599) return
      if (code in seen) return
      seen[code] = 1
      codes[++count] = code
    }
    function has_status_context(line, idx,   start, before, after) {
      start = (idx > 56) ? idx - 56 : 1
      before = substr(line, start, idx - start)
      after = substr(line, idx + 3, 56)
      if (before ~ /(status|statuscode|status_code|response|returned|code|upstream|gateway|error|failed|failure|fatal|critical)[^[:alnum:]_]*$/) return 1
      if (before ~ /(http|https)[^[:alnum:]_]*$/) return 1
      if (before ~ /http\/[0-9.]+[[:space:]]*$/) return 1
      if (after ~ /^[[:space:]]*(bad gateway|gateway timeout|service unavailable|internal server error|not found|too many requests)([^[:alnum:]_]|$)/) return 1
      return 0
    }
    function scan_context(line,   rest, m) {
      rest = line
      while (match(rest, /(status|http|https|response|returned|code)[[:space:]]*[:=]?[[:space:]]*(4[0-9]{2}|5[0-9]{2})/)) {
        add_code(substr(rest, RSTART + RLENGTH - 3, 3))
        rest = substr(rest, RSTART + RLENGTH)
      }
      rest = line
      while (match(rest, /http\/[0-9]+(\.[0-9]+)?[[:space:]]+(4[0-9]{2}|5[0-9]{2})/)) {
        add_code(substr(rest, RSTART + RLENGTH - 3, 3))
        rest = substr(rest, RSTART + RLENGTH)
      }
      rest = line
      while (match(rest, /"[a-z]+ [^"]+ http\/[0-9.]+"[[:space:]]+(4[0-9]{2}|5[0-9]{2})[[:space:]]+/)) {
        m = substr(rest, RSTART, RLENGTH)
        if (match(m, /[45][0-9]{2}[[:space:]]*$/)) add_code(substr(m, RSTART, 3))
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    function scan_bare(line,   i, c, code, start, before, after, win) {
      for (i = 1; i <= length(line) - 2; i++) {
        code = substr(line, i, 3)
        if (code !~ /^(4[0-9]{2}|5[0-9]{2})$/) continue
        before = (i > 1) ? substr(line, i - 1, 1) : ""
        if (before ~ /[0-9.]/) continue
        if (before == "-") continue
        c = (i + 3 <= length(line)) ? substr(line, i + 3, 1) : ""
        if (c ~ /[0-9.]/) continue
        after = substr(line, i + 3, 24)
        win = substr(line, (i > 16) ? i - 16 : 1, (i > 16) ? 16 : i - 1)
        if (after ~ /^packages/) continue
        if (win ~ /audited[[:space:]]*$/) continue
        if (win ~ /added[[:space:]]*$/) continue
        if (substr(line, (i > 12) ? i - 12 : 1, (i > 12) ? 13 : i - 1) ~ /:[0-9][0-9]:[0-9][0-9]\.$/) continue
        if (!has_status_context(line, i)) continue
        add_code(code)
      }
    }
    BEGIN { count = 0 }
    {
      scan_context($0)
      scan_bare($0)
      for (i = 1; i <= count; i++) {
        if (codes[i] ~ /^5/) { print codes[i]; exit }
      }
      if (count > 0) print codes[1]
    }
  '''
}

infer_provider() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *anthropic*|*claude*) printf 'anthropic'; return ;;
    *openrouter*) printf 'openrouter'; return ;;
    *openai*|*gpt-*) printf 'openai'; return ;;
    *google*|*gemini*) printf 'google'; return ;;
    *xai*|*grok*) printf 'xai'; return ;;
    *nvidia*|*nim*) printf 'nvidia_nim'; return ;;
    *local*) printf 'local'; return ;;
  esac
  printf 'unknown'
}

safe_basename() {
  name=$(printf '%s' "$CONTAINER_NAME" | sed 's|^/||; s/[^a-zA-Z0-9._-]/_/g; s/^_*//; s/_*$//')
  [ -n "$name" ] || name=unknown
  printf '%s' "$name"
}

json_escape() {
  # Escape backslash, double-quote, and common control chars for JSON string values.
  printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "\\") printf "\\\\"
        else if (c == "\"") printf "\\\""
        else if (c == "\n") printf "\\n"
        else if (c == "\r") printf "\\r"
        else if (c == "\t") printf "\\t"
        else printf "%s", c
      }
    }
  '
}

build_fingerprint() {
  container="$1"
  stream="$2"
  observed_at="$3"
  level="$4"
  status_code="$5"
  message="$6"
  payload="${container}|${stream}|${observed_at}|${level}|${status_code}|${message}"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$payload" | sha256sum | awk '{print substr($1,1,24)}'
    return
  fi
  if command -v openssl >/dev/null 2>&1; then
    printf '%s' "$payload" | openssl dgst -sha256 2>/dev/null | awk '{print substr($NF,1,24)}'
    return
  fi
  printf '%s' "$payload" | cksum | awk '{printf "%s-%s", $1, $2}'
}

append_error_record() {
  stream="$1"
  raw_line="$2"
  message=$(compact_message "$raw_line")
  [ -n "$message" ] || return 0
  if ! is_actionable_error_log "$message"; then
    return 0
  fi
  level=$(infer_log_level "$message")
  case "$level" in
    warning)
      if is_actionable_error_log "$message"; then
        level=error
      fi
      ;;
  esac
  status_code=$(infer_status_code "$message")
  provider=$(infer_provider "$message")
  observed_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
  ingested_at="$observed_at"
  fp=$(build_fingerprint "$CONTAINER_NAME" "$stream" "$observed_at" "$level" "$status_code" "$message")
  base=$(safe_basename)
  intake_file="${INTAKE_DIR}/${base}-error.jsonl"
  mkdir -p "$INTAKE_DIR" 2>/dev/null || return 0
  esc_msg=$(json_escape "$message")
  if [ -n "$status_code" ]; then
    sc_json="$status_code"
  else
    sc_json="null"
  fi
  record="{\"observed_at\":\"${observed_at}\",\"container\":\"${CONTAINER_NAME}\",\"stream\":\"${stream}\",\"level\":\"${level}\",\"status_code\":${sc_json},\"provider\":\"${provider}\",\"message\":\"${esc_msg}\",\"source_identity\":\"container-self-log\",\"source_path\":null,\"fingerprint\":\"${fp}\",\"ingested_at\":\"${ingested_at}\"}"
  printf '%s\n' "$record" >> "$intake_file" 2>/dev/null || true
}

child_pid=""
out_reader_pid=""
err_reader_pid=""
fifo_out=""
fifo_err=""

forward_signal() {
  sig="$1"
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -"$sig" "$child_pid" 2>/dev/null || true
  fi
}

on_term() {
  forward_signal TERM
}
on_int() {
  forward_signal INT
}

trap on_term TERM
trap on_int INT

if [ "$#" -eq 0 ]; then
  echo "container-error-intake.sh: missing command" >&2
  exit 1
fi

fifo_out=$(mktemp -u 2>/dev/null || echo "/tmp/cerr-out-$$")
fifo_err=$(mktemp -u 2>/dev/null || echo "/tmp/cerr-err-$$")
mkfifo "$fifo_out" "$fifo_err"

(
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line"
    append_error_record stdout "$line"
  done < "$fifo_out"
) &
out_reader_pid=$!

(
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line" >&2
    append_error_record stderr "$line"
  done < "$fifo_err"
) &
err_reader_pid=$!

"$@" >"$fifo_out" 2>"$fifo_err" &
child_pid=$!

wait "$child_pid"
status=$?
if [ -n "$out_reader_pid" ]; then
  wait "$out_reader_pid" 2>/dev/null || true
fi
if [ -n "$err_reader_pid" ]; then
  wait "$err_reader_pid" 2>/dev/null || true
fi
if [ -n "$fifo_out" ]; then
  rm -f "$fifo_out" "$fifo_err" 2>/dev/null || true
fi
exit "$status"
