# 部署指南 — 晚记 Night Journal

本文覆盖两种部署形态，以及日常运维、排错和定时生成的时间语义。

| 方式 | 适用场景 | 入口 |
|---|---|---|
| **Docker Compose** | 长期运行的服务器 / VPS（推荐） | `docker compose up -d --build`，见 [README](./README.md#服务器部署推荐) |
| **本机直跑** | 自己的 Mac / PC，局域网内用手机访问 | [`scripts/nj-local.sh`](./scripts/nj-local.sh) `restart` |

---

## 1. 运行形态总览

生产模式只有 **两个进程**：

```
mysqld（MySQL 8）            node dist/boot.js（Hono + tRPC）
  127.0.0.1:3306                *:3000
        ▲                             │
        └──────── DATABASE_URL ───────┘
                                      ├── dist/public      前端静态产物（Vite 构建）
                                      └── data/uploads     图片碎片（本地磁盘）
```

| 组件 | 说明 |
|---|---|
| 前端 | Vite 构建到 `dist/public/`；`NODE_ENV=production` 时由 Hono 直接托管（[api/lib/vite.ts](./api/lib/vite.ts)） |
| 后端 | esbuild 把 `api/boot.ts` 打成单文件 `dist/boot.js`，`npm start` 启动 |
| 数据库 | MySQL 8；`DATE` 列按 `YYYY-MM-DD` 字符串绑定，`TIMESTAMP` 全程按 UTC 读写（见 §7） |
| 图片存储 | `UPLOAD_DIR` 或相对于**启动目录**的 `data/uploads/`；通过 `/api/uploads/<userId>/<file>` 鉴权读取 |
| 定时任务 | 进程内 `setInterval`，每 60 秒一次（[api/lib/scheduler.ts](./api/lib/scheduler.ts)），不是独立 worker |

> ⚠️ **必须用仓库根目录作为启动目录**（`cd Night-Journal && npm start`）。`.env` 和 `data/uploads/` 都是相对当前工作目录解析的，换目录启动会读不到配置、图片也会写到别处。

---

## 2. 本机生产模式部署

### 2.1 前置条件

| 依赖 | 版本 | 备注 |
|---|---|---|
| Node.js | 22.x（本项目在 v22.23.2 上验证） | 建议用 nvm 管理；`node -v` 要能直接跑 |
| MySQL | 8.0+（本项目在 8.0.40 上验证） | 服务器字符集建议 `utf8mb4` |
| 磁盘 | 约 300 MB | `dist/` ≈ 11 MB，MySQL 数据目录 ≈ 200 MB |

### 2.2 数据库

**已有实例**（当前这台机器）：

```
DATABASE_URL=mysql://nightjournal:nightjournal@127.0.0.1:3306/nightjournal
socket     : <仓库同级>/.nj-mysql/mysql.sock
字符集      : utf8mb4 / utf8mb4_unicode_ci
```

**从零初始化一个便携版 MySQL**（不改系统目录、不需要 sudo）：

```bash
# 1) 下载并解包 MySQL 8 的 macOS/Linux 压缩包，放到 <workspace>/.nj-mysql/mysql-<ver>-<platform>/

# 2) 初始化数据目录（首次，得到一个空密码的 root）
MYSQL_HOME=<workspace>/.nj-mysql
"$MYSQL_HOME"/mysql-*/bin/mysqld --initialize-insecure --datadir="$MYSQL_HOME/data"

# 3) 启动（先不设 root 密码，只监听本机）
"$MYSQL_HOME"/mysql-*/bin/mysqld --datadir="$MYSQL_HOME/data" \
  --socket="$MYSQL_HOME/mysql.sock" --pid-file="$MYSQL_HOME/mysql.pid" \
  --port=3306 --bind-address=127.0.0.1 --mysqlx=OFF &

# 4) 建库 + 建应用账号（字符集用 utf8mb4，否则中文会乱码）
"$MYSQL_HOME"/mysql-*/bin/mysql --socket="$MYSQL_HOME/mysql.sock" -u root -e "
  CREATE DATABASE nightjournal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'nightjournal'@'127.0.0.1' IDENTIFIED BY 'nightjournal';
  CREATE USER 'nightjournal'@'localhost' IDENTIFIED BY 'nightjournal';
  GRANT ALL ON nightjournal.* TO 'nightjournal'@'127.0.0.1', 'nightjournal'@'localhost';
  FLUSH PRIVILEGES;"
```

**同步表结构**（每次 `git pull` 后如果 `db/schema.ts` 有变化就跑）：

```bash
cd Night-Journal
npm run db:push          # drizzle-kit push：schema diff，幂等，可重复执行
```

> ❌ 不要用 `npm run db:migrate`。历史迁移 SQL 缺少 `IF NOT EXISTS`，对已存在的表会直接报错；`entrypoint.sh` 里用的也是 `push`。

### 2.3 环境变量

复制模板并填写：

```bash
cd Night-Journal
cp .env.example .env
openssl rand -hex 32     # 生成 APP_SECRET 填进去
```

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_SECRET` | ✅ | JWT 签名密钥，同时用于派生 API key 的 AES-256-GCM 加密密钥。**换掉它会导致已存的第三方 API key 解不开**，备份时一起备份 |
| `DATABASE_URL` | ✅ | `mysql://user:pass@host:port/db` |
| `PORT` | 可选 | 默认 `3000` |
| `OWNER_UNION_ID` | 可选 | 管理员，本地账号格式 `local:<username>` |
| `ENABLE_AUTO_GENERATION_IN_DEV` | 可选 | 仅开发模式需要；生产环境调度器默认开启 |
| `ALLOW_PRIVATE_MODEL_HOSTS` | 可选 | 允许模型地址指向内网/回环，逗号分隔 `host:port`。默认被 SSRF 防护拦掉，自建本地模型网关时才需要配 |
| `UPLOAD_DIR` | 可选 | 图片落盘目录，默认 `data/uploads` |

### 2.4 构建与启动

```bash
cd Night-Journal
npm ci                    # 或 npm install
npm run db:push           # 首次 / schema 变更后
npm run build             # Vite 前端 → dist/public；esbuild 后端 → dist/boot.js
npm start                 # = NODE_ENV=production node dist/boot.js
```

打开 http://localhost:3000 即可。局域网内用手机访问：`http://<本机内网IP>:3000`。

### 2.5 健康检查

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 期望 200
curl -s http://127.0.0.1:3000/api/trpc/aiSettings.get | head -c 80       # 期望 401 Authentication required
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://127.0.0.1:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"__probe__","password":"whatever-12345"}'              # 期望 401；若是 500 说明连不上数据库
```

---

## 3. 一键脚本

[`scripts/nj-local.sh`](./scripts/nj-local.sh) 把「起 MySQL + 起服务 + 健康检查」封成一个命令，默认动作是 `restart`。

```bash
cd Night-Journal
./scripts/nj-local.sh              # = restart：停掉旧进程 → 起 MySQL → 起服务 → 等健康检查通过
./scripts/nj-local.sh status       # 看两个进程的 PID / 端口 / 可访问地址
./scripts/nj-local.sh logs         # 跟踪应用日志（Ctrl-C 退出）
./scripts/nj-local.sh logs mysql   # 跟踪 MySQL 错误日志
./scripts/nj-local.sh stop         # 停服务 + 停 MySQL（干净关闭，不会损坏数据）
./scripts/nj-local.sh build        # npm run build（改完代码后，配合 restart）
./scripts/nj-local.sh migrate      # npm run db:push（schema 变更后）
./scripts/nj-local.sh run          # 前台运行（先确保 MySQL 起来），给 launchd/systemd 用
```

常用组合：

```bash
git pull && npm ci && ./scripts/nj-local.sh migrate && ./scripts/nj-local.sh build && ./scripts/nj-local.sh restart
```

可覆盖的配置（都用环境变量，不写死在脚本里）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NJ_PORT` | `.env` 的 `PORT`，否则 3000 | 服务端口 |
| `NJ_MYSQL_HOME` | `<仓库>/../.nj-mysql` | MySQL 安装 + 数据目录 |
| `NJ_MYSQL_DATA` | `$NJ_MYSQL_HOME/data` | 数据目录 |
| `NJ_MYSQLD` | 自动探测 | 直接指定 `mysqld` 可执行文件 |
| `NJ_LOG_DIR` | `<仓库>/.logs` | 应用日志和 PID 文件 |

日志位置：

```
<仓库>/.logs/app.log           应用 stdout/stderr（含 [scheduler]、[diary]、[auth] 打点）
<仓库>/.logs/app.pid           应用 PID
$NJ_MYSQL_HOME/mysql.err       MySQL 错误日志
```

> 脚本自己拉起的是后台进程（`nohup`），**请在你自己的终端里执行**，不要在会被回收的临时会话里跑。需要开机自启/崩溃自动拉起时，参考 §5 的 launchd 模板。

---

## 4. 常见操作

**备份数据库**

```bash
"$MYSQL_HOME"/mysql-*/bin/mysqldump --socket="$MYSQL_HOME/mysql.sock" \
  -u nightjournal -pnightjournal --default-character-set=utf8mb4 \
  nightjournal > nightjournal-$(date +%F).sql
```

**恢复**

```bash
"$MYSQL_HOME"/mysql-*/bin/mysql --socket="$MYSQL_HOME/mysql.sock" \
  -u nightjournal -pnightjournal --default-character-set=utf8mb4 \
  nightjournal < nightjournal-2026-10-18.sql
```

**手工查库**（务必带字符集参数，否则中文会显示成 `????` 或被双重编码写坏）

```bash
"$MYSQL_HOME"/mysql-*/bin/mysql --socket="$MYSQL_HOME/mysql.sock" \
  -u nightjournal -pnightjournal --default-character-set=utf8mb4 nightjournal
```

**只重启应用、不碰数据库**：`./scripts/nj-local.sh stop` 会连 MySQL 一起停；只想重启服务时用 `kill $(cat .logs/app.pid)` 然后 `./scripts/nj-local.sh start`。

---

## 5. 可选：开机自启（launchd）

launchd 需要「主进程就是服务本身」才能做崩溃自动重启，所以这里用脚本的 `run` 子命令（前台运行、自带 MySQL 检查），而不是 `start`（后台化）。

先建好日志目录，再写 `~/Library/LaunchAgents/com.local.night-journal.plist`：

```bash
mkdir -p /Users/bing/Documents/workspeace/Night-Journal/.logs
dirname "$(command -v node)"     # 把输出替换到下面 PATH 的第一段
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.local.night-journal</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>exec /Users/bing/Documents/workspeace/Night-Journal/scripts/nj-local.sh run</string>
  </array>
  <!-- launchd 的环境极简，必须显式给出 node 所在目录 -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/bing/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>/Users/bing/Documents/workspeace/Night-Journal/.logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/Users/bing/Documents/workspeace/Night-Journal/.logs/launchd.err.log</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load   ~/Library/LaunchAgents/com.local.night-journal.plist   # 启用
launchctl unload ~/Library/LaunchAgents/com.local.night-journal.plist   # 停用
```

> - `KeepAlive` 让应用崩溃后自动拉起；`run` 每次都会先确保 MySQL 在跑（已在跑则跳过）。
> - **托管之后不要再用 `./scripts/nj-local.sh start`**：两边会抢 `3000` 端口，launchd 会陷入重启循环。改代码后要重启，用 `launchctl kickstart -k gui/$(id -u)/com.local.night-journal`。
> - 日志分两处：脚本自己的 `.logs/app.log`（`start` 模式）和 launchd 抓的 `launchd.out.log` / `launchd.err.log`（`run` 模式，正常启动日志也在这里）。

---

## 6. 自动生成的时间语义（容易踩）

调度器每 60 秒 tick 一次，逐个用户判断（[api/lib/scheduler.ts](./api/lib/scheduler.ts)）：

1. 用户配置里必须有 `diaryGenerationTime` + `diaryApiKey` + `diaryApiBaseUrl`；
2. 用户时区（默认 `Asia/Shanghai`）当前时间 **≥** `diaryGenerationTime`（默认 `02:00`）；
3. 目标日期是 **昨天**，不是今天；
4. 昨天必须有未删除的碎片；
5. 昨天那篇已经 `generated` 或 `manuallyEdited` → 跳过；`pending` 未满 10 分钟 → 跳过；`failed` 或 pending 超 10 分钟 → 重试。

所以：

- **今天记的碎片今天不会被自动生成**，要在第二天 `02:00` 之后才补上；
- 服务在 `02:00` 那一刻没运行也没关系，只要之后启动，下一个 tick 就会补（但只补「昨天」那一天，停机更久的历史日期不会补）；
- 想马上看自动效果：给**昨天**记一条碎片，然后把设置里的「每日生成时间」改成一个已经过去的时间，等一分钟。

手动生成不走调度器，随时可用：日记列表顶部的「生成日记」卡片、日历里点那天的面板、或详情页底部的「重新生成」。

---

## 7. 排错清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动就报 `Missing required environment variable: APP_SECRET` | 没有 `.env`，或启动目录不对 | 在仓库根目录建 `.env`，并用仓库根目录作为 cwd 启动 |
| `connect ECONNREFUSED 127.0.0.1:3306` / 日志里 `[scheduler] tick failed` | MySQL 没起 | `./scripts/nj-local.sh status`，然后 `./scripts/nj-local.sh restart` |
| 端口被占用，服务起不来 | 旧的 node 进程还在 | `lsof -nP -iTCP:3000 -sTCP:LISTEN`，`./scripts/nj-local.sh stop` 后再 start |
| 页面 200 但接口全 401 | 正常：未登录 | 用账号密码登录；纯 HTTP 局域网访问也能带上 cookie（已修） |
| 手动生成按钮找不到 | 老版本：日历里「有碎片没日记」的日子会跳到记录页 | 已修（`fix/diary-manual-generation-entrypoints`）；若还在，点日历面板进草稿页，或直接访问 `/diary/YYYY-MM-DD` |
| 生成失败 | 模型地址/密钥/额度问题 | 设置 → 写日记模型 → **生成日志**看具体原因；失败那行可直接「重试」 |
| 某天一直卡在「生成中」 | 生成过程中进程被杀，`pending` 成了孤儿 | 超过 10 分钟后详情页「重新生成」可接管；未满 10 分钟会先返回 CONFLICT |
| 生成出来的日期不对 / 查不到当天数据 | 老版本的时区 bug（`DATE` 列被本地时区偏移） | 已修（`api/lib/date.ts`）；确认代码包含该修复 |
| 数据库里中文变成 `????` 或乱码 | 用 `mysql` 客户端手写中文时没指定字符集 | 加 `--default-character-set=utf8mb4`；已写坏的行需要重新录入 |
| 服务过一会儿自己没了 | 进程是从临时会话/被回收的终端里起的 | 在自己的终端跑 `./scripts/nj-local.sh restart`，或按 §5 配 launchd |
| 改了 `db/schema.ts` 但表没变 | 忘了推 schema | `./scripts/nj-local.sh migrate` |

---

## 8. 更新部署的完整流程

```bash
cd Night-Journal
git pull
npm ci                                  # 依赖有变化时
./scripts/nj-local.sh migrate           # schema 有变化时
npm test && npm run check               # 可选：跑测试和类型检查
./scripts/nj-local.sh build             # 重新构建 dist/
./scripts/nj-local.sh restart           # 重启并等健康检查
```

Docker 部署的更新流程见 [README](./README.md)：`docker compose up -d --build`。
