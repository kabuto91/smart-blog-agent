# smart-blog-agent

AI 驱动的博客 CMS：用自然语言描述，让一个 **多节点 LangGraph Agent** 端到端生成整套博客主题（共享骨架 + 首页/列表页/详情页），支持流式预览、逐页迭代修改、质量评估与自动修订；同时内置 **AI 文章生成**（注入个人写作画像）、**掘金一键发布**（Playwright 自动化）、可复用文本库与完整的文章/分类/标签/合集管理。

## 核心特性

### 主题生成（LangGraph 多节点图）

- **Agent 化主题生成**：`planner → skeleton → 并行三页 → validator → judge → revise → commit` 的真实多节点图（LangGraph），非单节点单轮生成。
- **流式体验**：SSE 实时推送 token、阶段进度、工具调用与运行指标。
- **并行页面生成**：首页/列表页/详情页通过 `Send` fan-out 并行执行，共享骨架「视觉契约」。
- **自校验与修订**：每页与骨架做类名重叠率校验（≥15%），失败自动带着反馈重生成；可选 LLM 质量评分（0-100），低于阈值触发一轮修订。
- **迭代修改**：对话式继续生成，指定「整体 / 首页 / 列表页 / 详情页」局部重做，其余页面保持不变。
- **工具使用**：骨架与页面节点可调用图片搜索工具（Safebooru 主色/亮度分析 + 本地图片上传）。
- **可观测性**：每次生成的阶段耗时、质量分、修订轮次写入会话记录并回显到前端。

### 动态内容渲染

- **数据插槽机制**：主题 HTML 通过 `data-content`（文本字段）与 `data-map`（动态数据：文章列表、正文、封面图、链接、分类/标签列表）标记，渲染时自动注入真实数据库内容。
- **主题激活即上线**：激活主题后，前台首页/文章详情/分类/标签/归档/合集等页面均由主题 HTML + 布局注入（侧边栏导航）驱动渲染，无主题时回退提示页。
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
- LangGraph 1.4 + LangChain Core（多节点状态图、`Send`/`Command`、MemorySaver checkpointer、messages-mode 流）
- Prisma 7 + libSQL/SQLite
- Playwright（掘金发布自动化）
- SSE 流式渲染、JSDOM 视觉契约校验、Tailwind CSS 4

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 .env）
#    QWEN_API_KEY / QWEN_MODEL / QWEN_BASE_URL   —— LLM（OpenAI 兼容）
#    LLM_ENCRYPTION_KEY                           —— 密钥加密
#    DATABASE_URL                                 —— SQLite 连接串（如 file:./dev.db）

# 3. 初始化数据库
npx prisma migrate deploy

# 4. 启动开发服务器
npm run dev
# 打开 http://localhost:3000/admin
```

### 使用流程

1. **生成主题**：后台「主题」→「生成新主题」，输入风格描述（或用预设 chips），即可看到 Agent 分阶段生成：**设计总监** 提炼设计简报 → **骨架** 产出共享布局 → **三页并行** 生成正文 → **校验** 一致性 → **评审** 质量打分 → **保存**。生成后可继续对话迭代，选择修改范围（整体 / 单页）局部重做。
2. **激活主题**：激活后前台（`/` 及所有博客路由）由主题渲染，真实文章/分类/标签数据自动注入主题模板。
3. **写作与发布**：后台「文章」可用 AI 生成或手动编辑文章；文章保存后可直接「发布到掘金」（需在「个人管理 → 掘金发布配置」配置 Cookie）。

## 掘金发布

通过根目录 npm scripts 调用（详见 [src/agents/juejin-publisher/SKILL.md](src/agents/juejin-publisher/SKILL.md)）：

```bash
npm run juejin:test-cookie            # 无浏览器校验 Cookie 登录态
npm run juejin:login                  # 打开浏览器登录掘金，保存登录态
npm run juejin:publish -- --file ./article.md --tags 前端,工具 --category 前端
```

- 不带 `--article-id` 时直接新增；带上本地维护的掘金 post id 时先探测文章是否存在——存在走**更新流程**，不存在自动回退新增；`--force-new` 强制新增。
- Cookie 推荐在后台「个人管理 → 掘金发布配置」维护，后台「发布到掘金」按钮会自动使用。
- 发布途中出现验证码/滑块时脚本暂停等待人工处理；失败时保存现场截图到 `.tmp/` 供排查。

## 脚本

```bash
npm run dev     # 开发
npm run build   # 生产构建
npm run start   # 生产启动
npm run lint    # ESLint
npm run test    # Vitest 单元/集成测试
```

## 目录速览

```
src/
  agents/
    theme-graph.ts              # 主题生成多节点图（核心）
    theme-agent.ts              # 纯函数库：提示词、页面类型、HTML 提取
    article-agent.ts            # 文章生成 Agent（支持用户画像注入）
    blog-agent.ts               # 博客 URL/内容生成 Agent
    juejin-publisher/           # 掘金自动发布（Playwright 脚本 + SKILL.md）
    tools/image-search.ts       # 图片搜索工具
  app/
    [...path]/route.ts          # 前台主题渲染入口（无匹配路由时按主题页面渲染）
    blog/                       # 前台数据路由（文章详情/分类/标签/归档）
    admin/                      # 后台页面（主题/文章/分类/标签/合集/个人/设置）
    api/
      themes/generate/          # 主题生成 SSE 接口
      pages/generate/           # 自定义页面生成 SSE 接口
      articles/                 # 文章 CRUD、AI 生成、精选、点赞
      categories|tags|collections/  # 内容组织
      juejin/                   # 掘金发布、Cookie 配置、标签导入
      user-profile/             # 用户画像读取/保存/生成
      site-config|stats|uploads|urls|llm-config|vision-config/  # 系统配置
  lib/
    theme/                      # 骨架契约、页面拆分、内容提取/渲染、布局注入、风格分析
    llm/                        # LLM/Vision 客户端与记忆
    stream/sse.ts               # 统一 SSE helper
    articles.ts|collections.ts|juejin-*.ts|user-profile.ts|site-config.ts  # CMS 业务逻辑
    reusable-text.ts            # 可复用文本库
  components/
    admin/                      # 后台管理组件（主题生成对话框、文章编辑器、元数据管理等）
    ui/                         # 通用 UI 组件
prisma/schema.prisma            # 数据模型：SiteConfig/Theme/ThemePage/Article/Category/Tag/Collection/LLMConfig 等
```

## 文档

- [架构说明](docs/architecture.md)：Agent 图的节点划分、状态设计、并行/修订机制、SSE 契约、关键技术决策。
- [掘金发布技能说明](src/agents/juejin-publisher/SKILL.md)：发布流程、参数、存在性检测机制与注意事项。
