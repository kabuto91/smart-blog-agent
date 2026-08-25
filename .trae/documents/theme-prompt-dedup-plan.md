# 主题生成提示词精简计划（去冗余 + 减 Token 开销）

## 一、Summary（结论先行）

`theme-agent.ts` 集中了主题生成的全部提示词。经梳理，存在两类问题：

1. **内容冗余**：作者头像标记/规则在骨架与各页面提示里逐字重复 6 处、图片规则重复 2 处、首页与列表页的「数据绑定规则」几乎雷同、字段引用与内容标记规则在骨架/页面两阶段重复、`buildPagePromptContext` 里类名清单与完整 CSS 信息重叠。此外，提示词反复要求"放头像"，但运行时 `content-renderer.ts` 已做自动注入 + 全局去重，提示此部分可放心精简。
2. **结构性臃肿**：3 个页面并行各自注入最多 **16K 字符的同一份 CSS**，单次生成最多 ~48K 重复 CSS token。整个页面提示里还复述了大量固定规则。

**重要约束**：完整 CSS 注入是上一份样式质量修复文档（`theme-fix-style-quality.md`）**故意为之**——页面必须看到真实 CSS 才能避免错乱（类名不可见→样式叠加冲突）。故**本计划不删除 CSS 注入**，只做不影响安全的去重与固定开销压缩。

重构以「共享常量/helper + 复用单次 JSDOM」为主，纯内部改动，不改 API/DB 契约、不改 CSS 注入逻辑。

---

## 二、当前状态分析（证据）

所有行号基于当前文件。核心文件：

- `src/agents/theme-agent.ts` — 提示词全部集中于此
- `src/agents/theme-graph.ts` — 图编排，消费上述提示词
- `src/lib/theme/content-renderer.ts` — 渲染期头像自动注入/去重
- `src/lib/field-registry.ts` — `FIELD_REFERENCE` 数据源

### 2.1 头像标记/规则重复 6 处（`theme-agent.ts`）
同一 HTML `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">` 逐字出现于：
- L59 骨架导航品牌区说明
- L67 骨架图片规则例外
- L99 首页 bodyPrompt
- L126 详情页 bodyPrompt
- L139 详情页 imageRule
- L142 其它页 imageRule

且这些说明与运行时逻辑**重复且冲突**：
- `ensureMultipleAvatarPlaces`（`content-renderer.ts#L269`）：正文无头像时自动注入。
- `ensureSingleAuthorAvatar`（`content-renderer.ts#L352`）：全局只保留 1 个。
- 已由 `content-renderer.test.ts`（L440-505 区域）覆盖。
- judge 提示（`theme-graph.ts#L506-512`）更明确"头像全站只允许 1 个"，重复出现拉低评分。

### 2.2 图片规则重复
"不要使用任何图片素材……纯 CSS 视觉手段" 近同文案出现于骨架提示（L65-67）与页面提示（L140-142）。

### 2.3 数据绑定规则雷同
首页（L92-96）与列表页（L105-108）都在描述 `dynamic-articles` + 单模板项 + `data-map=title/excerpt/date/category/link`。

### 2.4 内容标记规则 / 字段引用重复
祖先级骨架（L69-73）与页面（L154-159）各讲一遍 `data-content / data-content-type` + `FIELD_REFERENCE`；页面里 `bodyPrompt`（title/excerpt/date/category/link）与 `FIELD_REFERENCE` 又重叠。
另外 `buildPagePromptContext` 硬性约束（L206-212：只输出 body、不用 nav/footer、禁 style/script）与页面内容标记规则（L155）后半段重复。

### 2.5 结构性：CSS 注入与类名清单双份 + 每次新建 JSDOM
- `buildPagePromptContext`（L167-214）注入完整 CSS（≤16K）+ 从**同一 CSS 派生**的类名清单 + 导航链接。
- CSS 未截断时，类名清单可由 CSS 完全推导 → 双份信息（按安全考虑保留 CSS，清单仅用于防截断兜底，可保留但标注其兜底属性）。
- `buildPagePromptContext` 内部先建一次 JSDOM 取 styles/navLinks，`getManifestClasses`（L217）又建一次 JSDOM —— 单次调用解析两遍 DOM。每次 page 节点（含修订重跑）都重复此开销。

### 2.6 未发现的测试耦合
grep 确认：没有任何测试断言 `SKELETON_SYSTEM_PROMPT` / `buildPageSystemPrompt` 的精确字符串，重构这些常量/提示模板不会破坏既有测试。

---

## 三、改动方案（分文件、分步骤）

纯重构，均为内部常量提取与单次解析复用，**不改变最终下发给 LLM 的实际语义**（语义保持：无图片、头像渲染期兜底、字段命名、禁 rigid 尺寸）。

### 改动 A：抽作者头像常量与说明 helper
文件：`src/agents/theme-agent.ts`

- 新增导出常量：
```ts
/** 作者头像占位。src 留空，渲染时自动填充；渲染期会自动注入/去重，全局仅保留一个。 */
export const AVATAR_PLACEHOLDER =
  `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">`
```
- 新增 `avatarRemark(pageType?: ThemePageType)` 或按需组合，统一产出"头像占位 + 不要标记 data-page-type"这一句说明，替换 6 处重复副本。
- 精简说明文案：因渲染期自动注入/去重，页面提示不再要求"每页多个/多个区块"重复强调，改为一句"正文如需展示作者信息，可放一个作者头像占位（渲染期会确保全局只有 1 个）"。

### 改动 B：抽共享图片规则常量
文件：`src/agents/theme-agent.ts`

- 新增 `IMAGE_RULE`（"无图片素材，纯 CSS 视觉手段；唯一例外是作者头像占位"），骨架与页面阶段共用。
- 详情页的差异（正文无需封面、配图随 `data-map="body"` 自动渲染）保留为详情页专属说明，但复用 `AVATAR_PLACEHOLDER` 且不再复述通用图片规则全文。

### 改动 C：抽共享「动态列表绑定规则」片段 + 统一「内容标记规则」
文件：`src/agents/theme-agent.ts`

- 新增 `DYNAMIC_ARTICLES_RULE`：`dynamic-articles` 包裹 + 单模板项 + `data-map=title/excerpt/date/category/link`。
- 首页（home）与列表页（list）的 bodyPrompt 各自引用该片段，去掉二者重复正文。
- 将 `buildPageSystemPrompt` 末尾的「内容标记规则 + FIELD_REFERENCE + 示例」与 `buildPagePromptContext` 的「硬性约束」做职责划分：把 `FIELD_REFERENCE` 与示例只保留在 page 系统提示内；`buildPagePromptContext` 保留"只输出 body / 禁 style/script/nav/footer / 类名清单优先 / 禁 rigid 尺寸"这些**上下文专属**硬约束，删除与内容标记规则重复的措辞。

### 改动 D：`buildPagePromptContext` / `getManifestClasses` 复用单次 JSDOM
文件：`src/agents/theme-agent.ts`

- 让 `getManifestClasses` 接受可选的已解析 `Document`，`buildPagePromptContext` 用一次 `new JSDOM(skeletonHtml)` 解析，同时取 styles、navLinks、classManifest，避免每调用解析两遍（页面节点与修订重跑都会受益）。
- 类名清单仍保留（防 CSS 截断时缺失），但在 `manifestText` 的引导语里明确其兜底属性："当 CSS 被截断时以上类名清单为完整依据"。CSS 未截断时不重复大段说明。

### 改动 E（可选，标注为"不执行"的保守说明）
- **不删除**完整 CSS 注入（保安全，防止页面错乱）。
- planner 产出的 `image` 字段与"禁图"规则存在历史不一致（`theme-graph.ts#L236` 仍输出 image 字段），本轮**不改**，仅记录备查，避免扩大范围。

---

## 四、假设与决策

- **不改变下发给 LLM 的语义**：所有去重都是把"相同的一段话说一次"，不删存在行为的规则，避免引入新的错乱/风格回归。
- **CSS 注入保留**：按 `theme-fix-style-quality.md` 的历史原因，完整 CSS 是页面避免错乱的必要输入，不做删减，仅去除与其冗余重复的类名清单引导语。
- **头像依赖渲染期兜底**：`content-renderer` 已保证自动注入 + 全局去重，故提示词不再反复教"在哪放、放几次"，只保留"正文如需展示作者信息可放一个占位"。
- 纯内部重构，不改 API/DB/路由，不新增数据库字段。
- 不改 `theme-graph.ts` 的节点/状态/Send 语义（R5 中"类名清单经 state 复用"本轮**不做**，以免触碰多节点状态传递，收益低且风险高；仅在 D 中做单进程内的 JSDOM 复用）。

## 五、验证

1. **单测全绿**：`npm test`。
   - 重点跑 `src/lib/theme/content-renderer.test.ts`（头像渲染兜底不受干净）与 `src/agents/theme-graph.test.ts` / `theme-graph.stream.test.ts`（图编排不回归，确认 `extractHtmlFromContent` 等导出签名未变）。
2. **输出抽样**：临时打印一次 `buildPageSystemPrompt` 与 `SKELETON_SYSTEM_PROMPT`，肉眼确认：
   - 骨架与三页提示中不再出现重复的头像/图片/字段/数据绑定长段落。
   - 语义要点（禁图、字段名 `blog-title`/`author-avatar` 等、`data-page-host` 单层结构、禁 rigid 尺寸）仍保留。
3. **端到端冒烟**：`npm run dev` 生成一次主题，确认三页渲染正常（类名仍在、头像不重复、无样式回归）。

## 六、改动文件清单
| 文件 | 改动 |
|---|---|
| `src/agents/theme-agent.ts` | 抽 `AVATAR_PLACEHOLDER` / 头像说明 helper / `IMAGE_RULE` / `DYNAMIC_ARTICLES_RULE`；统一内容标记规则职责；`buildPagePromptContext` 与 `getManifestClasses` 复用单次 JSDOM；去重 6 处头像、2 处图片、home/list 数据绑定、骨架/页面内容标记规则 |