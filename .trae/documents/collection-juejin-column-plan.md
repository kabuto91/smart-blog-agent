# 合集 ↔ 掘金专栏 同步功能计划

## Summary
让后台「合集管理」与掘金「专栏」打通：
1. 从掘金拉取当前用户的全部专栏，导入为本地合集（或自动绑定到同名本地合集）。
2. 新建本地合集时，可一键推送到掘金创建对应专栏并绑定。
3. 文章发布/更新到掘金时，将其所属合集（已绑定专栏的）同步进该掘金专栏。

实现技术路线（用户已确认）：**HTTP API 直连**；同步时机（用户已确认）：**发布/更新到掘金时**。

## Current State Analysis
- 数据库 `Collection` 只含 `id/name/slug/description/coverImage`，无任何掘金字段；`ArticleCollection` 为多对多（[schema.prisma](file:///d:/frontProjects/agent/smart-blog-agent/prisma/schema.prisma#L143-L165)）。
- 合集 CRUD 走 [collections.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/collections.ts) 与 [/api/collections](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/collections/route.ts)、[/api/collections/[id]](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/collections/[id]/route.ts)；管理页在 [collections/page.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/app/admin/collections/page.tsx)。
- 文章发布：`/api/juejin/publish` 调 `publish.mjs`（**浏览器自动化**）→ 成功后回写 `juejinArticleId`（见 [publish/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/juejin/publish/route.ts)、[publish.mjs](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/juejin-publisher/scripts/publish.mjs)）。
- 掘金 Cookie 已存于 site_config（`getJuejinToken`，[site-config.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/site-config.ts#L130-L168)）。
- 既有逆向范例：`lib/juejin-tags.ts` 直连掘金标签 API；`test.mjs` 用 Cookie 验证登录态。

## Assumptions & Decisions
- 每个本地合集最多绑定 1 个掘金专栏（`juejinColumnId` 存于 Collection）。
- 掘金专栏接口无官方文档，需先**逆向/验证**（用已存 Cookie 抓包）。已逆向确认（2026-09-02）：
  - **拉取我的专栏**：`POST content_api/v1/column/author_center_list`（入参 `page_no/page_size/audit_status`，返回 `data[]`，含 `column.column_id` + `column_version.title/content/cover`）→ 纯 HTTP 可做。
  - **把文章加入专栏**：无独立 HTTP 接口；掘金只在**发布/更新文章时**通过 `content_api/v1/article/publish` 的 `column_ids[]` 参数完成。→ 采用「发布时传入 column_ids」（用户已确认）。
  - **新建专栏**：HTTP 端点未抓通 → 改用**浏览器自动化**（新增 create-column.mjs，与发布流程一致）（用户已确认）。
- 文章→专栏同步 = 发布/更新文章时，在 publish.mjs 的发布弹窗里选择对应专栏（走 publish API 的 column_ids）。
- 每个掘金文章最多 3 个专栏；本地文章所属「已绑定专栏的合集」数量 >3 时只同步前 3 个，并在日志提示。
- 导入策略：本地已存在同名合集 → 绑定其 `juejinColumnId`；否则新建本地合集并绑定。
- 移除专栏（取消收取）不在本期范围；本期只做「拉取、推送新建、发布同步加入」。

## Proposed Changes

### A. 逆向与验证掘金专栏接口（✅ 已完成 2026-09-02）
抓包确认：
- **列表我的专栏**：`POST content_api/v1/column/author_center_list`，入参 `{ audit_status, page_no, page_size }`，返回 `data[]`：`column.column_id/user_id/status/ctime` + `column_version.title/content/cover`。
- **新建专栏**：HTTP 端点未抓通 → 确定改**浏览器自动化**（candidate 端点 `content_api/v1/column/create` 等均返回「请求路径不存在」）。
- **把文章加入专栏**：无独立 HTTP 接口，通过 `content_api/v1/article/publish` 的 `column_ids[]` 完成。
- 已有探针脚本 `probe-columns.mjs`、`probe-create-column.mjs`（临时，可后续清理）。

### B. 数据库：Collection 增加掘金专栏绑定
1. 在 `prisma/schema.prisma` 的 `Collection` 增加 `juejinColumnId String? @map("juejin_column_id")`。
2. 生成并执行迁移（`prisma migrate dev --name add_juejin_column_id` 或项目既有的 `scripts/apply-migration.mjs` 流程）。
3. 重启 dev server 以加载新 Prisma client（memory 经验）。

### C. lib/juejin-columns.ts（HTTP 直连封装）
1. `fetchOwnColumns(cookie): Promise<JuejinColumn[]>`——分页拉取本人全部专栏，返回 `{ columnId, title, abstract, status }`（复用 A 确认的端点/入参）。
2. 统一 COMMON_HEADERS 风格（同 `juejin-tags.ts`），处理 `err_no !== 0` 抛错。
（新建专栏 / 加文章进专栏不做 HTTP lib；前者走浏览器自动化脚本，后者在 publish 弹窗完成。）

### D. 集合库与 API：绑定 & 导入 & 推送
1. `lib/collections.ts`：
   - `CollectionListItem`/`CollectionDetail` 增加 `juejinColumnId: string | null`。
   - 新增 `bindCollectionJuejinColumn(id, juejinColumnId)`（findFirst+update，避唯一约束）。
   - 新增 `findCollectionByJuejinColumnId(columnId)`。
2. 路由：
   - `src/app/api/juejin/columns/route.ts`：
     - `GET`：`fetchOwnColumns` 列表（下拉绑定用）。
     - `POST`：新建掘金专栏（浏览器自动化 `create-column.mjs`）+ 绑定到给定本地合集 id（body `{ collectionId, name, abstract }`）。
   - `src/app/api/juejin/columns/import/route.ts`（`POST`）：`fetchOwnColumns` → 对每个专栏按「同名本地合集存在则 bound，否则新建」处理，返回导入/绑定统计。
3. 新增 `src/agents/juejin-publisher/scripts/create-column.mjs`（浏览器自动化：打开专栏管理 → 新建专栏 → 填名称/简介 → 确定 → 从 create 接口响应取 column_id 输出）。

### E. 发布流程同步专栏
1. `publish.mjs`：新增 `--column-names` 参数；在发布设置弹窗里，当传入专栏名称时，搜索并选择对应专栏（走 publish API 的 column_ids）。best-effort：选择失败不阻断发布，仅记录日志。
2. `src/app/api/juejin/publish/route.ts`：发布前查文章所属合集中有 `juejinColumnId` 的（`getCollectionsForArticle`），取前 3 个 → 用 `fetchOwnColumns` 把 columnId 映射为标题 → 传入 `--column-names`。更新流程同样适用（覆盖绑定）。
3. 同步结果并入响应 `message`（如「已加入专栏：A、B」或不满足时提示原因）。

### F. 合集管理页 UI（collections/page.tsx）
1. 顶部新增「从掘金导入」，调用 `POST /api/juejin/columns/import`，成功后在列表刷新并提示导入/绑定数量。
2. 合集行展示已绑定专栏徽标（`juejinColumnId` 非空时显示「已同步掘金专栏」，点击可在弹窗查看/绑定/解绑）。
3. 新建/编辑合集弹窗：新建合集时加「推送到掘金专栏」勾选，保存后调用 `POST /api/juejin/columns` 创建并绑定，成功后回写徽标。
4. 未配置 Cookie 时禁用相关按钮并提示先到「个人管理」配置。

## Verification
1. `npx tsc --noEmit` 通过、`npx eslint` 无新增错误（沿用项目约定）。
2. 手动验证（需已配置掘金 Cookie + 至少一个已发布掘金文章）：
   - 「从掘金导入」能列出并导入/绑定本人专栏到合集列表。
   - 新建合集勾选推送后，掘金创作者中心出现该专栏，列表徽标正确。
   - 发布/更新一篇属于已绑定专栏合集的文章：掘金文章页文末出现该专栏入口；>3 个专栏时只同步前 3 个。
3. 未绑定专栏的合集文章发布时，行为与现状完全一致（无专栏同步）。