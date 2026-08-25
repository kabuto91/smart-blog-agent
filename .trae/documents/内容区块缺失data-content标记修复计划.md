# 修复计划：内容区块缺 data-content 标记导致无法自定义

## 摘要

首页 CORE MODULES 卡片区、tags-group 等内容没有 `data-content` 属性，导致这些区域进不了 contentConfig、后台无法自定义。经分析这不是单点 bug，而是**三层防线全部失守**：prompt 措辞太软（"建议"而非"必须"）、validator 不校验 data-content 覆盖率、提取器无自动补齐兜底。

修复方案（用户已确认）：
1. **Prompt 强化**——把文本区标记从"建议"改为"必须"，并明确自由区块也要打标
2. **校验闭环**——`validatePageFragment` 增加 data-content 覆盖率检查，漏标自动触发现有 LLM 修订循环（theme-graph.ts 无需改动）
3. **提取兜底**——`extractContentConfig` 对仍未标记的标题/段落自动补 `data-content-type="text"`
4. **存量主题**——用户在界面重新生成主题（无代码改动，操作指引）

## 根因分析（实测确认）

当前激活主题 home 页结构实测（DB 查询）：

```
<section class="section"> [NO-DC]            ← hero 区（内部 h1/p 有标记，区块级可接受）
  <h1 dc=blog-title> ✓  <p dc=site-description> ✓
  <div class="tags-group"> [NO-DC]           ← 标签组未标记
<div class="container"> [NO-DC]
  <div class="two-col-layout">
    <section dc=article-list> ✓               ← 动态文章列表（正确）
    <section class="section"> [NO-DC]          ← ★ CORE MODULES：3 张 post-card 全部无标记
      <article class="post-card"> [NO-DC]      ← h3 标题 / p 摘要 / meta 全部无标记
  <aside class="sidebar"> [NO-DC]              ← 侧边栏容器（内部 widget 有部分标记）
```

三层失守：

1. **Prompt 层**（[theme-agent.ts](d:\frontProjects\agent\smart-blog-agent\src\agents\theme-agent.ts#L251-L257)）：L253 对普通文本区域用"**建议**用 data-content 标记"——软性措辞 LLM 不遵守；动态区规则只列了"文章列表等"，而首页 bodyPrompt（L190）鼓励"自由组织任意区块组合"，LLM 把自创的 CORE MODULES 静态卡片当纯装饰不打标
2. **校验层**（[theme-splitter.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.ts#L290-L320)）：`validatePageFragment` 只检查禁用标签 + 类名重叠率，无 data-content 覆盖率检查 → 漏标直接放行入库
3. **提取层**（[content-extractor.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-extractor.ts#L106-L149)）：`extractContentConfig` 只提取带 `[data-content]` 的元素；自动补齐仅限 nav（`findUnmarkedNavs`），其他未标记区块全部丢弃

## 修复方案

### 修复 1：Prompt 强化

文件：[theme-agent.ts](d:\frontProjects\agent\smart-blog-agent\src\agents\theme-agent.ts)

**1a. `buildPageSystemPrompt` 的【内容标记规则】段（L251-L257）**，将：

> 普通文本区域（标题、段落、页脚文字等）建议用 data-content + data-content-type="text" 标记，便于后续编辑。

改为：

> 普通文本区域（标题、段落、标签组、卡片文字、统计数字、时间线条目、说明文字等）**必须**用 data-content + data-content-type="text" 标记，否则该内容无法在后台自定义。每个独立区块内的标题与正文文本元素都要分别标记（例如一个卡片区块的标题一个 key、摘要一个 key）。

**1b. home 页 bodyPrompt（L188-L196）** 在【数据绑定规则】后追加一条：

> - 首页自由组织的区块（作者介绍、统计、时间线、特色卡片组合等）内的所有标题（h2/h3/h4）与段落文本（p）都必须标记 data-content + data-content-type="text"，key 用语义化英文命名（如 core-modules-title、feature-card-desc）。

不改 list/detail 的 prompt（列表页核心是动态区已有硬规则；详情页有 article-body 硬规则，风险低）。

### 修复 2：validator 覆盖率校验

文件：[theme-splitter.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.ts) `validatePageFragment`（L290-L320）

新增检查逻辑：

```ts
// 内容标记覆盖率：h1-h6 / p 是后台可自定义的基本文本单元，
// 若自身或祖先均无 data-content，则该文本无法被编辑。
const units = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")).filter(
  (el) => (el.textContent ?? "").trim().length > 0
)
const uncovered = units.filter(
  (el) => el.closest("[data-content]") === null
)
// 容忍 1 个漏网（如极小的装饰性文本），≥2 个视为结构性漏标
if (uncovered.length > 1) {
  const sample = uncovered
    .slice(0, 3)
    .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`)
    .join("、")
  issues.push(
    `有 ${uncovered.length} 处标题/段落文本未标记 data-content（如 ${sample}），这些内容将无法在后台自定义；请为其补充 data-content + data-content-type="text"`
  )
}
```

**自动进入修订闭环**：issue 使 `ok=false` → `computeRevisePlan`（theme-graph.ts L463-465）将页面加入 `failing` → `buildFeedback` 把 issue 文本传入 feedback → `pageNode` 以"上一轮校验反馈，必须修复"（L376-378）重跑该页。**theme-graph.ts 无需任何改动**。

注意：`validatePageFragment` 的调用输入是 `sanitizePageFragment(html, layoutClasses)` 的产物，sanitize 不剥离 data-content，校验语义不受影响。

### 修复 3：提取兜底自动补标

文件：[content-extractor.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-extractor.ts) `extractContentConfig`（L106-L149）

在 `doc.querySelectorAll("[data-content]")` 提取循环**之前**新增补标步骤：

```ts
/** 兜底：对未标记的标题/段落自动补 data-content=text 标记（LLM 漏标时避免内容不可编辑）。 */
function markUnmarkedTextUnits(doc: Document): void {
  const units = Array.from(
    doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")
  ).filter(
    (el) =>
      (el.textContent ?? "").trim().length > 0 &&
      el.closest("[data-content]") === null
  )
  const used = new Set(
    Array.from(doc.querySelectorAll("[data-content]"))
      .map((el) => el.getAttribute("data-content") ?? "")
      .filter(Boolean)
  )
  for (const el of units) {
    // key 优先取类名 kebab 化（.post-title → post-title），无类名用 tag+序号
    const base =
      (el.getAttribute("class") ?? "").split(/\s+/)[0]?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      el.tagName.toLowerCase()
    let key = base
    let i = 2
    while (used.has(key)) key = `${base}-${i++}`
    used.add(key)
    el.setAttribute("data-content", key)
    el.setAttribute("data-content-type", "text")
  }
}
```

要点：
- **只给叶子文本元素（h1-h6/p）打标，不打容器**——`renderTextField` 是 `textContent` 替换（content-renderer.ts L495+），打容器会破坏内部嵌套结构；打叶子安全
- 补标发生在提取循环之前，补标元素自然走 `extractTextField` 进入 contentConfig（`source: "theme"`，后台可编辑）
- key 用类名 kebab 化保证语义（post-title / post-card-excerpt），重复时靠序号去重；与既有 `uniqueKey` 机制协同（补标先占 key，提取循环的 `usedKeys` 从补标后的 DOM 重建，不冲突）
- 调用位置：`extractContentConfig` 中 `const elements = doc.querySelectorAll("[data-content]")` 之前执行 `markUnmarkedTextUnits(doc)`

### 修复 4：存量主题重新生成（无代码改动）

用户已确认选择重新生成。修复 1-3 生效后，通过现有管理后台主题生成入口（POST `/api/themes/generate`，见 [route.ts](d:\frontProjects\agent\smart-blog-agent\src\app\api\themes\generate\route.ts)）重新生成主题。新 prompt 的"必须"措辞 + validator 覆盖率检查 + 提取兜底三层保障下，新主题的文本内容将全部可自定义。**本项为操作指引，不在代码改动范围。**

## 测试计划

1. [theme-splitter.test.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.test.ts) 新增用例：
   - 含多个未标记 h2/p 的片段 → `ok=false`，issues 包含"未标记 data-content"
   - 全部标记（或仅 1 处漏标）的片段 → 该项不报 issue
   - 既有用例（禁用标签、类名重叠率）保持通过
2. [content-extractor.test.ts](d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-extractor.test.ts) 新增用例：
   - 含未标记 `<h3 class="post-title">` / `<p class="post-card-excerpt">` 的片段 → 提取后自动生成 `post-title` / `post-card-excerpt` 的 text 字段
   - 重复类名（两个 .post-title）→ key 去重为 `post-title` / `post-title-2`
   - 已有 `[data-content]` 祖先覆盖的文本不被重复补标
   - 无类名元素 → key 为 tag+序号（如 `h3-2`）
   - 既有用例保持通过
3. 全量 `npx vitest run` 通过

## 验证步骤

1. `npm test` 全量通过
2. 重新生成主题后（用户操作），用只读 DB 查询复测：home 页所有 h1-h6/p 的 `closest('[data-content]')` 覆盖率应为 100%（0 个未覆盖单元）
3. 管理后台打开新主题的内容编辑面板，确认 CORE MODULES 卡片标题/摘要等字段出现且可编辑
4. 浏览器渲染首页确认视觉无回归（text 字段初始值即原文，渲染不变）

## 假设与决策

- 校验容忍 1 个漏标单元（避免极端误报阻塞生成流程），≥2 个才触发 LLM 修订重跑
- 兜底补标只处理 h1-h6/p 叶子，不处理 span/div 等行内文本（后台编辑价值低、误伤风险高）；tags-group 类内容接受不可自定义
- 不做存量数据迁移脚本（用户选择重新生成）
- prompt 只强化 home 页与通用规则，不动 list/detail（各有硬性数据绑定规则覆盖核心内容）
- LLM 修订循环复用现有 `reviseCount` 上限与 feedback 机制，不新增循环次数控制
