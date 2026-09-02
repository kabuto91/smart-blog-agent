# 为文章添加阅读量与点赞功能

## 摘要（Summary）
在文章详情页新增两个能力：
1. **阅读量**：每次访问详情页（`GET /blog/[slug]`）时对应文章阅读数 +1。
2. **点赞**：在详情页注入一个点赞按钮，支持可取消切换（已赞再点取消）；用 `localStorage` 记录每个访客对每篇文章的点赞状态。

阅读数与点赞数仅展示在文章详情页。两者都是文章级字段（`readCount` / `likeCount`），写入 `articles` 表。

## 现状分析（Current State Analysis）
- 详情页为**服务端渲染的原始主题 HTML**（非 React 客户端组件），由 [`src/app/blog/[slug]/route.ts`](file:///d:/frontProjects/agent/smart-blog-agent/src/app/blog/[slug]/route.ts) 的 `GET` 处理：
  - `getArticleBySlug(slug)` 取文章并校验 `published`；
  - `renderThemePage("detail", dynamicData, { afterBodyHtml })`（导航分支）或 `renderBlogTheme(dynamicData)`（默认分支）返回 `Response`。
- [`renderThemePage`](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/blog.ts#L174-L236) 支持 `afterBodyHtml` 选项：把注入片段插到 `[data-content="article-body"]` 之后。
- 数据模型：[`prisma/schema.prisma`](file:///d:/frontProjects/agent/smart-blog-agent/prisma/schema.prisma#L114-L131) 的 `Article` 模型当前**没有**阅读量/点赞字段。站点级统计在 `SiteStats`（`totalViews/totalLikes`），与文章级无关。
- API 路由采用 `src/app/api/.../route.ts` 的 Next.js 路由处理器模式（参照 [`src/app/api/articles/[id]/route.ts`](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/articles/[id]/route.ts)）。
- 项目用 Prisma + SQLite，通过 `migrations/*.sql` 管理 schema（参照最新迁移文件格式）；schema 变更后需重新 `prisma generate` 并重启 dev server（见项目记忆）。

## 拟改动（Proposed Changes）

### 1. 数据模型：`prisma/schema.prisma`
在 `Article` 模型新增两个字段：
```prisma
readCount  Int @default(0) @map("read_count")
likeCount  Int @default(0) @map("like_count")
```
- **为什么**：文章级阅读/点赞计数需要持久化字段。
- **怎么做**：编辑 schema 后运行迁移 `npx prisma migrate dev --name add_article_read_and_like_counts`（会自动生成客户端并应用到 `prisma/dev.db`，并在此目录新增 `migrations/<timestamp>_add_article_read_and_like_counts/migration.sql`，内容类似 `ALTER TABLE "articles" ADD COLUMN "read_count" INTEGER NOT NULL DEFAULT 0;`）。迁移完成后**重启 dev server** 以加载新 Prisma client。

### 2. 新增模块：`src/lib/article-stats.ts`
集中放置阅读/赞相关逻辑与详情页注入片段：
- `bumpArticleRead(id: string): Promise<number>` —— 对 `prisma.article.update({ where:{id}, data:{ readCount: { increment: 1 } } })` 返回最新 `readCount`。
- `adjustArticleLike(id: string, action: "like" | "unlike"): Promise<number>` —— 读取当前 `likeCount`，`next = Math.max(0, likeCount + (action==="unlike" ? -1 : 1))`，更新并返回 `next`（避免负数）。可选同步 `SiteStats.totalLikes` 按差值增减。
- `buildArticleStatsBar(opts: { id: string; readCount: number; likeCount: number }): string` —— 返回自包含的 HTML 块（含内联 `<style>`/`<script>`）：
  - 显示「阅读 {readCount}」；
  - 一个点赞 `<button>`（显示「赞 {likeCount}」，含 `data-article-id`）；
  - 内联脚本：从 `localStorage`(`key: sa-like-{id}`) 读取/写入点赞状态，用 `fetch` 调用 `POST /api/articles/{id}/like` 同步到服务端并更新计数，用内联样式切换「已赞」高亮。用 `document.currentScript.parentElement` 定位自身区块，避免污染全局脚本。
- `injectArticleStatsBar(html: string, opts): string`（可选）—— 若路线统一改用 `renderThemePage`，则不需要此项；此处仅作为 `afterBodyHtml` 传入，无需额外 JSDOM 后处理。

### 3. 阅读量自增 + 点赞注入：`src/app/blog/[slug]/route.ts`
在 `GET` 中，确认文章存在且已发布后：
```ts
const readCount = await bumpArticleRead(article.id)
const likeCount = article.likeCount
const dynamicData = { ... /* 现构造逻辑不变 */ }
const statsBar = buildArticleStatsBar({ id: article.id, readCount, likeCount })
const afterBody = nav.length > 0 ? buildCollectionNavHtml(nav) + statsBar : statsBar
const html = await renderThemePage("detail", dynamicData, { afterBodyHtml: afterBody })
if (html === null) { return blogNotConfiguredHtml... }
return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
```
- **为什么**：`renderThemePage` 的 `afterBodyHtml` 天然把统计条插到正文之后，且两种分支（有合集导航/无导航）可统一走此路径。
- **怎么做**：移除默认分支里对 `renderBlogTheme(dynamicData)` 的直接返回，统一改为 `renderThemePage("detail", ...)`。

### 4. 点赞 API：`src/app/api/articles/[id]/like/route.ts`
`POST` 处理：
- 解析 `{ action: "like" | "unlike" }`（缺省视为 `like`）。
- 调用 `adjustArticleLike(id, action)`；文章不存在返回 `404`。
- 返回 JSON：`{ id, likeCount }`。

### 5. 生成客户端 + 重启
- 迁移后 `npx prisma generate`（`migrate dev` 已含）；
- 重启 `npm run dev`，使新 Prisma client 生效。

## 假设与决策（Assumptions & Decisions）
- 阅读量：**每次打开详情页 +1**（含刷新；不做同访客去重）。用户已确认。
- 点赞：**可取消切换**，`localStorage` 记录每访客每文章状态；服务端 `likeCount` 为该交互的净计数（clamp ≥0）。用户已确认。
- 展示位置：**仅文章详情页**（正文后的统计条）。用户已确认；不修改列表卡片、不扩展 `ArticleListItem`/`mapArticle`/主题字段注册表，保持改动最小。
- 阅读量每次页面访问即自增，未做 bot/爬虫过滤（符合原始描述，保持简单）。
- 不引入额外的唯一约束/缓存；点赞走高并发下使用「读-算-写」，与整体项目简单的 SQLite 用法一致。

## 验证（Verification Steps）
1. `npx prisma migrate dev --name add_article_read_and_like_counts` 成功迁移，`articles` 表出现 `read_count`/`like_count` 列。
2. 重启 dev server，`npx tsc --noEmit` / `npm run lint` 通过。
3. 打开一篇已发布文章的详情页，确认正文后出现「阅读 N / 赞 M」统计条。
4. 刷新该详情页，确认「阅读」数字 +1。
5. 点击「赞」：计数 +1、按钮高亮；再次点击：计数 -1、取消高亮；刷新页面后点赞状态保持（读自 localStorage）。
6. 数据库中对应文章 `read_count`/`like_count` 随上述操作而变化。
7. 打开一篇**属于合集**的文章详情页，确认合集进度导航与统计条都正常显示且不冲突。