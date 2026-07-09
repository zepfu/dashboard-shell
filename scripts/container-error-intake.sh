#!/bin/sh
# PID 1 wrapper: forward signals, tee child stdout/stderr, append actionable errors to JSONL.
# P13-F20: open fifos read-write in the wrapper so a dead/slow reader cannot wedge
# the child. Classification runs in a SINGLE serialized ordered consumer per stream
# (not fire-and-forget subshells) so JSONL emit order and bounded-tail dedupe hold.
# Child is launched in its own process group; group-kill uses a dash-portable form.
set -u

CONTAINER_NAME="${SHELL_CONTAINER_NAME:-unknown}"
INTAKE_DIR="${SHELL_CONTAINER_ERROR_INTAKE_DIR:-/dashboard-shell-analysis}"
DEDUPE_TAIL_LINES="${SHELL_CONTAINER_ERROR_DEDUPE_TAIL_LINES:-2000}"

may_contain_actionable_error() {
  case "$1" in
    *[Ee][Rr][Rr][Oo][Rr]*|\
    *[Ff][Aa][Ii][Ll][Ee][Dd]*|\
    *[Ff][Aa][Tt][Aa][Ll]*|\
    *[Cc][Rr][Ii][Tt][Ii][Cc][Aa][Ll]*|\
    *[Ee][Xx][Cc][Ee][Pp][Tt][Ii][Oo][Nn]*|\
    *[Tt][Rr][Aa][Cc][Ee][Bb][Aa][Cc][Kk]*|\
    *[Tt][Ii][Mm][Ee][Dd]\ [Oo][Uu][Tt]*|\
    *[Tt][Ii][Mm][Ee][Oo][Uu][Tt]*|\
    *[Cc][Oo][Nn][Nn][Ee][Cc][Tt][Ii][Oo][Nn]\ [Rr][Ee][Ff][Uu][Ss][Ee][Dd]*|\
    *[Rr][Aa][Tt][Ee]\ [Ll][Ii][Mm][Ii][Tt]*|\
    *[Oo][Vv][Ee][Rr][Ll][Oo][Aa][Dd][Ee][Dd]*|\
    *[45][0-9][0-9]*)
      return 0
      ;;
  esac
  return 1
}

compact_message() {
  # Trim/control-normalize first, then cap to parity with JS ingest cap (280 chars).
  printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    {
      s = $0
      gsub(/\033\[[0-?]*[ -\/]*[@-~]/, "", s)
      gsub(/[[:cntrl:]]/, " ", s)
      gsub(/[[:space:]]+/, " ", s)
      gsub(/^ +| +$/, "", s)
      if (length(s) > 280) s = substr(s, 1, 280)
      print s
    }
  '
}

is_informational_error_mention() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *appended*docker*log*error*row*) return 0 ;;
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

is_successful_cache_wait_fallback_warning() {
  lower=$(printf '%s' "$1" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
  case "$lower" in
    *"warn: timed out waiting for redis cache refresh"*"falling back to sql"*) return 0 ;;
  esac
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
  if is_successful_cache_wait_fallback_warning "$lower"; then
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
  printf '%s' "$lower" | awk '
    function add_code(code) {
      if (code !~ /^[45][0-9]{2}$/) return
      numeric = code + 0
      if (numeric < 400 || numeric > 599) return
      if (code in seen) return
      seen[code] = 1
      codes[++count] = code
    }

    function has_status_context(line, idx,   start, before, after) {
      start = (idx > 56) ? idx - 56 : 1
      before = substr(line, start, idx - start)
      after = substr(line, idx + 3, 48)
      if (before ~ /(^|[^[:alnum:]_])(status|statuscode|status_code|response|returned|code|upstream|gateway|error|failed|failure|fatal|critical)[[:space:][:punct:]]{0,48}$/) return 1
      if (before ~ /(http|https)[^[:alnum:]_]*$/) return 1
      if (before ~ /http\/[0-9.]+[[:space:]]*$/) return 1
      if (after ~ /^[[:space:]]*(bad gateway|gateway timeout|service unavailable|internal server error|not found|too many requests)([^[:alnum:]_]|$)/) return 1
      return 0
    }

    function scan_context(line, rest, m) {
      rest = line
      while (match(rest, /(^|[^[:alnum:]_])(status|http|https|response|returned|code)[[:space:]:=]+(4[0-9]{2}|5[0-9]{2})([^0-9.]|$)/)) {
        m = substr(rest, RSTART, RLENGTH)
        if (match(m, /[45][0-9][0-9]/)) {
          add_code(substr(m, RSTART, 3))
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
      rest = line
      while (match(rest, /http\/[0-9]+(\.[0-9]+)?[[:space:]]+(4[0-9]{2}|5[0-9]{2})([^0-9.]|$)/)) {
        m = substr(rest, RSTART, RLENGTH)
        if (match(m, /[45][0-9][0-9]/)) {
          add_code(substr(m, RSTART, 3))
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
      rest = line
      while (match(rest, /"[a-z]+ [^"]+ http\/[0-9.]+"[[:space:]]+(4[0-9]{2}|5[0-9]{2})[[:space:]]+/)) {
        m = substr(rest, RSTART, RLENGTH)
        if (match(m, /[45][0-9]{2}[[:space:]]*$/)) {
          add_code(substr(m, RSTART, 3))
        }
        rest = substr(rest, RSTART + RLENGTH)
      }
    }

    function scan_bare(line,   i, c, code, after, before_window, before, after_window, match_window) {
      for (i = 1; i <= length(line) - 2; i++) {
        code = substr(line, i, 3)
        if (code !~ /^(4[0-9]{2}|5[0-9]{2})$/) continue
        before = (i > 1) ? substr(line, i - 1, 1) : ""
        if (before ~ /[0-9.]/) continue
        if (before == "-") continue
        c = (i + 3 <= length(line)) ? substr(line, i + 3, 1) : ""
        if (c ~ /[0-9.]/) continue

        after = substr(line, i + 3, 24)
        if (after ~ /^[[:space:]]*packages([^[:alnum:]_]|$)/) continue

        before_window = substr(line, (i > 16) ? i - 16 : 1, (i > 16) ? 16 : i - 1)
        if (before_window ~ /audited[[:space:]]*$/) continue
        if (before_window ~ /added[[:space:]]*$/) continue
        match_window = substr(line, (i > 12) ? i - 12 : 1, (i > 12) ? 13 : i - 1)
        if (match_window ~ /:[0-9][0-9]:[0-9][0-9]\.$/) continue

        if (!has_status_context(line, i)) continue
        add_code(code)
      }
    }

    BEGIN { count = 0 }
    {
      scan_context($0)
      scan_bare($0)
      for (i = 1; i <= count; i++) {
        if (codes[i] ~ /^5/) {
          print codes[i]
          exit
        }
      }
      if (count > 0) print codes[1]
    }
  '
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
  printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    {
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (c == "\\") {
          printf "\\\\"
        } else if (c == "\"") {
          printf "\\\""
        } else if (c == "\b") {
          printf "\\b"
        } else if (c == "\f") {
          printf "\\f"
        } else if (c == "\n") {
          printf "\\n"
        } else if (c == "\r") {
          printf "\\r"
        } else if (c == "\t") {
          printf "\\t"
        } else if (c ~ /[[:cntrl:]]/) {
          printf " "
        } else {
          printf "%s", c
        }
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
  # Wrapper fingerprints intentionally exclude wall-clock time so bounded tail
  # dedupe can suppress repeated local error loops across timestamp ticks.
  payload="${container}|${stream}|${level}|${status_code}|${message}"
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

fingerprint_already_recorded() {
  intake_file="$1"
  fp="$2"
  [ -f "$intake_file" ] || return 1

  case "$DEDUPE_TAIL_LINES" in
    ''|*[!0-9]*) limit=2000 ;;
    *) limit="$DEDUPE_TAIL_LINES" ;;
  esac

  needle="\"fingerprint\":\"${fp}\""
  if command -v tail >/dev/null 2>&1; then
    tail -n "$limit" "$intake_file" 2>/dev/null | grep -Fq "$needle" && return 0
    return 1
  fi
  grep -Fq "$needle" "$intake_file" 2>/dev/null
}

append_error_record() {
  stream="$1"
  raw_line="$2"
  if ! may_contain_actionable_error "$raw_line"; then
    return 0
  fi

  message=$(compact_message "$raw_line")
  [ -n "$message" ] || return 0

  if ! is_actionable_error_log "$message"; then
    return 0
  fi

  level=$(infer_log_level "$message")
  status_code=$(infer_status_code "$message")
  provider=$(infer_provider "$message")
  observed_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
  ingested_at="$observed_at"

  if ! mkdir -p "$INTAKE_DIR" 2>/dev/null; then
    return 0
  fi

  fp=$(build_fingerprint "$CONTAINER_NAME" "$stream" "$observed_at" "$level" "$status_code" "$message")
  base=$(safe_basename)
  intake_file="${INTAKE_DIR}/${base}-error.jsonl"

  if fingerprint_already_recorded "$intake_file" "$fp"; then
    return 0
  fi

  esc_observed_at=$(json_escape "$observed_at")
  esc_ingested_at=$(json_escape "$ingested_at")
  esc_container=$(json_escape "$CONTAINER_NAME")
  esc_stream=$(json_escape "$stream")
  esc_level=$(json_escape "$level")
  esc_provider=$(json_escape "$provider")
  esc_msg=$(json_escape "$message")

  if [ -n "$status_code" ]; then
    sc_json="$status_code"
  else
    sc_json="null"
  fi

  record="{\"observed_at\":\"${esc_observed_at}\",\"container\":\"${esc_container}\",\"stream\":\"${esc_stream}\",\"level\":\"${esc_level}\",\"status_code\":${sc_json},\"provider\":\"${esc_provider}\",\"message\":\"${esc_msg}\",\"source_identity\":\"container-self-log\",\"source_path\":null,\"fingerprint\":\"${fp}\",\"ingested_at\":\"${esc_ingested_at}\"}"
  printf '%s\n' "$record" >> "$intake_file" 2>/dev/null || true
}

child_pid=""
out_reader_pid=""
err_reader_pid=""
fifo_out=""
fifo_err=""
# Fixed FDs held open read-write against each fifo so a dead reader cannot leave
# the child blocked on open/write (the P13-F20 PID-1 wedge).
out_hold_fd=8
err_hold_fd=9

# Dash-portable process-group signal. dash rejects both
#   kill -TERM -- "-$pid"   (Illegal number: -)
#   kill -s TERM "-$pid"    (Illegal option -N)
# but accepts:
#   kill -TERM "-$pid"
#   kill -s TERM -- "-$pid"
# Prefer the short form; fall back to the direct child pid.
signal_process_group() {
  sig="$1"
  pid="$2"
  [ -n "$pid" ] || return 0
  kill -"$sig" "-$pid" 2>/dev/null && return 0
  kill -s "$sig" -- "-$pid" 2>/dev/null && return 0
  kill -"$sig" "$pid" 2>/dev/null || true
}

forward_signal() {
  sig="$1"
  if [ -n "$child_pid" ]; then
    signal_process_group "$sig" "$child_pid"
  fi
}

on_term() {
  forward_signal TERM
}

on_int() {
  forward_signal INT
}

on_quit() {
  forward_signal QUIT
}

on_hup() {
  forward_signal HUP
}

close_hold_fd() {
  fd="$1"
  if [ -n "$fd" ]; then
    eval "exec ${fd}>&-" 2>/dev/null || true
  fi
}

# Drop a hold FD (and nudge the child) when its hot-path reader dies while the
# child is still running. Without this, hold-open alone can leave the child
# writing into a held-open fifo forever — PID 1 then wedges on wait.
release_hold_if_reader_dead() {
  reader_pid="$1"
  hold_fd_var="$2"
  eval "hold_fd=\$$hold_fd_var"
  [ -n "$reader_pid" ] || return 0
  [ -n "$hold_fd" ] || return 0
  # Reader still alive → nothing to do.
  if kill -0 "$reader_pid" 2>/dev/null; then
    return 0
  fi
  # Reader is dead. If the child is still alive, release the hold so the child
  # observes a real zero-reader condition (SIGPIPE / EPIPE).
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    close_hold_fd "$hold_fd"
    eval "$hold_fd_var="
    signal_process_group TERM "$child_pid"
  fi
}

cleanup() {
  if [ -n "$out_reader_pid" ] && kill -0 "$out_reader_pid" 2>/dev/null; then
    kill "$out_reader_pid" 2>/dev/null || true
  fi
  if [ -n "$err_reader_pid" ] && kill -0 "$err_reader_pid" 2>/dev/null; then
    kill "$err_reader_pid" 2>/dev/null || true
  fi
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    signal_process_group TERM "$child_pid"
  fi
  close_hold_fd "$out_hold_fd"
  close_hold_fd "$err_hold_fd"
  if [ -n "$fifo_out" ]; then
    rm -f "$fifo_out" "$fifo_err" 2>/dev/null || true
  fi
}

trap on_term TERM
trap on_int INT
trap on_quit QUIT
trap on_hup HUP
trap cleanup EXIT

if [ "$#" -eq 0 ]; then
  echo "container-error-intake.sh: missing command" >&2
  exit 1
fi

tmpdir="${TMPDIR:-/tmp}"
if command -v mktemp >/dev/null 2>&1; then
  fifo_out="$(mktemp "${tmpdir%/}/cerr-out-XXXXXXXX")" || fifo_out="${tmpdir%/}/cerr-out-$$"
  fifo_err="$(mktemp "${tmpdir%/}/cerr-err-XXXXXXXX")" || fifo_err="${tmpdir%/}/cerr-err-$$"
else
  fifo_out="${tmpdir%/}/cerr-out-$$"
  fifo_err="${tmpdir%/}/cerr-err-$$"
fi

rm -f "$fifo_out" "$fifo_err"
if ! mkfifo "$fifo_out" "$fifo_err"; then
  echo "container-error-intake.sh: failed to create fifo" >&2
  cleanup
  exit 1
fi

# Open each fifo read-write in the wrapper BEFORE the child attaches. Holding an
# open reader means a dead hot-path reader cannot leave the child blocked on the
# next write (SIGPIPE only fires when zero readers remain).
#
# CRITICAL: every forked child must close these hold FDs. If a reader inherits
# the write side of its own fifo, it never observes EOF after the real child
# exits and PID 1 wedges on `wait $reader`.
eval "exec ${out_hold_fd}<>\"$fifo_out\""
eval "exec ${err_hold_fd}<>\"$fifo_err\""

# Serialized ordered consumer per stream: forward every complete line, then
# classify/append in the SAME loop (no fire-and-forget subshells). Order and
# dedupe are preserved because append_error_record runs sequentially. The child
# is insulated by the fifo + hold-open so a slow classifier only fills the pipe
# buffer rather than wedging forever on a dead reader.
#
# `|| [ -n "$line" ]` flushes a trailing partial line so a complete first line is
# never dropped on a boundary-aligned truncation/EOF.
(
  eval "exec ${out_hold_fd}>&- ${err_hold_fd}>&-" 2>/dev/null || true
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line"
    append_error_record stdout "$line"
  done < "$fifo_out"
) &
out_reader_pid=$!

(
  eval "exec ${out_hold_fd}>&- ${err_hold_fd}>&-" 2>/dev/null || true
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line" >&2
    append_error_record stderr "$line"
  done < "$fifo_err"
) &
err_reader_pid=$!

# Child must not inherit hold FDs (would keep writers alive after exit of the
# redirected fds, delaying reader EOF). Prefer a new session/process group so
# forward_signal can reach nested grandchildren (sleep under sh -c).
(
  eval "exec ${out_hold_fd}>&- ${err_hold_fd}>&-" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    exec setsid "$@"
  fi
  exec "$@"
) >"$fifo_out" 2>"$fifo_err" &
child_pid=$!

# Poll child + readers. If a reader dies while the child is still alive, drop the
# matching hold FD so the child gets SIGPIPE instead of writing into a held-open
# fifo forever. This is the P13-F20 "never wedge when the reader dies" guarantee
# and it lives in PID 1 (no sibling supervisors that the boundary test would
# accidentally kill alongside the real readers).
#
# CRITICAL: do NOT call `wait $child_pid` inside the poll loop — wait blocks
# until the child exits and would prevent us from ever noticing a dead reader.
# Poll with kill -0 + short sleep; reap with wait only after the child is gone.
while kill -0 "$child_pid" 2>/dev/null; do
  release_hold_if_reader_dead "$out_reader_pid" out_hold_fd
  release_hold_if_reader_dead "$err_reader_pid" err_hold_fd
  sleep 0.05 2>/dev/null || sleep 1
done

wait "$child_pid"
status=$?
if [ "$status" -ge 128 ] && [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
  wait "$child_pid"
  status=$?
fi

# Child is done. Drop any remaining held opens so readers observe EOF and drain
# remaining complete lines (including classification of the final line).
close_hold_fd "$out_hold_fd"
out_hold_fd=""
close_hold_fd "$err_hold_fd"
err_hold_fd=""

if [ -n "$out_reader_pid" ]; then
  wait "$out_reader_pid" 2>/dev/null || true
fi
if [ -n "$err_reader_pid" ]; then
  wait "$err_reader_pid" 2>/dev/null || true
fi
exit "$status"
