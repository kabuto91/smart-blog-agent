# smart-blog-agent

AI 驱动的博客 CMS：用自然语言描述，让一个 **多节点 LangGraph Agent** 端到端生成整套博客主题（共享骨架 + 首页/列表页/详情页），支持流式预览、逐页迭代修改、质量评估与自动修订。

## 核心特性

- **Agent 化主题生成**：`planner → skeleton → 并行三页 → validator → judge → revise → commit` 的真实多节点图（LangGraph），非单节点单轮生成。
- **流式体验**：SSE 实时推送 token、阶段进度、工具调用与运行指标。
- **并行页面生成**：首页/列表页/详情页通过 `Send` fan-out 并行执行，共享骨架「视觉契约」。
- **自校验与修订**：每页与骨架做类名重叠率校验（≥15%），失败自动带着反馈重生成；可选 LLM 质量评分（0-100），低于阈值触发一轮修订。
- **迭代修改**：对话式继续生成，指定「整体 / 首页 / 列表页 / 详情页」局部重做，其余页面保持不变。
- **工具使用**：骨架与页面节点可调用图片搜索工具（Safebooru 主色/亮度分析 + 本地图片上传）。
- **可观测性**：每次生成的阶段耗时、质量分、修订轮次写入会话记录并回显到前端。
- **完整博客 CMS**：文章/分类/标签管理、自定义页面、URL 生成、站点配置、访问统计。

## 技术栈

- Next.js 16 (App Router) + React 19，TypeScript
- LangGraph 1.4 + LangChain Core（多节点状态图、`Send`/`Command`、MemorySaver checkpointer、messages-mode 流）
- Prisma 7 + libSQL/SQLite
- SSE 流式渲染、JSDOM 视觉契约校验

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（参考 .env.local）
#    QWEN_API_KEY / QWEN_MODEL / QWEN_BASE_URL   —— LLM（OpenAI 兼容）
#    LLM_ENCRYPTION_KEY                           —— 密钥加密
#    DATABASE_URL                                 —— SQLite 连接串

# 3. 初始化数据库
npx prisma migrate deploy

# 4. 启动开发服务器
npm run dev
# 打开 http://localhost:3000/admin
```

在后台「主题」→「生成新主题」，输入风格描述（或用预设 chips），即可看到 Agent 分阶段生成：

1. **设计总监** 从需求提炼设计简报 → 2. **骨架** 产出共享布局 → 3. **三页并行** 生成正文 → 4. **校验** 与骨架一致性 → 5. **评审** 质量打分 → 6. **保存**。

生成后可继续对话迭代，选择修改范围（整体 / 单页）局部重做。

## 脚本

```bash
npm run dev     # 开发
npm run build   # 生产构建
npm run lint    # ESLint
npm run test    # Vitest 单元/集成测试
```

## 目录速览

```
src/agents/
  theme-graph.ts              # 主题生成多节点图（核心）
  theme-agent.ts              # 纯函数库：提示词、页面类型、HTML 提取
  blog-agent.ts               # 文章/URL 生成 Agent
  tools/image-search.ts       # 图片搜索工具
src/app/api/themes/generate/  # 主题生成 SSE 接口
src/app/api/pages/generate/   # 自定义页面生成 SSE 接口
src/lib/theme/                # 骨架契约、页面拆分、内容渲染、会话
src/lib/stream/sse.ts         # 统一 SSE helper
src/components/admin/          # 后台管理组件（含主题生成对话框）
```

## 文档

- [架构说明](docs/architecture.md)：Agent 图的节点划分、状态设计、并行/修订机制、SSE 契约、关键技术决策。