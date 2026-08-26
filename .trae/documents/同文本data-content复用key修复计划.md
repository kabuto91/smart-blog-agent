# 同文本 data-content 复用同一 key 修复计划

## 一、Summary（结论先行）

生成主题时常出现 `blog-title-2`、`section-title-2` 这类 `data-content`，每个后缀 key 都会变成 `contentConfig` 里一个**独立 text 字段**，导致后台「多维护一个参数」。

根因：`content-extractor.ts` 里两处「去重」逻辑只按 **key 是否已占用** 来决定追加 `-N`，**不判断文本是否相同**。于是主页 hero、列表页标题、详情页标题这些**同一段文本**（如站名）因共用 `.blog-title` 类被拆成多个独立参数。

修复方向（用户已确认）：**当重复 key 对应元素的文本完全一致时，复用同一个 key**（渲染时对所有同 key 元素统一赋值），不再生成 `-N`；仅当文本确实不同才拆分（保留现有行为与测试）。

渲染端已天然支持“同 key 多元素整体同步”（`renderTextField` 用 `querySelectorAll("[data-content=key]")` 对全部匹配元素赋值），故复用 key 安全。

## 二、当前状态分析（证据）

核心文件与位置：

- `src/lib/theme/content-extractor.ts`
  - `markUnmarkedTextUnits`（L173-197）：对漏标 h1-h6/p 自动补 `data-content`。key 取元素第一个类名（`.blog-title` → `blog-title`），无类用标签名；再用 `uniqueKey(base, used)`（L161-166）对已占用 key 追加 `-N`。
  - `extractContentConfig` 主循环（L120-147）：遍历所有 `[data-content]`，`uniqueKey(key, usedKeys)`（L131）再次去重，会**把 mark 阶段已复用的同 key 元素再次拆成 `-N`**，并生成 `config[unique]`。
- `src/lib/theme/content-renderer.ts`
  - `renderTextField`（L596-634）：同 key 多元素全部统一赋值 → 复用 key 的支撑。
  - `augmentGlobalFields`（L566-583）：仅对注册的全局字段（blog-title/author-avatar 等）做 `-N` 继承主 key 值——印证历史已默认“派生 key 主要是噪音”，但只覆盖白名单字段。
- 现有测试 `content-extractor.test.ts`（L218-223）：`.post-title` 元素文本 A / B（不同）→ `post-title` / `post-title-2`，此行为须保留。

触发链路：主题生成时 3 个页面与骨架共享 `.blog-title/.section-title/.post-title` 类，且文本相同，兜底标记把每处都按独立 key 收录 → 产生 `-N` 后缀参数。

## 三、改动方案（分文件、分步骤）

### 改动 A：`markUnmarkedTextUnits` 支持“同文本复用 key”
文件：`src/lib/theme/content-extractor.ts`

- 新增一个由「已标记 key → 元素文本与类型」的映射（遍历 `[data-content]` 建立），用于比较文本。
- 对每个待补标元素：
  - 计算 `base`（逻辑不变）；
  - 若 `base` 已存在且对应元素 `data-content-type="text"` 且**文本 trimmed 完全相同** → 直接复用 `base`（`used.add(base)` 已天然幂等），不调 `uniqueKey`；
  - 否则走原 `uniqueKey(base, used)` 分配（含 `-N`）。
  - 每处理完一个元素，把 `key → 该元素文本/type` 更新进映射，保证第 3 个同文本元素也复用同一 key。
- 仅对 `type === "text"` 复用；非 text（nav-list/dynamic）保持原逻辑，避免改变导航/动态区语义。

### 改动 B：`extractContentConfig` 主循环避免“二次拆键”
文件：`src/lib/theme/content-extractor.ts`（L120-147）

- 新增 `primaryByKey: Map<string, Element>`：记录每个原始 key 的“首个已处理元素”。
- 处理每个 `[data-content]` 元素时：
  - 若 `type === "text"` 且原 key 已在 `primaryByKey` 中、且两者文本 trimmed 相同 → 复用原 key（**不**走 `uniqueKey`，不重命名元素，不重复新增字段），`config[key]` 用相同文本覆盖（同值无害）；
  - 否则维持现有 `uniqueKey` 行为（含对元素的 `setAttribute` 改名与 `config[unique]` 生成）。
- `primaryByKey` 只在原 key 首次出现时写入，保证“同 key 文本不同仍拆 `-N`”。

> 作用：改动 A 在 mark 阶段把同文本元素设为同 key 后，主循环不再把它们二次拆成 `-N`，config 中只保留一个字段。

### 改动 C：补充/回归测试
文件：`src/lib/theme/content-extractor.test.ts`（`describe("extractContentConfig ...")` 内新增用例）

1. **同文本复用**：`<div><h1 data-content="blog-title" data-content-type="text">我的博客</h1></div><h2 class="blog-title">我的博客</h2>` → `contentConfig` 只含 `blog-title`（无 `blog-title-2`），`blog-title` 值为“我的博客”，HTML 中两处均为 `data-content="blog-title"`。
2. **同文本全自动补标去重**：两个无手标 `<h3 class="section-title">章节</h3>`（文本相同）→ 只产生一个 `section-title`。
3. **文本不同仍拆分**：沿用现有 L218 用例（A/B → `post-title` / `post-title-2`），确保不回归。
4. **非 text 仍拆键保护**：两个相同 key 的 nav-list / dynamic 容器仍按原逻辑生成 `-N`（防语义回归）。

## 四、假设与决策

- 渲染端 `renderTextField` 对同 key 多元素统一赋值，**复用 key 不会导致内容丢失**，且能让“同为站名”的多处标题随单一字段整体更新。
- 仅 `text` 类型参与同文本复用；nav/dynamic 仍按 key 严格去重，避免误合并非同构容器。
- 复用判定基于 `textContent` 去空格后逐字符相等；仅 1 个字段、值取同文本，覆盖顺序无害。
- `augmentGlobalFields` 的 `-N` 全局字段继承保留不动（作为真实不同文本场景的兜底，不属本计划范围）。
- 不改 API/DB/路由、不改提示词、不新增存储字段。

## 五、验证

1. 单测：`npm test`（重点 `src/lib/theme/content-extractor.test.ts`；旧用例 L218-223 必须仍绿）。
2. 抽查断言：
   - 同文本重复 → 无 `-N`，config 唯一字段，HTML 多处同 key；
   - 异文本重复 → 仍 `-N`；
   - 非 text 重复 → 仍 `-N`。
3. 端到端冒烟：`npm run dev` 生成一次主题，确认后台配置里不再出现成堆的 `blog-title-2`，且多页标题仍统一由站名参数控制。

## 六、改动文件清单

| 文件 | 改动 |
|---|---|
| `src/lib/theme/content-extractor.ts` | `markUnmarkedTextUnits` 同文本复用 key；主循环对 text 同文本不二次拆键 |
| `src/lib/theme/content-extractor.test.ts` | 新增同文本复用 / 全自动补标去重 / 非 text 拆键保护用例，守住异文本拆键既有用例 |