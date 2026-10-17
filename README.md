# smart-blog-agent

AI 驱动的博客 CMS（pnpm monorepo）：用自然语言描述，让一个 **多节点 LangGraph Agent** 端到端生成整套博客主题（共享骨架 + 首页/列表页/详情页），支持流式预览、逐页迭代修改、质量评估与自动修订；同时内置 **AI 文章生成**（注入个人写作画像）、**掘金一键发布**（Playwright 自动化）、可复用文本库与完整的文章/分类/标签/合集管理。

## 仓库结构

拆成三个包，前后台职责与部署边界清晰：

| 包 | 作用 | 部署 |
| --- | --- | --- |
| `apps/web` | 前台博客站点：主题渲染 + 公开 API | **部署 Vercel** |
| `apps/admin` | 后台管理、AI 生成、掘金自动发布 | **仅本地运行** |
| `packages/core` | 前后台共享库（内容渲染、主题处理、数据访问） | 源码消费，无需构建 |

- `packages/core` 是纯源码包（无独立构建产物），由 Next 直接编译消费，通过 `exports: { "./*": "./src/*.ts" }` 暴露，如 `import { renderContent } from "@smart-blog/core/lib/theme/content-renderer"`。
- `apps/admin` 独占 AI 生成（LangGraph）、掘金发布（Playwright）、`/admin` 页面与生成类 API；前台路由**只存在于 `apps/web`**，后台不包含。
- 两边共享同一套数据库连接与 Prisma 模型（Prisma schema 保留在**仓库根** `prisma/`，生成物输出到 `packages/core/src/generated/prisma`）。
- 根路径 `/` 直接渲染主题首页；`/blog` 为同内容别名，用于兼容主题内写死的链接。

## 核心特性

### 主题生成（LangGraph 多节点图）

- **Agent 化主题生成**：`planner → skeleton → 并行三页 → validator → judge → revise → commit` 的真实多节点图（LangGraph），非单节点单轮生成。
- **流式体验**：SSE 实时推送 token、阶段进度、工具调用与运行指标。
- **并行页面生成**：首页/列表页/详情页通过 `Send` fan-out 并行执行，共享骨架「视觉契约」。
- **自校验与修订**：每页与骨架做类名重叠率校验（≥15%），失败自动带着反馈重生成；可选 LLM 质量评分（0-100），低于阈值触发一轮修订。
- **修订可追溯**：每次 Send 写入带 `attemptIndex` 与错误摘要的会话记录，配合历史快照可回滚到指定修订轮次。
- **迭代修改**：对话式继续生成，指定「整体 / 首页 / 列表页 / 详情页」局部重做，其余页面保持不变。
- **工具使用**：骨架与页面节点可调用图片搜索工具（Safebooru 主色/亮度分析 + 本地图片上传）。
- **断点持久化**：LangGraph checkpointer 落库 PostgreSQL，服务重启不丢会话状态。

### 动态内容渲染

- **数据插槽机制**：主题 HTML 通过 `data-content`（文本字段）与 `data-map`（动态数据：文章列表、正文、封面图、链接、分类/标签列表）标记，渲染时自动注入真实数据库内容。
- **主题激活即上线**：激活主题后，前台首页/文章详情/分类/标签/归档/合集等页面均由主题 HTML + 布局注入（侧边栏导航）驱动渲染，无主题时回退提示页。前台路由全部 `force-dynamic`，本地激活主题后线上即时生效，无需重新部署。
- **可复用文本库**：将任意文本字段存入复用库，跨主题共享；绑定后修改库内文本即可同步生效。
- **用户画像注入**：基于最近 20 篇已发布文章自动生成个人写作画像，可一键注入文章生成与主题生成的提示词。

### 文章与发布

- **AI 文章生成**：输入主题/要点即可生成完整 Markdown 文章，后台支持实时预览、可视化编辑、标签搜索下拉选择。
- **掘金自动发布**：Playwright 驱动真实浏览器，把 Markdown 自动发布到掘金；支持 Cookie 登录态维护、已发文章存在性检测（自动更新 or 新增）、分类/标签自动填充、专栏自动同步。
- **标签批量迁移**：一键导入掘金官方标签库（700+ 标签），自动处理 slug 冲突。
- **合集管理**：文章归入合集，合集可绑定掘金专栏，发布时自动同步。

### 完整 CMS

- 文章/分类/标签/合集管理、自定义页面、URL 生成、站点配置（标题/描述/作者等全局字段）、访问统计、图片上传、LLM/Vision 多模型配置。

## 技术栈

- Next.js 16 (App Router) + React 19，TypeScript
- pnpm workspaces（monorepo）
- LangGraph 1.4 + LangChain Core（多节点状态图、`Send`/`Command`、PostgresSaver checkpointer、messages-mode 流）
- Prisma 7 + PostgreSQL（Supabase），应用运行时走 `@prisma/adapter-pg`
- Playwright（掘金发布自动化）
- SSE 流式渲染、JSDOM 视觉契约校验、Tailwind CSS 4

## 快速开始

```bash
# 1. 安装依赖（在仓库根执行）
pnpm install          # postinstall 会自动执行 prisma generate

# 2. 配置环境变量
#    根 .env.local              —— 供 Prisma CLI 使用
#    apps/admin/.env.local      —— 供后台运行时使用
#    apps/web/.env.local        —— 供前台运行时使用
#    Next 只加载进程 cwd 下的 .env，因此需分别复制一份。
#
#    DATABASE_URL          —— Supabase 事务模式池化端口（6543），应用运行时使用
#    DIRECT_URL            —— Supabase 会话模式端口（5432），仅 Prisma migrate/db push 使用；LangGraph checkpointer 也优先用它
#    LLM_ENCRYPTION_KEY    —— 密钥加密，必须与已有取值一致，否则解不出库中已存的 API Key
#    QWEN_API_KEY / QWEN_MODEL / QWEN_BASE_URL
#                          —— 可选。LLM 配置优先读数据库（后台「设置 → LLM 配置」），环境变量仅作缺省回退

# 3. 初始化数据库（连接 Supabase，执行迁移）
pnpm db:migrate       # 或 pnpm db:push

# 4. 启动
pnpm dev:admin        # 后台 http://localhost:3000/admin
pnpm dev:web          # 前台 http://localhost:3000
# 两者默认都是 3000，需要同时运行时可指定端口：
# pnpm --filter @smart-blog/web exec next dev -p 3001
```

### 使用流程

1. **生成主题**：后台「主题」→「生成新主题」，输入风格描述（或用预设 chips），即可看到 Agent 分阶段生成：**设计总监** 提炼设计简报 → **骨架** 产出共享布局 → **三页并行** 生成正文 → **校验** 一致性 → **评审** 质量打分 → **保存**。生成后可继续对话迭代，选择修改范围（整体 / 单页）局部重做。
2. **激活主题**：激活后前台（`/`、`/blog` 及所有博客路由）由主题渲染，真实文章/分类/标签数据自动注入主题模板。
3. **写作与发布**：后台「文章」可用 AI 生成或手动编辑文章；文章保存后可直接「发布到掘金」（需在「个人管理 → 掘金发布配置」配置 Cookie）。

## 部署（Vercel）

只部署前台，后台留本地，两边连同一个线上 Supabase。

1. 在 Vercel 导入本仓库，设置 **Root Directory = `apps/web`**，Framework 选 Next.js（构建命令用默认的 `pnpm build`）。
2. Vercel 会识别 pnpm workspace 并在**仓库根**安装依赖，因此根 `postinstall` 的 `prisma generate` 会正常执行；环境变量需在构建前可用。
3. 配置环境变量：`DATABASE_URL`（6543 池化，必需）、`LLM_ENCRYPTION_KEY`（与现有值一致）、可选 `QWEN_*`。`DIRECT_URL` 仅供本地迁移使用，无需配置到 Vercel。
4. `apps/web/next.config.ts` 已将 `outputFileTracingRoot` 指向仓库根，确保 `@smart-blog/core` 等 workspace 依赖被正确打包。
5. **数据库迁移不放进构建命令**，在本地或 CI 执行 `pnpm db:migrate`。

> ⚠️ 后台依赖 Playwright 子进程的接口（掘金发布、专栏管理、Cookie 测试）**无法运行在 Vercel**（浏览器体积超函数上限、运行时不兼容），因此这些能力必须保留在本地后台。

## 掘金发布

脚本位于 `apps/admin/src/agents/juejin-publisher/`（流程、参数与注意事项见 [SKILL.md](apps/admin/src/agents/juejin-publisher/SKILL.md)）：

```bash
# 在后台目录下执行（或从根目录用 pnpm --filter 调用）
pnpm --filter @smart-blog/admin juejin:test-cookie   # 无浏览器校验 Cookie 登录态
pnpm --filter @smart-blog/admin juejin:login         # 打开浏览器登录掘金，保存登录态
pnpm --filter @smart-blog/admin juejin:publish -- --file ./article.md --tags 前端,工具 --category 前端
```

- Cookie 从数据库读取（后台「个人管理 → 掘金发布配置」维护），后台「发布到掘金」按钮会自动使用。
- 不带 `--article-id` 时直接新增；带上本地维护的掘金 post id 时先探测文章是否存在——存在走**更新流程**，不存在自动回退新增；`--force-new` 强制新增。
- 发布途中出现验证码/滑块时脚本暂停等待人工处理；失败时保存现场截图到 `.tmp/` 供排查。

## 常用脚本

所有脚本在**仓库根**执行：

```bash
pnpm dev:admin        # 启动后台
pnpm dev:web          # 启动前台
pnpm build:admin      # 构建后台
pnpm build:web        # 构建前台（Vercel 同款构建）
pnpm test             # 运行 core + admin 的 Vitest 测试
pnpm db:generate      # 生成 Prisma Client
pnpm db:migrate       # 执行数据库迁移（走 DIRECT_URL）
pnpm db:push          # 直接同步 schema 到数据库
```

## 目录速览

```
prisma/schema.prisma            # 数据模型：SiteConfig/Theme/ThemePage/Article/Category/Tag/Collection/LLMConfig 等
prisma.config.ts                # Prisma CLI 配置（加载根 .env.local，迁移走 DIRECT_URL）

apps/web/                       # 前台（部署 Vercel）
  src/app/
    route.ts                    # 首页（/ 直接渲染主题首页）
    [...path]/route.ts          # 兜底：无匹配路由时按主题自定义页面渲染
    blog/route.ts|archive|category/[slug]|tag/[slug]|[slug]  # 列表/归档/分类/标签/文章详情
    collections/route.ts|collections/[slug]                  # 合集列表/详情
    api/stats|articles/[id]/like|articles/[id]/read|uploads/[id]  # 公开 API
  src/lib/blog-cache.ts         # 前台页面渲染 + HTML 缓存层（unstable_cache）
  next.config.ts                # outputFileTracingRoot 指向仓库根

apps/admin/                     # 后台（本地运行）
  src/agents/
    theme-graph.ts              # 主题生成多节点图（核心）
    theme-agent.ts              # 纯函数库：提示词、页面类型、HTML 提取
    article-agent.ts            # 文章生成 Agent（支持用户画像注入）
    blog-agent.ts               # 博客 URL/内容生成 Agent
    juejin-publisher/           # 掘金自动发布（Playwright 脚本 + SKILL.md）
    tools/image-search.ts       # 图片搜索工具
  src/app/
    admin/                      # 后台页面（主题/文章/分类/标签/合集/个人/设置）
    api/                        # themes|pages 生成 SSE、articles CRUD/AI、juejin、user-profile 等
  src/lib/
    llm/                        # LLM/Vision 客户端与记忆
    theme/                      # 会话、检查点、URL 选项、风格分析（前台共享部分已移入 core）
    stream/sse.ts               # 统一 SSE helper
    store/app-store.ts          # 后台状态管理
    user-profile.ts|juejin-*.ts # 画像与掘金业务逻辑
  src/components/               # 后台管理组件 + 通用 UI

packages/core/src/
  lib/                          # 前后台共享库
    theme/                      # 骨架契约、页面拆分、内容提取/渲染、布局注入
    db/                         # Prisma 客户端、统计
    articles.ts|collections.ts|collections-render.ts|blog.ts
    site-config.ts|reusable-text.ts|article-stats.ts|uploads.ts|markdown.ts|field-registry.ts|crypto.ts
    types/content-config.ts
  generated/prisma/             # Prisma Client 生成物（gitignore）
```

## 文档

- [架构说明](docs/architecture.md)：Agent 图的节点划分、状态设计、并行/修订机制、SSE 契约、关键技术决策。
- [掘金发布技能说明](apps/admin/src/agents/juejin-publisher/SKILL.md)：发布流程、参数、存在性检测机制与注意事项。
