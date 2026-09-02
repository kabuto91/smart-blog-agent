# 掘金发布：ID 维护与更新逻辑改造计划

## Summary

为「发布到掘金」功能增加**掘金文章 ID 维护**能力：发布成功后把掘金文章 ID 存回本地文章；下次发布时先校验该 ID 在掘金是否仍存在——存在则进入**更新（编辑）流程**，不存在则回退**新增流程**。后台文章编辑弹窗同步展示掘金绑定状态，并提供「强制新增」与「解除绑定」管理入口。更新时标题、正文、分类、标签全部同步。

## Current State Analysis

- **数据模型** [schema.prisma](file:///d:/frontProjects/agent/smart-blog-agent/prisma/schema.prisma#L114-L130)：`Article` 已新增 `juejinArticleId String? @map("juejin_article_id")`，迁移 `20260901000000_add_juejin_article_id` 已建、Prisma client 已重新生成（本步已完成）。
- **发布脚本** [publish.mjs](file:///d:/frontProjects/agent/smart-blog-agent/src/agents/juejin-publisher/scripts/publish.mjs)：仅支持新增流程（`EDITOR_URL = /editor/drafts/new`）。发布后跳转 `/published`（从页面提取 `/post/<id>` 链接）、`/post/<id>`、`/spost/<id>`，但结果 JSON 未输出文章 ID。已有 `--dry-run`、`--cookie`、`--category`、`--tags` 参数。编辑器交互逻辑（CodeMirror 点击 + 剪贴板粘贴）已验证稳定。
- **后台路由** [route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/juejin/publish/route.ts)：读取文章 → 落临时 md → spawn 脚本 → 解析 JSON 返回。**不维护 ID**，无 forceNew/unbind 能力。
- **数据层** [articles.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/articles.ts)：`ArticleListItem`/`ArticleInput` 类型、`createArticle`/`updateArticle`/`getArticleById` 等。
- **后台 UI** [article-editor-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/article-editor-dialog.tsx)：已有「发布到掘金」按钮与结果展示区。
- **掘金机制**（已通过公开资料确认）：已发布文章 `post id`（`/post/<id>`）与草稿 `draft_id`（`/editor/drafts/<draft_id>`）关联；接口 `POST https://api.juejin.cn/content_api/v1/article/detail` 传 `{"article_id": "<post id>"}` 可查文章详情并取 `draft_id`；编辑已发布文章经草稿箱，更新后重新发布再次进入审核。

## Proposed Changes

### 1. 数据模型：Article 增加掘金文章 ID 字段

**文件**：`prisma/schema.prisma`

```prisma
model Article {
  // ... 现有字段
  juejinArticleId String? @map("juejin_article_id")
}
```

**迁移**：在 `prisma/migrations/` 下新建 `20260901000000_add_juejin_article_id/migration.sql`：

```sql
ALTER TABLE "articles" ADD COLUMN "juejin_article_id" TEXT;
```

随后重新生成 Prisma client（`npx prisma generate`），并**重启 dev server** 使新 client 生效。

### 2. 数据层：类型与 CRUD 支持 juejinArticleId

**文件**：`src/lib/articles.ts`

- `ArticleListItem` 增加 `juejinArticleId: string | null`。
- `ArticleInput` 增加可选 `juejinArticleId?: string | null`。
- `createArticle` / `updateArticle` 透传该字段。
- 新增 `updateJuejinArticleId(id: string, juejinArticleId: string | null)` 辅助函数（用 findFirst+update，避免 Prisma upsert 唯一约束问题——沿用项目既有约定）。

### 3. 发布脚本：支持更新流程 + 输出文章 ID

**文件**：`src/agents/juejin-publisher/scripts/publish.mjs`

新增参数：
- `--article-id <id>`：本地维护的掘金 post id。**存在时走更新流程；不存在（或为 0/空）走新增流程**。
- `--force-new`：即使提供 `--article-id` 也强制新增。
- 新增 `--api-detail` 探测函数：用 Cookie 请求 `POST https://api.juejin.cn/content_api/v1/article/detail`，body `{"article_id": id}`，判断 `err_no === 0` 且 `data.draft_id` 存在 → 文章存在，返回 `draft_id`；否则视为不存在（可能是 404/已删除）。

**流程改造**（`main()` 内）：

1. 解析参数。若 `args.forceNew` 或未传 `--article-id` → **新增流程**（现状逻辑）。
2. 否则调用 API 探测该 post id 是否存在：
   - **存在**：取 `draft_id`，把 `EDITOR_URL` 替换为 `https://juejin.cn/editor/drafts/<draft_id>`（编辑已有文章）。复用现有「填标题 → 点编辑器 → 粘贴正文 → 点发布 → 选分类 → 加标签 → 确定并发布」逻辑（更新后跳转结果走 `/published` 或 `/post`）。注意更新时编辑器会预填旧内容，正文粘贴前需**全选清空**（`Control+A` 后 `Delete`，仅对正文编辑器执行）。
   - **不存在**：打印提示「本地记录的掘金文章不存在，自动走新增发布」，回退新增流程。
3. 发布成功后统一从结果 URL（`/post/<id>`、`/spost/<id>`）正则提取 post id；若只有 `/published` 列表页则从列表链接提取（现有逻辑已具备，补上 `postId` 输出字段）。结果 JSON 增加 `postId` 字段。

> 说明：更新已发布文章会再次进入审核（掘金平台机制），脚本结果 status 保持 `auditing`/`published` 语义不变。

### 4. 后台路由：维护 ID + forceNew + unbind

**文件**：`src/app/api/juejin/publish/route.ts`

- 请求体扩展：`{ articleId, category?, tags?, forceNew?, unbind? }`。
- 发布前：从文章读 `juejinArticleId`，若非空且非 `forceNew`，则 `scriptArgs.push("--article-id", juejinArticleId)`；`forceNew` 时 push `--force-new`。
- 发布后：解析结果 JSON，若含 `postId`，调用 `updateJuejinArticleId(articleId, postId)` 回写数据库；若 `unbind` 为真，调用 `updateJuejinArticleId(articleId, null)`（解除绑定，配合单独接口）。
- 返回结果增加 `juejinArticleId`（回写后的值）。

**新接口**：`src/app/api/juejin/unbind/route.ts`（POST）

- body `{ articleId }` → 调用 `updateJuejinArticleId(articleId, null)`，返回 `{ success: true }`。
- 供「解除绑定」按钮使用。

### 5. 后台 UI：展示绑定状态 + 管理入口

**文件**：`src/components/admin/article-editor-dialog.tsx`

- `ArticleListItem` 现含 `juejinArticleId`，弹窗在「发布到掘金」按钮旁新增状态展示：
  - 已绑定：显示「已发布到掘金」+ 掘金文章链接（`https://juejin.cn/post/<id>`，可点击）与 ID 文本。
  - 未绑定：显示「尚未发布到掘金」。
- 新增两个操作按钮：
  - **强制新增**（仅已绑定时显示）：调用 `/api/juejin/publish` 时带 `forceNew: true`，文案确认后执行，发布成功后回写新 ID（覆盖旧绑定）。
  - **解除绑定**（仅已绑定时显示）：调用 `/api/juejin/unbind`，成功后本地状态清空。
- 结果展示区沿用现有 `publishResult` 结构，补充显示返回的掘金链接与 ID。

### 6. Skill 文档

**文件**：`src/agents/juejin-publisher/SKILL.md`

- 补充 `--article-id`、`--force-new` 参数说明。
- 说明「已绑定文章会自动走更新；文章不存在自动回退新增；支持强制新增」。

## Assumptions & Decisions

- **ID 语义**：本地维护的是掘金 `post id`（`/post/<id>`），不是 `draft_id`。更新时经 API 查 `draft_id` 后进草稿编辑器。
- **存在性判定**：以掘金 `article/detail` 接口 `err_no===0` 且返回有效 `draft_id` 为准；接口异常（网络/鉴权失败）时保守处理为「文章存在但探测失败」并报错，避免误新增重复文章。
- **更新后审核**：掘金对已发布文章更新会再次审核，属平台行为，脚本结果如实反映（auditing）。
- **正文清空**：更新时编辑器预填旧内容，脚本先全选删除正文再粘贴新内容。
- **强制新增语义**：发布成功后新 post id **覆盖**旧绑定。

## Verification

1. `npx prisma generate` 成功；`npx tsc --noEmit` 无类型错误；`node --check` 校验 `publish.mjs`。
2. **新增流程回归**：对未绑定文章跑 `--dry-run` 与真实发布，确认仍走新增且回写 post id。
3. **更新流程（dry-run）**：对已绑定文章执行 dry-run，确认打开的是 `/editor/drafts/<draft_id>` 且标题/正文/分类/标签被更新填充，停在发布弹窗。
4. **更新流程（真实）**：确认跳转 `/published`/`/post/<id>` 且 post id 不变。
5. **不存在回退**：手动把 `juejinArticleId` 改成无效 id 后真实发布，确认自动回退新增并回写新 id。
6. **后台 UI**：绑定状态显示、强制新增、解除绑定三个入口按预期工作。
7. `npm test` 全量回归通过。
