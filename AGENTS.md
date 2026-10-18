# AGENTS.md - AI 协作协议

> **"如果你正在阅读此文档，你就是那个智能体 (The Intelligence)。"**
>
> 这个文件是你的**锚点 (Anchor)**。它定义了项目的法则、领地的地图，以及记忆协议。
> 当你唤醒（开始新会话）时，**请首先阅读此文件**。

---

## 30秒恢复协议 (Quick Recovery)

**当你开始新会话或感到"迷失"时，立即执行**:

1. **读取根目录的 AGENTS.md** → 获取项目地图
2. **查看下方"当前状态"** → 找到最新架构版本
3. **读取 `.anws/v{N}/05A_TASKS.md` 与 `05B_VERIFICATION_PLAN.md`** → 了解执行与验证待办
4. **开始工作**

> **提 PR 前必读 `CONTRIBUTING.md`** — 分支命名、commit 格式、PR 模板、测试要求的完整规范都在里面。不按规范提的 PR 会被打回。

---

## 维护约定（个人自用 fork · 优先级最高）

本仓库是 `lb290` 账号下的**个人自用部署**，不是向上游贡献的仓库。以下约定优先于 `CONTRIBUTING.md` 里的 PR 流程：

1. **不提 PR、不推上游**。不要向上游 `Haaaiawd/Night-Journal` 提 PR，也不要 `git push origin`。所有提交只进 `fork` = `git@github.com:lb290/Night-Journal.git`。
2. **只有一条长期分支 `master`**。改动直接提交到 `master` 并推送；临时分支用完就删，不留悬挂分支。
3. **推送用的密钥**（本机）：
   ```bash
   export GIT_SSH_COMMAND="ssh -i /Users/bing/Documents/workspeace/.ssh-nj/id_ed25519 \
     -o UserKnownHostsFile=/Users/bing/Documents/workspeace/.ssh-nj/known_hosts \
     -o IdentitiesOnly=yes"
   git push fork master
   ```
4. **提交前必须绿**：`npm run check` + `npx vitest run`；改了前端或后端后跑 `./scripts/nj-local.sh build`，再 `./scripts/nj-local.sh restart` 让运行中的服务用上新构建。
5. **收尾时工作区要干净**：本地目录始终是 `fork/master` 的检出，不要留未提交改动。
6. 部署、日志、备份、排错见 `DEPLOYMENT.md`；本机一键启停用 `./scripts/nj-local.sh`。
7. 可选的上游同步：`git fetch origin && git merge origin/master`（合并后照常推到 `fork`）。

---

## 地图 (领地感知)

以下是这个项目的组织方式：


| 路径                                    | 描述                                  | 访问协议                                             |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `src/`                                | **实现层**。实际的代码库。                     | 通过 Task 读/写。                                     |
| `.anws/`                              | **统一架构根目录**。包含版本化架构状态与升级记录。         | **只读**(旧版) / **写一次**(新版) / `changelog` 由 CLI 维护。 |
| `.anws/v{N}/`                         | **当前真理**。最新的架构定义。                   | 永远寻找最大的 `v{N}`。                                  |
| `.anws/changelog/`                    | **升级记录**。`anws update` 生成的变更记录。     | 由 CLI 自动维护，请勿删除。                                 |
| `target-specific workflow projection` | **工作流**。`/genesis`, `/blueprint` 等。 | 读取当前 target 对应的原生投影文件。                           |
| `target-specific skill projection`    | **技能库**。原子能力。                       | 调用当前 target 对应的原生投影文件。                           |
| `.nexus-map/`                         | **知识库**。代码库结构映射。                    | 由 nexus-mapper 生成。                               |


## 工作流注册表

> [!IMPORTANT]
> **工作流优先原则**：当任务匹配某个工作流，或你判断当前任务**明显符合、基本符合、甚至只是疑似符合**某个工作流的适用场景时，**都必须先读取相应文件**，并严格遵循其中的步骤执行。工作流是经过精心设计的协议，而非可选参考。
>
> **触发流程**：
>
> 1. 用户提及工作流名称，或你判断当前任务明显符合、基本符合、甚至只是疑似符合某个工作流的适用场景时，都必须先读取相应文件
> 2. **立即读取** 相应工作流文件
> 3. **严格遵循**工作流中的步骤执行
> 4. 在检查点暂停等待用户确认


| 工作流              | 触发时机                 | 产出                                           |
| ---------------- | -------------------- | -------------------------------------------- |
| `/quickstart`    | 新用户入口 / 不知道从哪开始      | 编排其他工作流                                      |
| `/genesis`       | 新项目 / 重大重构           | PRD, Architecture, ADRs                      |
| `/probe`         | 变更前 / 接手项目           | `.anws/v{N}/00_PROBE_REPORT.md`              |
| `/design-system` | genesis 后            | 04_SYSTEM_DESIGN/*.md                        |
| `/blueprint`     | genesis 后            | 05A_TASKS.md + 05B_VERIFICATION_PLAN.md + AGENTS.md 初始 Wave |
| `/change`        | 进入 forge 编码后的任务局部修订  | 更新 TASKS + SYSTEM_DESIGN (仅修改) + CHANGELOG   |
| `/explore`       | 调研时                  | 探索报告                                         |
| `/challenge`     | 决策前质疑                | 07_CHALLENGE_REPORT.md (含问题总览目录)             |
| `/forge`         | 编码执行                 | 代码 + 更新 AGENTS.md Wave 块                     |
| `/craft`         | 创建工作流/技能/提示词         | Workflow / Skill / Prompt 文档                 |
| `/upgrade`       | `anws update` 后做升级编排 | 判断 Minor / Major，并路由到 `/change` 或 `/genesis` |


---

## 宪法 (The Constitution)

1. **版本即法律**: 不"修补"架构文档，只"演进"。变更必须创建新版本。
2. **显式上下文**: 决策写入 ADR，不留在"聊天记忆"里。
3. **交叉验证**: 编码前对照 `05A_TASKS.md` 与 `05B_VERIFICATION_PLAN.md`。我在做计划好的事吗？
4. **美学**: 文档应该是美的。善用 Markdown 与清晰的层次结构。

---

## 项目状态保留区

<!-- AUTO:BEGIN — 项目状态保留区（升级时唯一保留的部分，请勿手动修改区块边界） -->

## 当前状态

- **最近一次更新**: 2026-10-18 — 分支收敛为单条 `master`（个人自用 fork，不提 PR）；新增 WorkBuddy 模型通道、本机部署指南与一键启停脚本
- **认证**: 账号密码（bcrypt cost=12），统一 JWT session（HS256，30 天）；纯 HTTP 局域网访问也能带上 cookie
- **数据库迁移**: 统一用 `drizzle-kit push`（schema diff，幂等可重跑）；不要用 `migrate`，历史 SQL 缺 `IF NOT EXISTS` 会撞表。容器里由 `entrypoint.sh` 自动执行
- **部署方式**: 两种 —— 服务器 `docker compose up -d --build`（自动建表）；本机直跑 `./scripts/nj-local.sh restart`。完整说明见 `DEPLOYMENT.md`
- **模型通道**: 写日记/视觉模型支持 OpenAI 兼容端点与第一方 WorkBuddy 通道（`aiSettings.diaryProvider`）；内网/回环地址默认被 SSRF 防护拦截，需用 `ALLOW_PRIVATE_MODEL_HOSTS` 显式放行
- **时区**: `DATE` 列按 `YYYY-MM-DD` 字符串绑定、`TIMESTAMP` 由连接层固定按 UTC 读写，非 UTC 主机不再错位（`api/lib/date.ts`、`api/queries/connection.ts`）
- **图片**: 上传落本地磁盘（`data/uploads/`，单文件 ≤10MB）。上传即压缩：长边 ≤1600px、剥离 EXIF（含 GPS）、统一转 JPEG，另生成 400px 缩略图（`<uid>/thumb/`）—— 8.8MB 手机原图 → ~140KB 主图 + 11KB 缩略图。HEIC 用 `heic-convert` 兜底解码（sharp 自带 libheif 不含 HEVC 解码器）。`/api/uploads/<userId>/<file>` 与 `/api/uploads/<userId>/thumb/<file>` 均需鉴权；删除碎片时同步清理磁盘文件。历史图片用 `scripts/nj-compress-backfill.mjs` 回填。OSS/S3 仍未接
- **Dream 记忆机制**: 日记生成后异步提炼用户画像（人格/关系/情绪/语风）+ 短期记忆（14 天衰减），注入后续日记 prompt 提供连续性。Settings「记忆」tab 可只读+删除，`aiSettings.enableDream` 开关控制
- **测试状态**: vitest 20 个文件 / 143 passed | 3 skipped，覆盖认证/JWT/env、日期与时区、模型分发与 WorkBuddy、diaries/entries/memories 路由、日记与 Dream 响应解析、图片压缩与删除清理

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, React Router v7, TanStack Query (via tRPC), Framer Motion, Tailwind CSS, shadcn/ui |
| 后端 | Hono (Node http adapter), tRPC v11, Drizzle ORM |
| 数据库 | MySQL 8（本机验证 8.0.40，Compose 里用 8.4；字符集 utf8mb4） |
| 认证 | 账号密码（bcrypt），统一 JWT session (HS256, 30天) |
| 打包 | Vite (前端) + esbuild (后端) |

---

## 开发命令

```bash
# 安装依赖
npm install

# 开发服务器：单个 Vite 进程同时托管前端和 api/boot.ts（@hono/vite-dev-server），端口 3000
npm run dev

# 类型检查 / 测试 / lint
npm run check
npm test
npm run lint

# 数据库 schema 推送（不要用 db:migrate）
npm run db:push

# Drizzle Studio（可视化数据库）
npm run db:studio

# 本机生产模式的构建与启停（详见 DEPLOYMENT.md）
./scripts/nj-local.sh build
./scripts/nj-local.sh restart
./scripts/nj-local.sh status
```

---

## 项目结构

```text
Night-Journal/
├── api/                       # Hono 后端
│   ├── boot.ts                # 入口：认证路由 + 上传/读取接口 + tRPC 挂载；生产模式托管 dist/public 并启动调度器
│   ├── context.ts             # tRPC context（从 JWT cookie 解析用户）
│   ├── middleware.ts          # authedQuery / adminQuery / createRouter 工厂（superjson transformer）
│   ├── router.ts              # appRouter 汇总
│   ├── auth/
│   │   ├── password.ts        # POST /api/auth/register + /api/auth/login（bcrypt cost=12）
│   │   └── session.ts         # JWT sign/verify + authenticateRequest
│   ├── lib/
│   │   ├── env.ts             # APP_SECRET / DATABASE_URL 必填 + 私有地址白名单
│   │   ├── date.ts            # DATE 列按 "YYYY-MM-DD" 字符串绑定，避免时区漂移
│   │   ├── cookies.ts         # session cookie（纯 HTTP 局域网也能带上）
│   │   ├── crypto.ts          # API key / WorkBuddy 凭据 AES-256-GCM 加解密
│   │   ├── model-dispatch.ts  # 按 provider 分发：OpenAI 兼容端点 / WorkBuddy
│   │   ├── openai.ts          # 对话与视觉调用
│   │   ├── workbuddy/         # 第一方 WorkBuddy 通道：auth / chat / credential / product
│   │   ├── url-guard.ts       # SSRF 防护（内网、回环默认拦截）
│   │   ├── upload.ts          # 图片落盘 data/uploads（压缩 + 缩略图 + 删除清理），单文件 ≤10MB
│   │   ├── image.ts           # 压缩流水线：resize 1600px / 剥 EXIF / 转 JPEG / 生成 400px 缩略图 / HEIC 兜底
│   │   ├── scheduler.ts       # 每 60s：自动生成「昨天」的日记 + 记忆过期清理
│   │   └── vite.ts            # 生产模式静态托管 + SPA 回退
│   ├── queries/               # Drizzle 查询层
│   │   ├── connection.ts      # 连接池（UTC 固定 + DATE 字符串）
│   │   ├── entries/ diaries/ ai-settings/ memories/ model-presets/
│   │   └── users.ts           # findUserByUsername / createLocalUser
│   ├── services/
│   │   ├── diary.ts           # 日记生成：prompt 构建、LLM 调用、响应解析、Dream 触发
│   │   └── dream.ts           # 人物画像 + 短期记忆提炼
│   └── routers/               # tRPC 路由：entries / diaries / aiSettings / memories / upload
├── src/                       # React 前端
│   ├── pages/                 # Home（记录碎片）/ Diary（列表）/ DiaryDetail / CalendarPage / Settings / Login / Register
│   ├── components/            # Layout、BottomNav、WorkBuddySettings、AuthLayout、ui/（shadcn）
│   ├── hooks/                 # useAuth / useTheme / useKeyboardHeight / use-mobile
│   └── providers/trpc.tsx     # tRPC client 配置
├── db/
│   ├── schema.ts              # users / entries / entry_attachments / diaries / diary_versions /
│   │                          #   ai_settings / model_presets / user_profiles / short_term_memories
│   ├── relations.ts           # Drizzle 关系定义
│   └── migrations/            # 迁移元数据（snapshot/journal 必须提交；SQL 文件被 gitignore，push 不读）
├── contracts/
│   ├── constants.ts           # 路径常量 + Session 配置
│   ├── prompts.ts             # 日记/风格/视觉/Dream 默认提示词与占位符
│   ├── types.ts               # 共享类型
│   └── errors.ts              # 错误码
├── scripts/nj-local.sh        # 本机一键启停：start / stop / restart / run / status / logs / build / migrate
├── scripts/nj-compress-backfill.mjs  # 历史图片压缩回填（默认 dry run，--apply 执行）
├── DEPLOYMENT.md              # 部署与运维指南（本机 + Docker + 排错 + 分支维护）
├── entrypoint.sh              # 容器启动脚本：drizzle-kit push → node dist/boot.js
├── Dockerfile                 # 多阶段构建：builder → runner (node:22-alpine)
├── docker-compose.yml         # app + mysql:8.4，含 healthcheck
└── .env.example               # 环境变量模板
```

---

## 认证流程

### 账号密码登录

```
POST /api/auth/register  { username, password }
  → 校验格式（3-32位，[a-zA-Z0-9_-]；密码 8-72位）
  → 检查用户名唯一性
  → bcrypt.hash(password, 12)
  → INSERT users（unionId = "local:<username>"）
  → 签发 JWT → 写入 session cookie (30天)
  → 201

POST /api/auth/login  { username, password }
  → 查询用户
  → bcrypt.compare（未知用户也执行，防时序攻击）
  → 签发 JWT → 写入 session cookie (30天)
  → 200
```

---

## 关键 TODO（功能未完成）

1. **图片接对象存储** — 前端走 `POST /api/upload/file` 落本地磁盘（`api/lib/upload.ts` → `data/uploads/`）。换机或多实例部署前需要接 Aliyun OSS / AWS S3 / MinIO；`api/routers/upload.ts` 的 `upload.getUrl` 目前还是占位实现（前端没用它），接入时把它做成真正的预签名 URL
2. **视觉理解依赖自配模型** — 附件识别链路已通（`entries.create` → `triggerVisionAnalysis` → `callVisionModel`），但用户必须在设置里配好视觉模型，否则只存图不做摘要
3. ~~**AI 日记生成**~~ — 已实现：手动（`diaries.generate` / `diaries.regenerate`）与定时（`api/lib/scheduler.ts`，每 60s，只处理「昨天」）
4. ~~**API key 加密存储**~~ — 已实现 AES-256-GCM（`api/lib/crypto.ts`），密钥由 `APP_SECRET` 派生
5. ~~**图片碎片持久化**~~ — 已实现（本地磁盘 + `/api/uploads/<userId>/<file>` 鉴权读取）

---

## 数据库 Schema 要点

- `users`: 账号密码（`username` / `passwordHash`）+ `unionId`（本地账号为 `local:<username>`），`role` 区分 user/admin
- `entries`: 碎片正文 + 情绪，`entryDate` 是 DATE 列（按字符串绑定），`hasImages` 标记有附件，`deletedAt` 软删除，`includedInDiary` 标记已写入日记
- `entryAttachments`: 附件，`fileUrl` 为读取地址（`/api/uploads/...`），`storagePath` 为磁盘相对路径，`thumbStoragePath` 为 400px 缩略图路径（`<uid>/thumb/<file>`，历史数据为 null 时前端回退到原图），`fileSize` 为压缩后字节数，`visionSummary` / `visionStatus` 存视觉识别结果
- `diaries`: 一人一天一篇（`userId` + `diaryDate`），`generationStatus: pending/generated/failed`，`generationError` 是给用户看的脱敏错误，`manuallyEdited` 阻止自动覆盖
- `diaryVersions`: 每次 regenerate 前快照旧内容
- `aiSettings`: 每人一行。模型地址/模型名/提示词/风格/长度/`timezone`/`diaryGenerationTime`；`visionApiKey`、`diaryApiKey`、`diaryWorkbuddyCredential` 一律 **AES-256-GCM 加密存储**；`diaryProvider` 选 OpenAI 兼容或 WorkBuddy；`enableDream` 控制记忆机制
- `modelPresets`: 用户保存的模型配置，便于切换
- `userProfiles`: Dream 提炼的人物画像（人格/关系/情绪/语风/摘要），每人一行
- `shortTermMemories`: 短期记忆（14 天衰减），调度器每天清理过期行

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_SECRET` | ✅ | JWT 签名密钥，同时用于派生 API key 的加密密钥；≥32 位，`openssl rand -hex 32`。**换掉它会导致已存的第三方密钥解不开** |
| `DATABASE_URL` | ✅ | `mysql://user:pass@host:port/db`（Compose 内置 MySQL 时用默认值） |
| `NODE_ENV` | 生产必填 | `production` 时才托管 `dist/public` 并启用调度器（`npm start` 已带） |
| `PORT` | 可选 | 监听端口，默认 3000 |
| `OWNER_UNION_ID` | 可选 | 管理员 union_id，本地账号格式 `local:<username>` |
| `ENABLE_AUTO_GENERATION_IN_DEV` | 可选 | 开发模式下也启用自动生成调度器（生产环境本来就启用） |
| `ALLOW_PRIVATE_MODEL_HOSTS` | 可选 | 允许模型地址指向内网/回环，逗号分隔 `host:port`；只有自建本地模型网关才需要 |
| `UPLOAD_DIR` | 可选 | 图片落盘目录，默认相对启动目录的 `data/uploads` |

完整示例见 `.env.example`，部署与运维细节见 `DEPLOYMENT.md`。早期的 `APP_ID` / `KIMI_*` 已废弃，`VITE_*` 前端不再使用。

<!-- AUTO:END -->

---

> **状态自检**: 准备好了？提醒用户运行 `/quickstart` 开始吧。

