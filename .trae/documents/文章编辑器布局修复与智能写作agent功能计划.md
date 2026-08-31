# 文章编辑器布局修复 + 智能写作 Agent 功能计划

## 一、Summary（目标）

1. **修复文章编辑器布局问题**：文章管理弹窗中，正文编辑区被上方元信息区块（标题/分类/摘要/封面/标签）挤压到几乎无法编辑。通过「元信息可折叠 + 编辑区保证最小高度 + 中部区域可滚动」的布局改造，让正文编辑始终可用。
2. **新增智能写作 Agent**：在文章编辑器内新增「AI 生成正文」能力，支持根据用户输入的部分内容/写作要点/标题，自动生成完整的 markdown 文章正文，流式输出并可直接插入编辑器。

## 二、Current State Analysis（现状分析）

### 布局问题根因
- 编辑弹窗 [article-editor-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/article-editor-dialog.tsx#L273-L536) 结构：
  - 外层容器 `flex max-h-[78vh] flex-col gap-4`（L273）。
  - 元信息网格区块（L275-L466）：标题、Slug、分类、摘要、封面图预览（`aspect-video w-40`）、标签，加上每行 label/padding，整体高度很大且**不可折叠、不滚动**。
  - 编辑区分栏（L469-L536）：左 Markdown 源码 + 右实时预览，`flex min-h-0 flex-1`。
- 结果：78vh 高度被元信息区大量占用，编辑区被压到极小甚至低于视口底部被裁掉，用户「基本上编辑不了」。

### 现有 AI/Agent 基础设施（可直接复用）
- LLM 客户端：[client.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/llm/client.ts#L33-L47) `createLLM(streaming)`，从 DB `LLMConfig` 读取 baseUrl/model/apiKey，兼容 OpenAI，带流式。后台「个人管理」页可配置大模型。
- Agent 模块模式：[theme-agent.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-agent.ts#L171-L211)（系统提示词 + 纯函数构造 prompt）、[blog-agent.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/blog-agent.ts)。
- SSE 流式：`src/lib/stream/sse.ts` 的 `createSSEStream` / `SSE_HEADERS`，示例见 [pages/generate/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/pages/generate/route.ts#L79-L151)。
- 前端 SSE 消费示例：[url-generate-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/url-generate-dialog.tsx#L56-L101)（fetch + reader + 解析 `data: ` 帧）。
- 文章正文为 markdown 字符串，存储在 `Article.content`（[schema.prisma](file:///d:/frontProjects/agent/smart-blog-agent/prisma/schema.prisma#L114-L129)），编辑弹窗用 `react-simple-code-editor` 编辑。

## 三、Proposed Changes（改动方案）

### Part 1：修复文章编辑器布局 —— `src/components/admin/article-editor-dialog.tsx`

改动思路：让元信息区可折叠并限制其展开高度，保证编辑区最小高度；中部区域可滚动，底部操作栏固定。

1. **元信息区改为可折叠区块**
   - 新增状态 `const [metaOpen, setMetaOpen] = useState(() => !article?.id)`：新建文章默认展开；编辑已有文章默认折叠（编辑正文时编辑区最大化，需要改元信息时点开）。
   - 在元信息网格（L275 的 `<div className="grid ...">`）外包一层折叠容器：
     - 头部一行：「文章信息」标题 + 折叠/展开按钮（ChevronDown/ChevronRight 图标），点击切换 `metaOpen`。
     - 展开时显示原有 grid；并将 grid 外包一层限制高度：`max-h-[40vh] overflow-y-auto`（元信息再多也不挤压编辑区，超限内部滚动）。
2. **编辑区保证最小高度**
   - 编辑区分栏（L469 `flex min-h-0 flex-1 gap-4`）改为 `flex min-h-[32vh] flex-1 gap-4`，即使元信息展开也不至于缩到不可用。
3. **中部区域可滚动、底部固定**
   - 将 L273 外层容器内的结构调整为：中部内容（元信息折叠区 + 编辑区 + 提示文案）放进一个 `flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1` 的滚动容器；error 提示与底部操作栏（L543-L570）保持在外层容器底部固定不滚。
   - 外层保留 `flex max-h-[78vh] flex-col gap-4`。
4. 其余逻辑（保存、上传、标签等）保持不变。

### Part 2：智能写作 Agent

#### 1. 新增 Agent 模块 `src/agents/article-agent.ts`
- 定义中文系统提示词 `ARTICLE_SYSTEM_PROMPT`：角色为「专业中文博客作者」，输出标准 GitHub 风格 markdown，包含清晰标题层级（## / ###）、分段、列表、必要时代码块与引用；语言默认中文；不输出与内容无关的解释；保持自然、结构完整。
- 定义类型与纯函数（便于单测）：
  ```ts
  export type ArticleGenMode = "continue" | "generate"
  export interface ArticleGenParams {
    title: string
    excerpt?: string
    content?: string        // 已有正文（部分内容）
    instruction?: string    // 用户写作要求/要点
    mode: ArticleGenMode
  }
  export function buildArticleMessages(params: ArticleGenParams): BaseMessage[]
  ```
  - `mode === "continue"`：系统提示 + 人类消息包含标题/已有正文（若存在），要求「在现有内容基础上续写/补全为完整文章，不要重复已有内容」。
  - `mode === "generate"`：人类消息包含标题 + 写作要求/要点，要求「根据要点生成完整文章」。
  - `excerpt` 存在时作为背景/风格参考注入。
- 说明：与 theme-agent 一致，「agent」指封装了系统提示词 + 生成逻辑的模块，本次为纯文本生成，无需工具调用（LangGraph 对本任务无增益）。

#### 2. 新增 API 路由 `src/app/api/articles/generate/route.ts`
- `POST`，`runtime = "nodejs"`。
- 请求体：`{ title, excerpt?, content?, instruction?, mode }`。
- 校验：title 或 instruction 至少其一；`mode` 不合法时报 400。
- 使用 `buildArticleMessages` 组装消息，`createLLM(true)` 流式调用，通过 `createSSEStream` 转发 `{ type: "text", content }` 帧；异常由 `createSSEStream` 统一发 `error` 帧。
- 只做生成、**不写库**（生成结果由编辑器现有「保存」流程落库）。

#### 3. 新增前端弹窗 `src/components/admin/article-generate-dialog.tsx`
- Props：`{ open, onOpenChange, title, content, onApply }`（`onApply: (nextContent: string) => void`）。
- 打开时将 `title`/`content` 快照到本地 state（用 `useEffect` 依赖 `open` 同步）。
- UI 内容：
  - 顶部标题「AI 生成正文」。
  - 写作要求/文章要点 textarea（占位示例：文章主题、目标读者、想涵盖的要点、语气等）。
  - 模式选择（单选）：`续写补全`（在现有内容基础上补全；无内容时等同于全文生成）/ `生成全文`（忽略现有内容，按标题+要点生成完整文章）。
  - 插入方式选择（单选）：`追加到末尾` / `替换全部内容`（决定点「插入到编辑器」时的行为；`续写`模式下默认追加）。
  - 「开始生成」按钮 → 复用 url-generate-dialog 的 SSE 读取模式（fetch + reader + 解析 `data: ` 帧），把流式文本实时渲染在结果区（只读 textarea，等宽字体）。
  - 生成中显示 loading 与停止/重试；完成后底部出现「插入到编辑器」（按插入方式调用 `onApply` 并关闭）、「取消」。
- 结果区支持生成前为空、生成中、生成完成三种状态。

#### 4. 集成到编辑器 `src/components/admin/article-editor-dialog.tsx`
- 在 Markdown 源码工具栏（L472-L487，紧邻「上传图片」按钮）新增「AI 生成正文」按钮（Sparkles 图标），点击打开生成弹窗。
- 新增 `generateOpen` 状态；渲染 `<ArticleGenerateDialog open={generateOpen} onOpenChange={...} title={title} content={content} onApply={(next) => setContent(next)} />`。

#### 5. 新增单元测试 `src/agents/article-agent.test.ts`
- `buildArticleMessages`：
  - `continue` 模式包含系统消息与已有内容片段；
  - `generate` 模式包含标题与写作要求；
  - 两个模式都返回 `[System, Human]` 结构。

## 四、Assumptions & Decisions（假设与决策）

- **布局修复默认状态**：新建文章元信息默认展开；编辑已有文章默认折叠（用户可随时展开）。折叠后编辑区获得最大高度。
- **AI 生成只处理正文内容**（markdown），不自动生成 title/excerpt/封面；excerpt 可作为风格背景传入。
- **生成语言默认中文**（与主题/站点生成一致），用户可在写作要点里要求其它语言或语气。
- **Agent 不引入 LangGraph/tool**：本任务为单轮文本补全/生成，直接使用 `createLLM(true)` 流式调用，与 theme/pages 生成链路一致。
- **不新增数据模型/迁移**：生成不落库，无需 Prisma 变更。
- **保存仍走原流程**：生成结果插入编辑器后，由用户点「保存」提交。

## 五、Verification（验证步骤）

1. `npx tsc --noEmit`：类型检查通过。
2. `npm test`：vitest 全量通过，含新增 `article-agent.test.ts`。
3. `npm run dev`（端口 3000）手动验证：
   - **布局修复**：编辑已有文章 → 弹窗打开时元信息默认折叠，正文编辑区占据大部分高度可直接编辑；展开元信息后编辑区仍保有最小可用高度；内容过长时中部可滚动、底部按钮固定可见。
   - **AI 生成（续写）**：正文输入部分内容 → AI 生成 → 流式输出 → 插入到编辑器末尾。
   - **AI 生成（全文）**：仅填标题 + 写作要点 → 生成完整文章 → 替换正文。
   - **保存**：生成后保存，博客前台 `/blog/{slug}` 渲染正常。
