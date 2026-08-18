# 架构说明：Agent 化主题生成

> 本文说明 `smart-blog-agent` 中主题生成的核心架构：一个由 LangGraph 驱动的多节点 Agent 图，以及它如何端到端地把一句自然语言需求变成一个可编辑的完整博客主题。

## 1. 总体流程

一次「生成新主题」对应下面这张图（`src/agents/theme-graph.ts`）：

```
START
  │ routeFromStart（迭代模式直接跳到 dispatch）
  ▼
planner ──► skeleton ──► dispatch_pages ──Send(fan-out)──► page_home ──┐
  设计简报     骨架+工具     并行三页                 page_list ──┼──► validator
                                                       page_detail ──┘    校验
                                                     ▲                        │
                                                     │                有风险且未超轮次
                                                     │                        ▼
                                              revise（反馈写回 prompt）       judge（可选打分）
                                                     │                        │
                                                     └──────────────◄─────────┘ 低分且未超轮次
                                                                                │
                                                                                ▼
                                                                             commit（持久化）──► END
```

- **planner「设计总监」**：把用户需求提炼成简短设计简报（风格/配色/字体/布局/配图/要点），统一约束后续所有节点，保证三页视觉一致。
- **skeleton**：产出共享骨架（`<head>` 样式 + 导航 + 页脚 + `data-page-host` 挂载点），绑定图片搜索工具，经过 `ensureLayoutContract`（注入 `--nav-h`、导航测量脚本）与 `ensureAvatarOverflow` 标准化，并提取布局 `contentConfig`。
- **dispatch_pages**：通过 LangGraph `Send` 把三个页面节点并行 fan-out。这是真实的并行执行，而非串行 Promise.all。
- **page_home / page_list / page_detail**：读取骨架「视觉契约」（`buildPagePromptContext`：结构 + 类名清单 + CSS），输出正文片段（`<section>`/`<div>`），绑定图片工具，同样走工具循环，最后 `sanitizePageFragment` 清洗。
- **validator**：对本次生成的所有页面做与骨架的一致性校验 —— 用 JSDOM 统计页面所用类名与骨架类名的重叠率（`validatePageFragment`，阈值 ≥15%），并检查 `data-content` 标记规范。
- **judge**（可选开关 `judgeEnabled`）：LLM 对整体设计打 0-100 分并给出一句理由。
- **revise**：当校验有风险或质量分低于 `scoreThreshold`（默认 60）且修订轮次未超过 `maxAttempts`（默认 1）时，只对失败的页面重新 `Send`，并把校验反馈/评审意见写回下一轮 prompt（`feedback` 通道）。
- **commit**：把最终骨架、三页快照与运行指标（阶段耗时/质量分/修订轮次）通过 `addMessage` 持久化到会话。

## 2. 状态设计（Annotation）

`src/agents/theme-graph.ts` 中的 `ThemeStateAnnotation`：

| 通道 | 类型 | reducer | 作用 |
| --- | --- | --- | --- |
| `userRequest` / `conversationId` | `string` | last-value | 输入 |
| `iteration` / `targetPage` / `prevLayout` | 标量 | last-value + 默认值 | 迭代模式开关与目标页 |
| `siteConfig` | `Record` | last-value | 站点配置 |
| `designBrief` | `string` | last-value | planner 产出 |
| `layoutHtml` / `contentConfig` | `string` | last-value | 骨架产出 |
| `pages` / `pageConfigs` / `validation` / `feedback` | `Record` | merge（浅合并） | 各页并行写回并合入 |
| `activePages` | `ThemePageType[]` | last-value | 本次参与生成的页集合 |
| `reviseCount` / `qualityScore` / `qualityReason` | 标量 | last-value | 修订/评审状态 |

> 注意：本项目 LangGraph 为 1.4.x，`Annotation` 使用新式 `{ reducer, default }`（旧的 `{ value }` 已弃用）。last-value + 默认值写法为 `Annotation<T>({ reducer: (_l, r) => r, default })`。

## 3. 并行与修订：LangGraph Send 语义（关键决策）

- **Send fan-out**：`dispatch_pages` 返回 `new Command({ update: { activePages }, goto: new Send('page_*', payload) })`，且节点注册时必须声明 `ends: ['page_home', 'page_list', 'page_detail']`。直接返回 `Send[]` 会抛 `InvalidUpdateError`。
- **子节点 state = Send payload（本项目最重要的一条坑）**：源码里 `task.input = packet.args` —— Send 的 payload 就是子节点看到的**完整 state 视图**，与父节点 checkpoint 不合并。因此 `dispatch`/`revise` 必须把 `userRequest / layoutHtml / pages / feedback / designBrief / siteConfig` 全部放进 payload，否则子节点读到 `undefined`（测试里已用真实 `TypeError` 验证并修复，见 `buildPagePayload`）。
- **join 语义**：并行页面节点通过 reducer 把各自的 `pages[pt]` 写回同一通道，全部完成后 validator（普通边触发节点）恰好运行一次，读到合并后的完整状态 —— 这就是多 agent 结果汇聚的标准做法。
- **修订循环**：validator → 条件边 → revise（再次 Send）→ 页面 → validator …，通过 `reviseCount` 封顶避免无限循环。

## 4. 流式契约（SSE）

`POST /api/themes/generate` 返回 `text/event-stream`（统一封装见 `src/lib/stream/sse.ts`），事件：

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `text` | `{ page, content }` | token 流；`page` 由 `metadata.langgraph_node` 映射（`skeleton` / `home` / `list` / `detail`） |
| `tool_call` | `{ page, name, args }` | 工具调用 |
| `stage` | `{ stage, label, status, detail }` | 阶段开始/结束 + 结果摘要（如校验风险数、质量分） |
| `warn` | `{ message }` | validator 的一致性风险提示 |
| `page` | `{ conversationId, page: { type, html, contentConfig } }` | 最终各页快照（流结束后由 `getState` 读取） |
| `metrics` | `{ metrics }` | 阶段耗时、质量分、修订轮次等运行指标 |
| `done` | `{ conversationId, layoutHtml, contentConfig }` | 结束帧 |
| `error` | `{ error }` | 错误帧 |

实现要点：

- `graph.stream(input, { streamMode: 'messages' })` 产出 `[AIMessageChunk, metadata]`，`metadata.langgraph_node` 用于把 token 归位到对应页面；`createLLM(true)` 通过 callbacks 把 token 汇入 messages 流。
- 每次生成用**独立的 `thread_id`**（`randomUUID`），避免 MemorySaver checkpointer 复用上一次执行状态。
- 流结束后用 `graph.getState({ configurable: { thread_id } })` 取最终状态，回放 `page` / `done` 帧。
- 阶段耗时在 `createThemeGraph` 内以包装 emitter 的方式采集（`start`/`done` 之间累计），commit 时随 `metrics` 事件下发并随 `addMessage` 持久化到 `ThemeMessage.metrics` 列。

## 5. 测试策略

`src/agents/theme-graph.test.ts` 与 `theme-graph.stream.test.ts` 用**脚本化/流式 fake LLM** 注入 `createThemeGraph({ llm })`，覆盖：

- **编排正确性**：planner→skeleton→并行三页→validator→commit 的完整链路；校验失败自动进入 revise 且不超轮次；迭代模式只重生成 `targetPage`。
- **流式契约**：messages-mode 按节点产出 token、`langgraph_node` 元数据正确 —— 这正是路由层 SSE 转发的依赖。
- **工具循环**：模型先发 `search_image` 工具调用（mock 工具避免真实网络），随后产出正文。
- 数据库相关的 `addMessage` 等用 `vi.mock` 隔离，测试不触碰真实 DB。

运行：`npm run test`（Vitest）。

## 6. 相关目录

```
src/agents/theme-graph.ts          # 多节点图、状态、工具循环、指标
src/agents/theme-agent.ts          # 纯函数库：提示词、页面类型、HTML 提取
src/agents/tools/image-search.ts   # 图片搜索工具（Safebooru 主色/亮度分析）
src/app/api/themes/generate/route.ts   # 主题生成 SSE 路由
src/app/api/pages/generate/route.ts    # 自定义页面生成 SSE 路由
src/lib/theme/theme-splitter.ts    # 骨架契约 / sanitize / validate（类名重叠率）
src/lib/theme/theme-session.ts     # 会话持久化（含 metrics 列）
src/lib/stream/sse.ts              # 统一 SSE helper
src/components/admin/theme-generate-dialog.tsx  # 前端：阶段进度 / 指标 / 预设
```