# 主题生成 Token 无损优化 + 快速/质量模式开关

## 摘要

主题生成链路（planner → skeleton → 3×page 并行 → validator/audit → judge → revise → commit）单次完整生成约消耗 56k tokens，触发一轮修订几乎翻倍。本次做两件事：

1. **无损优化**：CSS 压缩（minify）后再注入 prompt、按规则边界截断、judge 输入瘦身。不改变任何生成行为与产出质量，预计输入 token 降低 25~35%。
2. **前端模式开关**：生成对话框暴露「质量优先 / 快速生成」切换，快速模式关闭 judge 评审并将修订上限降为 1 轮（后端 `judgeEnabled`/`maxAttempts` 参数已存在，只差透传），相比质量模式省约 40%。

## 现状分析（Token 消耗点）

| 阶段 | 调用 | 单次输入（估） | 单次输出（估） |
|---|---|---|---|
| planner 简报 | 1 | ~1.5k | ~0.3k |
| skeleton 骨架 | 1 | ~4k | ~6k（含全部 CSS） |
| page ×3 并行 | 3 | **~8k/页（CSS 占 4~6k）** | ~3k/页 |
| judge 评审 | 1 | ~10k | ~0.5k |
| 修订轮（0~2） | 3~4/轮 | ~11k/页 | ~3k/页 |

四个主要浪费点：

1. **CSS 重复注入（最大头）**：`buildPagePromptContext`（[theme-agent.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-agent.ts#L288-L342)）把最多 16000 字符**原始格式** CSS（带缩进/注释）注入每个页面 prompt——3 页 3 份，修订一轮再 3 份。且 L301 硬 `slice(0, MAX_CSS_CHARS)` 截断可能截在规则中间。
2. **judge 输入冗余**：`buildJudgeInput`（[theme-graph.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-graph.ts#L530-L567)）注入 12000 字符原始 CSS + 每页 2500 字符带空白 HTML 节选 ×3。
3. **修订轮成本**：每轮修订 ≈ 3 页全量重生成（完整 CSS context + prevHtml + 全页输出），约 +40k tokens；骨架级修订 +60k。`maxAttempts` 默认 2、`judgeEnabled` 默认 true，且未暴露给用户。
4. 输出侧（骨架 CSS + 3 页 HTML）是产出本身，无损优化不动。

## 改动方案

### 任务 1：新增 CSS 压缩与安全截断工具（theme-agent.ts）

在 [theme-agent.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-agent.ts) 导出两个纯函数：

```ts
/** 压缩 CSS：去注释、压空白（保留字符串字面量内容不变）。 */
export function minifyCss(css: string): string

/** 在不超过 maxChars 的前提下截到最后一个完整顶层规则。 */
export function truncateCssRules(css: string, maxChars: number): string
```

`minifyCss` 实现要点（纯正则，无新依赖）：

- 先把 `"..."` / `'...'` 字符串字面量替换为占位符（避免 `content: "a, b"` 内部空白/逗号被压缩破坏内容），压缩后还原。
- 去块注释 `/\/\*[\s\S]*?\*\//g`。
- 压缩连续空白为单空格；压缩 `{ } ; , >` 分隔符两侧空白（**不含 `:`**，避免把后代选择器 `a :hover` 误变伪类 `a:hover`）。

`truncateCssRules` 实现要点：

- 逐字符扫描，用 depth 计数 `{`/`}`，depth 归零后的 `}` 记为安全切点（天然支持 `@media` 嵌套）。
- 累积长度超过 maxChars 时取最近一个安全切点截断；未超直接返回原文。
- `:root` 变量块在骨架 CSS 中通常靠前，自然优先保留。

### 任务 2：buildPagePromptContext 注入压缩后的 CSS（theme-agent.ts）

修改 [buildPagePromptContext](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-agent.ts#L294-L302)：

```ts
const cssFull = minifyCss(styles.join("\n"))
const css = truncateCssRules(cssFull, MAX_CSS_CHARS)
const cssTruncated = cssFull.length > MAX_CSS_CHARS
```

- `MAX_CSS_CHARS = 16000` **保持不变**：minify 后同预算可容纳约 1.5~2 倍的规则量，等效信息量提升，属无损增强。
- 只压缩注入 prompt 的副本；**存储的 `layoutHtml` 保持原样**（不影响后续人工查看/编辑/内容渲染链路）。
- 类名清单、导航链接、硬性约束文本不变。

### 任务 3：judge 输入瘦身（theme-graph.ts）

修改 [buildJudgeInput](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-graph.ts#L530-L567)，从 theme-agent 导入 `minifyCss`/`truncateCssRules`：

- L531：`const css = truncateCssRules(minifyCss(extractCssFromLayout(state.layoutHtml)), 12000)`（原为 `slice(0, 12000)`）。
- 页面节选（L547）与骨架结构节选（L532）：截断前先 `html.replace(/\s+/g, " ")` 压缩空白——同样字符预算装入更多实际内容，语义不变。
- 各上限数值不变（12000 / 1500 / 2500）。

### 任务 4：快速/质量模式开关（API 透传 + 前端 UI）

后端参数已就绪（[theme-graph.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/theme-graph.ts#L83-L93) `judgeEnabled`、`maxAttempts`），只做透传：

**[generate/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/themes/generate/route.ts)**：

- `GenerateRequest` 增加 `fastMode?: boolean`。
- `createThemeGraph` 调用处（L82-91）追加：

```ts
judgeEnabled: !body.fastMode,
maxAttempts: body.fastMode ? 1 : 2,
```

快速模式定义：跳过 judge 评审、修订上限 1 轮（validator/audit 的纯代码校验与首轮修订保留，质量下限仍有保障）。

**[theme-generate-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/theme-generate-dialog.tsx)**：

- 新增 state：`const [fastMode, setFastMode] = useState(false)`。
- UI：在输入区「修改范围」行（L685-706）下方新增一行模式切换，样式与「修改范围」按钮组一致：

```
生成模式：[质量优先] [快速生成]
```

- 「快速生成」按钮 `title="跳过 AI 质量评审、修订最多 1 轮，节省约 40% token，适合快速探索"`；「质量优先」为默认选中。
- `handleSend` 请求体（L160-165）追加 `fastMode`。
- `reset()` **不重置** fastMode（属用户偏好，非会话状态）。

### 任务 5：测试

新增 `src/agents/theme-agent.test.ts`（vitest，与现有 `theme-graph.test.ts` 同目录风格）：

- `minifyCss`：
  - 去除 `/* 注释 */`、压缩缩进/换行；
  - 字符串字面量内容不被破坏（如 `content: "a, b"` 压缩后仍为 `"a, b"`）；
  - `a :hover` 与 `a:hover` 的区分保留（冒号两侧空白不压缩）；
  - `@media` 嵌套块完整。
- `truncateCssRules`：
  - 超限时结尾必为完整规则（以 `}` 结尾且括号配对）；
  - 未超限时原样返回。
- `buildPagePromptContext`：
  - 带缩进 CSS 输入时，产出 context 中的 CSS 体积显著小于原始 CSS（断言 `< 原始长度 × 0.7`）；
  - 类名清单仍完整（含 CSS 中定义的类与 DOM 中的类）；
  - 截断场景（构造超长 CSS）下结尾是完整规则。

`theme-graph.test.ts` / `theme-graph.stream.test.ts` 现有用例应全部保持通过（judge 路径有 mock LLM 覆盖，buildJudgeInput 改动不改变其输入结构，仅内容更紧凑）。

## 不做的事（明确排除）

- 不改修订流程（prevHtml/prevLayout 全量注入、整页重生成）——属"流程优化"，用户已选择仅无损范围。
- 不合并 planner 进 skeleton、不动 `SKELETON_SYSTEM_PROMPT` 正文与 `FIELD_REFERENCE`（字段命名参考影响产出质量）。
- 不 minify 存储的 `layoutHtml` / pages。
- 不引入 CSS 压缩第三方依赖。

## 验证步骤

1. `npx vitest run`：全部测试通过（现有 108+ 用例 + 新增用例）。
2. `npx tsc --noEmit`：类型检查通过。
3. 手工验证（dev server 已在 3000 端口运行）：
   - 打开主题生成对话框 → 选「快速生成」→ 输入需求生成：
     - SSE 阶段列表中**无 judge 阶段**；
     - metrics 中 `reviseCount ≤ 1`；
     - 生成完成后预览正常、「使用此主题」保存正常。
   - 切回「质量优先」再生成一次：judge 阶段出现、质量分正常、无回归。
4. 体积对比（可选）：在测试断言中已覆盖注入体积；如需线上观测，可临时在 `makePageNode` 打日志对比 minify 前后 context 长度，验证后移除。

## 预期收益

- **无损优化**：每次页面 prompt 的 CSS 注入体积降 30~50%；无修订流程含 3 次页面注入 + 1 次 judge 注入，输入 token 总量预计降 25~35%；修订轮同样受益。
- **快速模式**：省 judge（~10.5k）+ 第二轮修订（~40k），相比质量模式单次生成省约 40%。
- 产出质量、存储格式、渲染链路完全不变。
