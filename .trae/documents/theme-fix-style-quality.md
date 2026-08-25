# 主题生成样式质量分析 + 修复方案

## 一、Summary（结论先行）

`smart-blog-agent` 使用「骨架阶段 → 三页并行阶段 → 静态审计/评审 → 一次修订 → 持久化」的 LangGraph 流水线生成主题。每次生成总出现「错乱」或「溢出」，根本原因是结构性的：

1. **页正文只拿到骨架类名的"名单"，拿不到完整 CSS**，却被允许自由组合类名、自建布局容器，导致大量类名被以骨架从未设计和验证过的方式叠加 —— 错乱。
2. **`CLASS_BRIDGE` 用静态字符串把页面规约类名改写成骨架类名**，目标类一旦在骨架里不存在，样式被静默丢弃。
3. **溢出几乎没有任何机械兜底**：`normalizeThemeSpacing` 只 clamp padding/margin/gap；`@media` 缺失只是 warn 不修复；`width`/`font-size`/`grid` 硬编码、以及真实文章长文本（pre/table/长单词/图片）全部不受保护 → 横向溢出。

方案以「**低风险的机械兜底 + 语义修正**」为主，不重写整条生成管线：
- 在布局统一注入一层「安全兜底样式」彻底消除溢出；
- 把 `CLASS_BRIDGE` 改成**上下文感知**（仅当目标类确实存在于骨架时才改写），消除错乱中的样式丢失。

---

## 二、当前状态分析（代码依据）

### 2.1 生成管线（已读）
- 骨架阶段 [theme-agent.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\agents\theme-agent.ts#L49-L82)：产出 `<head><style>`（整站设计系统 + CSS 变量）+ 导航 + 页脚 + 唯一的 `<div data-page-host>` 占位。
- 三页并行阶段 [theme-agent.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\agents\theme-agent.ts#L130-L212)：各页 agent 收到 `buildPagePromptContext`（截断的 CSS + 完整类名清单），独立产出正文片段。
- 修订链路：`validator → audit → judge → revise`（[theme-graph.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\agents\theme-graph.ts#L384-L733)），`maxAttempts` 默认 1。
- 渲染链路：`mergeThemePage`（含 `ensureLayoutContract`）→ `renderContent`（[blog.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\blog.ts#L150-L199)）。

### 2.2 错乱的根因
1. **CSS 被截断到 16000 字符**（`MAX_CSS_CHARS`，[theme-agent.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\agents\theme-agent.ts#L179-L181)），页 agent 只看到类名清单，**看不到这些类的真实宽度/display/gap**，却被告知"只能用它、可自由组合" → 组合方式骨架从未设计过 → 样式叠加冲突 → 错乱。
2. **`CLASS_BRIDGE` 静态字符串改写**（[theme-splitter.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.ts#L133-L155)）：`sanitizePageFragment` 在**不知道骨架类集**的情况下把 `article-hero→article-header`、`list-page→page-main` 等直接替换。若目标类名骨架没定义，元素彻底失去样式；且改写的类可能顺带丢掉页原本依赖的样式。
3. **`validatePageFragment` 重合率阈值过低（0.15）**（[theme-splitter.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.ts#L240-L242)）：页面几乎可以"自创"大部分类名而不被拦截。

### 2.3 既有的体检防线及其局限
- `sanitizePageFragment`：只剥 `script/style/nav/footer` 和部分浮动组件。
- `validator`：只查禁用标签 + 类名重合率。
- `audit`/`style-analyzer.ts`：只做「背景纯白/无动效/无 hover/无 @media/字体无个性/变量太少」这类**美学**检查；`checkMediaQueries` 是 warn 级（[style-analyzer.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\style-analyzer.ts#L154-L158)），**不产出自已修复**。
- `revise`：把文本反馈重新丢给 LLM，但因页 agent 依然看不到真实 CSS，往往再次生成同样的结构问题；默认只 1 轮。

### 2.4 溢出的具体来源
1. **`normalizeThemeSpacing` 只 clamp 三类属性**：padding-top/bottom、margin-top/bottom、gap，且仅命中 `section/.hero/.footer` 等选择器（[theme-splitter.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\theme-splitter.ts#L311-L323)）。**完全不处理** `width/min-width/max-width/font-size/grid-template-columns/height`。骨架可产出 `width:1200px` 容器、`h1{font-size:72px}`、死板 `grid-template-columns`，全部放行 → 横向溢出。
2. **真实内容未被长文本保护**：`renderContent` 把 markdown 渲染结果塞进 `[data-map="body"]`（[content-renderer.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-renderer.ts#L586-L588)），动态列表/分页也追加进容器（[content-renderer.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-renderer.ts#L613-L622)）。骨架 CSS 是按 LLM 玩具占位文案设计的，对真实文章里的长单词/`pre`/`table`/宽图/超长 URL 没有任何 `overflow-wrap`、`img{max-width:100%}`、`pre{overflow-x:auto}` 兜底 → 横向溢出。
3. **`pageSpecific` 渲染路径跳过全部裁剪**（[content-renderer.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\theme\content-renderer.ts#L84-L94)）：页面已是独立片段，合理；但也没有为溢出留二次保险。
4. 非首页 host 加了 `padding-top:var(--nav-h)`（[blog.ts](file:///d:\frontProjects\agent\smart-blog-agent\src\lib\blog.ts#L174-L176)），若骨架自身又预留了间距可能叠加（次要的竖向间距问题）。

---

## 三、修复方案（分文件、分步骤）

### 改动 A：注入「安全兜底样式层」——消除溢出（核心，风险最低）
文件：`src/lib/theme/theme-splitter.ts`

在 `ensureLayoutContract` 里，追加一段**最后一个 `<style>`**（同特异性后写胜出，作用域限定，不干扰导航/页脚），集中保证溢出安全。新增导出常量与注入逻辑：

```css
/* 全局：杜绝页面横向滚动 */
html, body { max-width: 100%; overflow-x: clip; }

/* 正文区基础保护 */
[data-page-host] { box-sizing: border-box; max-width: 100%; }
[data-page-host], [data-page-host] *,
[data-page-host] *::before, [data-page-host] *::after { box-sizing: border-box; }

/* 行内/host 子元素最小宽度修正，避免 flex/grid 子项撑破容器 */
[data-page-host] > *, [data-page-host] .container > *,
[data-page-host] [class*="grid"] > *, [data-page-host] [class*="list"] > * { min-width: 0; max-width: 100%; }

/* 媒体元素不超出容器 */
[data-page-host] img, [data-page-host] video, [data-page-host] iframe,
[data-page-host] canvas, [data-page-host] svg, [data-page-host] table { max-width: 100%; }
[data-page-host] img { height: auto; }
[data-page-host] pre { max-width: 100%; overflow-x: auto; }

/* 长文本/长单词/超长 URL 强制换行，杜绝横向溢出 */
[data-page-host] p, [data-page-host] h1, [data-page-host] h2, [data-page-host] h3,
[data-page-host] h4, [data-page-host] h5, [data-page-host] h6, [data-page-host] li,
[data-page-host] dd, [data-page-host] a, [data-page-host] td, [data-page-host] th {
  overflow-wrap: anywhere; word-break: break-word;
}
[data-page-host] .article-body, [data-page-host] [data-map="body"] { overflow-wrap: anywhere; word-break: break-word; }
```

- 只作用于 `[data-page-host]`（正文区），导航/页脚设计不被破坏。
- 因 `ensureLayoutContract` 在**写入**(`makeSkeletonNode`/`commit`) 和**每次渲染**(`mergeThemePage`)都会调用，因此一部到位覆盖所有使用路径。
- 注入放在 `--nav-h` 兜底 `<style>` 之后，确保位于整个 `<head>` 样式末尾。

### 改动 B：扩展 `normalizeThemeSpacing`——clamp 标题字号与过宽容器
文件：`src/lib/theme/theme-splitter.ts`

- 在 `SPACING_LIMITS` 基础上，新增对 `font-size` 的 clamp（仅命中大容器/标题选择器）：`h1-3` 上限设为 `40/34/28px` 左右（数值可在实现时按设计保守取值），防止巨大字号导致行宽溢出。
- 新增：对 `width`/`min-width` 中 `vw` 或超大 `px`（如 `>1200px`）的硬编码，若目标为正文容器类则 clamp 到 `100%`——此项以「安全层已保证 max-width:100%」为主，避免过度改写骨架设计，因此仅作兜底、不动正常设计。
- 保持"只处理 px、跳过 rem/em/%"的既有策略。

### 改动 C：`CLASS_BRIDGE` 上下文感知——修错乱中的样式丢失
文件：`src/lib/theme/theme-splitter.ts`、`src/agents/theme-graph.ts`

- 把静态 `CLASS_BRIDGE` 改写为：`sanitizePageFragment(rawHtml, layoutClasses?)`，仅当映射**目标类确实存在于骨架类集**时才该段映射；不存在的映射直接丢弃该规则（而不是把页类名改成一个不存在的类名）。
- 所有不需要类集的调用点（如 `page_*` 节点、`validator`）传入骨架类集：`collectThemeClasses(ensureLayoutContract(state.layoutHtml))`。
- 这样页面规约类名在骨架未定义对应目标时**保留原类名**，配合"安全层"不至于彻底丢样，避免"错乱升级为空白"。

### 改动 D：收紧校验 + 提示——减少结构碰撞
文件：`src/agents/theme-agent.ts`（`buildPagePromptContext`）、`src/lib/theme/style-analyzer.ts`

1. `buildPagePromptContext` 的「硬性约束」追加：
   - 正文只允许作为 `data-page-host` 下的**单层结构**，不要自建整份 fixed 宽度容器；不得设置固定 `px` 宽度 / `vw` / 固定高度来抢占全宽。
   - 不得书写 `width/height/min-width/max-width/font-size` 的刚性像素值来覆盖骨架，布局与字号交给骨架设计变量。
2. `style-analyzer` 新增两条**确定性规则**（`checkRigidSizes` / `checkFlexLayout`）：
   - 页面片段出现固定 `px`/`vw` 的 `width`/`min-width` 或固定 `height` 于正文容器类时，写入 `pageIssues`（触发修订）；安全层仍兜底渲染。
   - 骨架/片段缺少 `overflow-wrap|word-break` 且含文本容器时，写 warning。
   - 命中项会经 `buildFeedback` 回流给 revise，配合最大尝试轮数（可在 Api route 把 `maxAttempts` 调到 2）提升修复成功率。

### 改动 E（可选）：暴露 `maxAttempts` 提升一轮
- 检查 `src/app/api/themes/generate`（`route.ts`）与 `generate/route.ts`，把 `maxAttempts` 从默认 1 提到 2，让校验反馈有一次真实重试余地。

---

## 四、假设与决策

- 采用「**机械兜底优先、提示为辅**」策略，不重写骨架/页两阶段自由生成的架构（重构成本高、风险大，且会限制设计自由度）。
- 安全层只作用于 `[data-page-host]` 正文区，避免覆盖导航/页脚等骨架属于作者的主观设计。
- `CLASS_BRIDGE` 的上下文感知是**只增不改**：不影响正常映射，仅在目标类缺失时保留原类名。
- 所有 CSS clamp 只处理 px、跳过 rem/em/%（沿用现有约定），避免误伤相对单位。
- 不新增 DB 字段、不改 API 契约，改动集中在 `lib/theme/*` 与两个生成 agent 的提示/审计逻辑。

## 五、验证

1. **单测**：运行
   - `npm test -- src/lib/theme/theme-splitter`（`normalizeThemeSpacing` 断言新增 font-size/width clamp 生效）
   - `npm test -- src/lib/theme/content-renderer`（安全层不破坏渲染）
   - `npm test -- src/lib/theme/style-analyzer`（新增 rigid-size/media 规则命中输出）
   - `npm test -- src/agents/theme-graph`（`CLASS_BRIDGE` 上下文感知不回归）
2. **回归单测全绿**：`npm test`。
3. **浏览器实测**（`npm run dev` + 生成主题）：
   - 首页 / 列表页 / 详情页缩窄到移动端宽度，确认**无横向滚动条**（`overflow-x` 生效）。
   - 用一篇含长 URL、宽代码块 `<pre>`、大图、长表格的文章打开详情页，确认内容被 `overflow-wrap`/`img{max-width}` 约束、不外溢。
   - 抽查生成主题：不再出现类名被改写后整块白板/错乱的区域。

## 六、改动文件清单
| 文件 | 改动 |
|---|---|
| `src/lib/theme/theme-splitter.ts` | 新增安全样式层注入（`ensureLayoutContract`）、扩展 `normalizeThemeSpacing`、`CLASS_BRIDGE` 上下文感知（`sanitizePageFragment` 增加 layoutClasses 参数） |
| `src/agents/theme-graph.ts` | `page_*` / `validator` 传入骨架类集；可选用参数调大 `maxAttempts` |
| `src/agents/theme-agent.ts` | `buildPagePromptContext` 追加"禁刚性宽度/字号"硬性约束 |
| `src/lib/theme/style-analyzer.ts` | 新增正文章节宽度/换行换行规则（`pageIssues`/`warnings`） |
| `src/app/api/themes/generate` / `generate/route.ts` | （可选）`maxAttempts` 提到 2 |