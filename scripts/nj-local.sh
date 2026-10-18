#!/usr/bin/env bash
#
# 晚记 Night Journal — 本地一键启动 / 重启脚本
#
#   ./scripts/nj-local.sh              # 默认 = restart：停旧进程 → 起 MySQL → 起服务 → 健康检查
#   ./scripts/nj-local.sh start        # 只启动（已在运行则跳过）
#   ./scripts/nj-local.sh stop         # 干净停掉服务和 MySQL
#   ./scripts/nj-local.sh restart      # 重启
#   ./scripts/nj-local.sh status       # 查看进程、端口、访问地址
#   ./scripts/nj-local.sh logs [app|mysql]
#   ./scripts/nj-local.sh build        # npm run build
#   ./scripts/nj-local.sh migrate      # npm run db:push
#   ./scripts/nj-local.sh run          # 前台运行（先确保 MySQL 起来），给 launchd/systemd 用
#
# 可用环境变量覆盖（不写死路径）：
#   NJ_PORT        服务端口，默认取 .env 的 PORT，否则 3000
#   NJ_MYSQL_HOME  MySQL 安装+数据目录，默认 <仓库>/../.nj-mysql
#   NJ_MYSQL_DATA  数据目录，默认 $NJ_MYSQL_HOME/data
#   NJ_MYSQLD      直接指定 mysqld 可执行文件
#   NJ_LOG_DIR     日志与 PID 目录，默认 <仓库>/.logs
#
# 注意：脚本里的变量只要后面紧跟中文字符（或任何非 ASCII），一律写成 ${VAR}。
# macOS 自带 bash 3.2 在 UTF-8 locale 下会把多字节字符吞进变量名，配合 set -u
# 就会报 "PORT�: unbound variable"。
#
set -euo pipefail

# ── 路径 ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 输出小工具 ──────────────────────────────────────────────────────
info() { printf '\033[36m[nj]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 读取 .env（只取需要的键，不 source，避免副作用） ────────────────
env_value() {
  local key="$1" file="$REPO_DIR/.env"
  [[ -f "$file" ]] || return 0
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" \
    | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

PORT="${NJ_PORT:-$(env_value PORT)}"
PORT="${PORT:-3000}"

DB_URL="$(env_value DATABASE_URL)"
DB_HOST=127.0.0.1; DB_PORT=3306; DB_NAME=nightjournal; DB_USER=""; DB_PASS=""
if [[ -n "$DB_URL" ]]; then
  _rest="${DB_URL#*://}"
  _creds=""; _hostpart="$_rest"
  if [[ "$_rest" == *"@"* ]]; then _creds="${_rest%%@*}"; _hostpart="${_rest#*@}"; fi
  if [[ "$_creds" == *":"* ]]; then DB_USER="${_creds%%:*}"; DB_PASS="${_creds#*:}"; else DB_USER="$_creds"; fi
  if [[ "$_hostpart" =~ ^([^:/]+)(:([0-9]+))?/(.+)$ ]]; then
    DB_HOST="${BASH_REMATCH[1]}"
    DB_PORT="${BASH_REMATCH[3]:-3306}"
    DB_NAME="${BASH_REMATCH[4]}"
  fi
fi

MYSQL_HOME="${NJ_MYSQL_HOME:-$REPO_DIR/../.nj-mysql}"
if [[ -d "$MYSQL_HOME" ]]; then MYSQL_HOME="$(cd "$MYSQL_HOME" && pwd -P)"; fi  # 规范化，去掉 ..
MYSQL_DATA="${NJ_MYSQL_DATA:-$MYSQL_HOME/data}"
SOCKET="$MYSQL_HOME/mysql.sock"
MYSQL_PID_FILE="$MYSQL_HOME/mysql.pid"
MYSQL_ERR="$MYSQL_HOME/mysql.err"

LOG_DIR="${NJ_LOG_DIR:-$REPO_DIR/.logs}"
APP_LOG="$LOG_DIR/app.log"
APP_PID_FILE="$LOG_DIR/app.pid"

APP_ENTRY="$REPO_DIR/dist/boot.js"

# ── 定位 mysqld ─────────────────────────────────────────────────────
find_mysqld() {
  local c
  if [[ -n "${NJ_MYSQLD:-}" && -x "${NJ_MYSQLD}" ]]; then echo "$NJ_MYSQLD"; return 0; fi
  while IFS= read -r c; do [[ -x "$c" ]] && { echo "$c"; return 0; }; done \
    < <(ls -1 "$MYSQL_HOME"/mysql-*/bin/mysqld "$MYSQL_HOME"/bin/mysqld 2>/dev/null || true)
  c="$(command -v mysqld 2>/dev/null || true)"
  [[ -n "$c" ]] && { echo "$c"; return 0; }
  return 1
}

MYSQLD="$(find_mysqld || true)"
MYSQLADMIN=""; MYSQL_CLIENT=""
if [[ -n "$MYSQLD" ]]; then
  MYSQLADMIN="$(dirname "$MYSQLD")/mysqladmin"
  MYSQL_CLIENT="$(dirname "$MYSQLD")/mysql"
fi

# ── 探测 ────────────────────────────────────────────────────────────
mysql_up() {
  [[ -x "$MYSQLADMIN" ]] || return 1
  local args=(ping)
  if [[ -S "$SOCKET" ]]; then
    args+=(--socket="$SOCKET")
  else
    args+=(-h "$DB_HOST" -P "$DB_PORT" --protocol=TCP)
  fi
  [[ -n "$DB_USER" ]] && args+=(-u"$DB_USER")
  [[ -n "$DB_PASS" ]] && args+=(-p"$DB_PASS")
  "$MYSQLADMIN" "${args[@]}" 2>/dev/null | grep -q alive
}

mysql_pid() {
  if [[ -f "$MYSQL_PID_FILE" ]]; then
    local p; p="$(cat "$MYSQL_PID_FILE" 2>/dev/null || true)"
    [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && { echo "$p"; return 0; }
  fi
  lsof -ti "tcp:$DB_PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

app_pid() {
  if [[ -f "$APP_PID_FILE" ]]; then
    local p; p="$(cat "$APP_PID_FILE" 2>/dev/null || true)"
    [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && { echo "$p"; return 0; }
  fi
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

http_code() {
  curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000
}

app_ready() {
  case "$(http_code)" in 2* | 3*) return 0 ;; *) return 1 ;; esac
}

lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

wait_for() { # wait_for <秒数> <描述> <命令...>
  local timeout="$1" label="$2"; shift 2
  local i
  for ((i = 1; i <= timeout; i++)); do
    if "$@" >/dev/null 2>&1; then ok "${label}（${i}s）"; return 0; fi
    sleep 1
  done
  return 1
}

# ── MySQL ───────────────────────────────────────────────────────────
start_mysql() {
  if mysql_up; then ok "MySQL 已在运行（端口 ${DB_PORT}）"; return 0; fi
  [[ -n "$MYSQLD" ]] || die "找不到 mysqld。用 NJ_MYSQL_HOME 或 NJ_MYSQLD 指定 MySQL 位置。"
  [[ -d "$MYSQL_DATA" ]] || die "找不到数据目录：$MYSQL_DATA"

  mkdir -p "$MYSQL_HOME"
  info "启动 MySQL：$MYSQLD"
  nohup "$MYSQLD" \
    --datadir="$MYSQL_DATA" \
    --socket="$SOCKET" \
    --pid-file="$MYSQL_PID_FILE" \
    --port="$DB_PORT" \
    --bind-address=127.0.0.1 \
    --mysqlx=OFF \
    --log-error="$MYSQL_ERR" \
    >/dev/null 2>&1 &

  wait_for 30 "MySQL 就绪" mysql_up || die "MySQL 30 秒内没起来，看日志：tail -50 $MYSQL_ERR"
}

stop_mysql() {
  local pid; pid="$(mysql_pid || true)"
  if [[ -z "$pid" ]]; then info "MySQL 未运行"; return 0; fi
  if [[ ! -f "$MYSQL_PID_FILE" ]]; then
    warn "没有 ${MYSQL_PID_FILE}，将按端口 $DB_PORT 停掉监听的进程"
  fi
  info "停止 MySQL（PID ${pid}，SIGTERM 即正常关闭）"
  kill -TERM "$pid" 2>/dev/null || true
  local i
  for ((i = 1; i <= 30; i++)); do
    kill -0 "$pid" 2>/dev/null || { ok "MySQL 已停止（${i}s）"; return 0; }
    sleep 1
  done
  warn "MySQL 30 秒没退出，强制结束"
  kill -9 "$pid" 2>/dev/null || true
}

# ── 应用 ────────────────────────────────────────────────────────────
start_app() {
  local pid; pid="$(app_pid || true)"
  if [[ -n "$pid" ]]; then ok "服务已在运行（PID ${pid}，端口 ${PORT}）"; return 0; fi
  command -v node >/dev/null 2>&1 || die "找不到 node，请先安装 Node 22，或把 node 加入 PATH（nvm 用户先 source ~/.nvm/nvm.sh）"
  [[ -f "$APP_ENTRY" ]] || die "缺少构建产物 ${APP_ENTRY}，先执行：./scripts/nj-local.sh build"
  [[ -f "$REPO_DIR/.env" ]] || die "缺少 $REPO_DIR/.env（可从 .env.example 复制，填好 APP_SECRET / DATABASE_URL）"

  mkdir -p "$LOG_DIR"
  info "启动服务：node dist/boot.js（端口 ${PORT}，日志 ${APP_LOG}）"
  cd "$REPO_DIR"
  NODE_ENV=production PORT="$PORT" nohup node "$APP_ENTRY" >>"$APP_LOG" 2>&1 &
  echo $! >"$APP_PID_FILE"

  wait_for 30 "服务就绪" app_ready || die "服务 30 秒内没起来，看日志：tail -50 $APP_LOG"

  local ip; ip="$(lan_ip)"
  ok "访问 http://localhost:$PORT${ip:+ ｜ 局域网 http://$ip:$PORT}"
}

stop_app() {
  local pid; pid="$(app_pid || true)"
  if [[ -z "$pid" ]]; then info "服务未运行"; rm -f "$APP_PID_FILE"; return 0; fi
  info "停止服务（PID ${pid}）"
  kill -TERM "$pid" 2>/dev/null || true
  local i
  for ((i = 1; i <= 15; i++)); do
    kill -0 "$pid" 2>/dev/null || { rm -f "$APP_PID_FILE"; ok "服务已停止（${i}s）"; return 0; }
    sleep 1
  done
  warn "服务 15 秒没退出，强制结束"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$APP_PID_FILE"
}

# ── 子命令 ──────────────────────────────────────────────────────────
cmd_start() { start_mysql; start_app; }

cmd_stop() { stop_app; stop_mysql; }

# 前台运行：给 launchd / systemd / supervisor 这类进程管理器用。
# 它们需要「主进程就是服务本身」才能做崩溃重启，所以这里不 nohup、不写 PID 文件。
cmd_run() {
  start_mysql
  command -v node >/dev/null 2>&1 || die "找不到 node，请先安装 Node 22，或把 node 加入 PATH"
  [[ -f "$APP_ENTRY" ]] || die "缺少构建产物 ${APP_ENTRY}，先执行：./scripts/nj-local.sh build"
  [[ -f "$REPO_DIR/.env" ]] || die "缺少 $REPO_DIR/.env"
  cd "$REPO_DIR"
  info "前台运行 node dist/boot.js（端口 ${PORT}，Ctrl-C 退出）"
  exec env NODE_ENV=production PORT="$PORT" node "$APP_ENTRY"
}

cmd_restart() {
  info "重启晚记（端口 ${PORT}）"
  stop_app || true
  stop_mysql || true
  start_mysql
  start_app
}

cmd_status() {
  local apid mpid code ip
  apid="$(app_pid || true)"; mpid="$(mysql_pid || true)"; code="$(http_code)"; ip="$(lan_ip)"
  echo "── 晚记 Night Journal ─────────────────────────────"
  printf '  仓库       : %s\n' "$REPO_DIR"
  printf '  端口       : %s\n' "$PORT"
  if [[ -n "$mpid" ]]; then
    printf '  MySQL      : 运行中  PID %s  端口 %s  socket %s\n' "$mpid" "$DB_PORT" "$SOCKET"
  else
    printf '  MySQL      : 未运行\n'
  fi
  if [[ -n "$apid" ]]; then
    printf '  服务       : 运行中  PID %s  HTTP %s\n' "$apid" "$code"
  else
    printf '  服务       : 未运行\n'
  fi
  printf '  访问       : http://localhost:%s%s\n' "$PORT" "${ip:+  ｜  局域网 http://$ip:$PORT}"
  printf '  应用日志   : %s\n' "$APP_LOG"
  printf '  MySQL 日志 : %s\n' "$MYSQL_ERR"
}

cmd_logs() {
  local which="${1:-app}"
  case "$which" in
    mysql) [[ -f "$MYSQL_ERR" ]] || die "没有 MySQL 日志：$MYSQL_ERR"; tail -n 60 -f "$MYSQL_ERR" ;;
    app | "") [[ -f "$APP_LOG" ]] || die "没有应用日志：$APP_LOG"; tail -n 60 -f "$APP_LOG" ;;
    *) die "用法：$0 logs [app|mysql]" ;;
  esac
}

cmd_build() {
  command -v npm >/dev/null 2>&1 || die "找不到 npm"
  ( cd "$REPO_DIR" && npm run build )
  ok "构建完成：$APP_ENTRY"
}

cmd_migrate() {
  command -v npm >/dev/null 2>&1 || die "找不到 npm"
  ( cd "$REPO_DIR" && npm run db:push )
  ok "表结构已同步"
}

cmd_help() { sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-restart}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  run)     cmd_run ;;
  status)  cmd_status ;;
  logs)    shift; cmd_logs "${1:-app}" ;;
  build)   cmd_build ;;
  migrate | push) cmd_migrate ;;
  -h | --help | help) cmd_help ;;
  *) die "未知命令：${1}（可用：start|stop|restart|run|status|logs|build|migrate）" ;;
esac
