# 当前主题样式错乱：诊断结论 + 修复计划

## 一、Summary（结论先行）

对激活主题「主题 4 #2」（2026-08-25 生成，layout CSS 21235 字符）做了全链路诊断（DB 数据 → 渲染管线 → 浏览器 computed style），**类名契约完好**（三页与骨架类名重叠率 100%、无禁用标签、布局契约齐全），错乱根因是**渲染注入的安全兜底样式层覆盖了骨架设计系统的限宽容器**：

> `THEME_SAFETY_CSS` 中的 `[data-page-host] > *` 等选择器带 `max-width: 100%`，特异性 0-1-0 且位于 `<head>` 最后一个 `<style>`，**把骨架 `.container--main { max-width: var(--w-main) /* 760px */ }`、`.container--narrow { max-width: 640px }` 等所有单类容器全部覆盖为 100%** → 正文全宽拉满、限宽居中排版失效 → 杂志式版面崩坏（视觉"错乱"）。

这是上一轮「溢出安全兜底」（`.trae/documents/theme-fix-style-quality.md` 改动 A）引入的回归。

## 二、诊断证据（实测）

| 检查项 | 结果 |
|---|---|
| 三页类名与骨架重叠率 | home/list/detail 均 **100%**（无自创类名） |
| 禁用标签（style/script/nav/footer） | 0 |
| 布局契约（data-page-host / --nav-h / viewport / nav+footer） | 齐全 |
| CSS 花括号配平 / @media 完整性 | 178/178 配平，@media 完好（`clampCssSpacing` 未破坏） |
| 渲染后 /blog 结构 | host 9 子节点、动态列表已填充、头像恰好 1 个 |
| **computed `container--main`** | **`max-width: 100%`、width=1037px（视口全宽）**，而骨架定义 `max-width: var(--w-main)` = 760px |
| **computed `.hero.container--narrow`** | **width=1037px 全宽**，而骨架定义 `max-width: var(--w-narrow)` = 640px |
| `:root` 变量 | `--w-main: 760px`、`--w-narrow: 640px` 均已定义（非变量缺失） |

覆盖来源（[theme-splitter.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/theme/theme-splitter.ts#L17-L37)）：

```css
[data-page-host] > *,
[data-page-host] .container > *,
[data-page-host] [class*="grid"] > *,
[data-page-host] [class*="list"] > * { min-width: 0; max-width: 100%; }
```

`[data-page-host] > *` 特异性 (0,1,0) = `.container--main` (0,1,0)，但安全层作为 head 最后一个 `<style>` 注入，**源码顺序靠后者胜** → 限宽全部失效。

### 次生问题（生成质量，非本次主要目标）

- 首页把 `.post-cover`（16:9 渐变封面色块，骨架意图配 `.post-grid--2col` 半宽网格卡）放进全宽 `.post-card`（骨架定义为 `display:block` 列表卡）→ 每卡顶一块巨大纯色矩形。根因 A 修复后 cover 限宽 760px，观感显著缓解；彻底避免可在页面提示词加一句约束（见改动 C，轻量）。
- `section.section.container--main` 上 `.section { padding: 32px 0 }` 与 `.container--main { padding: 0 32px }` 同特异性冲突，`.section` 后定义胜出 → 容器失去左右内边距（LLM 类叠加问题，validator 无法检出；限宽恢复后影响减弱，归入改动 C 顺带约束）。
- CSS 注入截断（MAX_CSS_CHARS=16000 < 实际 21235）：POST CARDS/GRID 段（pos≈10K/11.6K）未截断，仅 @media（pos≈20.4K）被截，页面本就禁写 @media，**影响可忽略，本轮不动**。

## 三、修复方案

### 改动 A（核心）：安全层降特异性 —— 用 `:where()` 包裹容器子项选择器
文件：`src/lib/theme/theme-splitter.ts`（`THEME_SAFETY_CSS`）

- 把 `[data-page-host] > *, [data-page-host] .container > *, [data-page-host] [class*="grid"] > *, [data-page-host] [class*="list"] > *` 整组包进 `:where(...)`，特异性降为 (0,0,0)：
  - 设计系统任何单类规则（`.container--main` 的 max-width、自定义 padding 等）自然胜出；
  - 对无样式元素仍生效（min-width:0 防 flex/grid 子项撑破、max-width:100% 防溢出兜底）。
- `html, body { max-width:100%; overflow-x:clip }` 与 `[data-page-host]` 自身、图片/pre/文本换行等规则**保持原样**（这些不与设计系统冲突，是防溢出主保险）。

### 改动 B（存量修复）：安全层版本化重注入
文件：`src/lib/theme/theme-splitter.ts`（`ensureLayoutContract`）

- 当前幂等检查 `style[data-theme-safety]` 已存在即跳过 → **DB 里的旧版安全层永不升级**。改为：注入前**移除全部现有 `style[data-theme-safety]`**，再注入新版（内容幂等，属性不变）。
- 渲染路径 `mergeThemePage → ensureLayoutContract` 每次请求都执行，因此**存量主题无需重新生成，刷新页面即生效**。

### 改动 C（轻量提示词约束，防复发）
文件：`src/agents/theme-agent.ts`（`buildPagePromptContext` 硬性约束）

- 追加一条：「封面/头图占位类（如 post-cover 等）只能用于网格/多列卡片容器内，全宽列表卡片内不要放 16:9 大幅封面块」+「不要把 section 间距类与 container 容器类叠加在同一元素上（padding 会互相覆盖）」。
  - 仅一句话级别约束，不重构提示词。

## 四、假设与决策

- 不重新生成主题：修复 A+B 后现有主题渲染即恢复正常限宽排版。
- 不调 MAX_CSS_CHARS：截断只影响 @media 段，页面禁写 @media，收益低。
- 不改 `clampCssSpacing` / validator / audit：本次诊断未发现其行为缺陷（花括号配平、类重叠率正常）。
- 不改 DB、不改 API。

## 五、验证

1. `npm test`（重点 `theme-splitter.test.ts`：安全层注入幂等/升级断言；如无相关断言则补一条「重复调用 ensureLayoutContract 不产生重复 style 且旧版被替换」）。
2. `npm run dev`（已在跑）+ 浏览器刷新 `/blog`、`/blog/archive`、任一文章页，用 evaluate 验证：
   - `.container--main` computed `max-width === 760px`、`.hero.container--narrow` `max-width === 640px` 且水平居中；
   - `document.documentElement.scrollWidth <= clientWidth`（无横向滚动）；
   - 截图确认版面恢复杂志式限宽排版。
3. 全量 `npm test` 回归。

## 六、改动文件清单

| 文件 | 改动 |
|---|---|
| `src/lib/theme/theme-splitter.ts` | `THEME_SAFETY_CSS` 容器子项选择器改 `:where()`；`ensureLayoutContract` 安全层改为"先移除旧 `style[data-theme-safety]` 再注入"（版本化升级） |
| `src/agents/theme-agent.ts` | `buildPagePromptContext` 硬性约束追加两条：封面类仅限网格容器、section/container 类不叠加 |
| `src/lib/theme/theme-splitter.test.ts` | （若缺）补安全层升级/幂等断言 |
