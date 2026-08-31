# 合集（Collection）功能实现计划 — 类似掘金

## 一、概述

为博客新增"合集"功能（类似掘金的合集/系列）：文章可按自定义顺序归入多个合集；后台可管理合集与合集内文章排序；前台新增合集列表页、合集详情页，并在文章详情页展示合集进度导航（第 N 篇 / 共 M 篇 + 上一篇/下一篇）。

**已确认的关键决策：**
- 数据模型：**多对多**（一篇文章可加入多个合集，合集内文章带 `position` 排序字段）
- 功能范围：**全部**（合集管理、文章编辑接入、前台合集页、详情页合集导航）
- 前台渲染：**固定内置样式**（不新增主题字段类型，不依赖主题自定义）

## 二、现状分析

- 数据层：[prisma/schema.prisma](file:///d:/frontProjects/agent/smart-blog-agent/prisma/schema.prisma#L94-L139) 已有 `Category`（一对多，`Article.categoryId`）与 `Tag`/`ArticleTag`（多对多）。合集将仿照 `ArticleTag` 的多对多 + `position` 排序。
- 文章数据访问：[src/lib/articles.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/articles.ts) 提供 `createArticle/updateArticle/getArticles*`，内部 `mapArticle` 与 `ARTICLE_INCLUDE` 为模块私有。
- 管理后台：
  - [article-editor-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/article-editor-dialog.tsx#L331-L460) 已有"分类下拉"与"标签 chips + 新建"交互，合集多选可复用该模式。
  - [meta-manager-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/meta-manager-dialog.tsx) 是分类/标签管理对话框；合集含简介/封面/排序，需独立页面更合适。
  - [admin/articles/page.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/app/admin/articles/page.tsx#L43-L65) 通过 `fetch("/api/categories")`、`fetch("/api/tags")` 并行加载元数据后传给编辑器。
- 前台渲染：[src/lib/blog.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/blog.ts#L153-L204) `renderBlogTheme(dynamicData)` 依据 `resolvePageType`（home/list/detail）选主题页并渲染，返回 `Response`；[blog/category/[slug]/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/blog/category/[slug]/route.ts) 是"列表页 + 过滤文章 + pagination"的现成范式，合集详情页可完全复用。
- 文章详情路由：[blog/[slug]/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/blog/[slug]/route.ts) 渲染 `articles: [toArticleDetailData(article)]`（detail 类型）。

## 三、改动方案

### 1. 数据模型 — `prisma/schema.prisma`

新增两个模型，并在 `Article` 中补充关系：

```prisma
model Collection {
  id          String               @id @default(uuid())
  name        String               @unique
  slug        String               @unique
  description String?
  coverImage  String?              @map("cover_image")
  articles    ArticleCollection[]
  createdAt   DateTime             @default(now()) @map("created_at")
  updatedAt   DateTime             @updatedAt @map("updated_at")

  @@map("collections")
}

model ArticleCollection {
  articleId    String     @map("article_id")
  collectionId String     @map("collection_id")
  position     Int        @default(0)
  article      Article    @relation(fields: [articleId], references: [id], onDelete: Cascade)
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  @@id([articleId, collectionId])
  @@map("article_collections")
}
```

`Article` 增加：`collections ArticleCollection[]`。

> 迁移方式：`npx prisma db push` + `npx prisma generate`，然后**重启 dev server**（项目已知约束：schema 变更后必须重启，否则新 client 不生效）。

### 2. 数据访问层

#### 2a. `src/lib/articles.ts`（小改）
- **导出** `ARTICLE_INCLUDE` 与 `mapArticle`（供合集模块复用文章映射）。
- `ArticleInput` 增加 `collectionIds?: string[]`。
- `mapArticle` 输出增加 `collections: { id, name, slug }[]`（在 `ARTICLE_INCLUDE` 中加入 `collections: { include: { collection: true }, orderBy: { position: "asc" } }`），供编辑回显使用。
- `createArticle`：当 `collectionIds` 存在时 `createMany` 写入 `ArticleCollection`，`position = 数组下标`。
- `updateArticle`：当 `collectionIds !== undefined` 时，先 `deleteMany({ articleId })` 再按 `position = 下标` 重建（MVP 约定：排序即编辑器中选择顺序）。

#### 2b. 新增 `src/lib/collections.ts`
仿照 `articles.ts` 的分类/标签实现，提供：

- 类型：`CollectionListItem`（含 `articleCount`）、`CollectionDetail`（含按 `position` 升序的文章数组，每篇带 `position`）、`CollectionArticleNav`（见下）。
- `getCollections(publishedOnly = false)`：`_count.articles` 按需过滤 `published`，`orderBy: createdAt asc`。
- `getCollectionBySlug(slug, { publishedOnly })`：返回合集 + 排序文章（`articleCollections: { include: { article: {...} }, orderBy: { position: "asc" } }`，文章用导出的 `mapArticle` 映射）。
- `getCollectionsForArticle(articleId)`：文章所属合集元信息（含该合集内的 position）。
- `getArticleCollectionNav(articleId)`：详情页导航数据——对每个所属合集，取该合集内按 `position` 排序的文章 `{slug, title}` 列表，返回 `{ collection: {id,name,slug}, total, current(1-based), prev, next }[]`。
- `createCollection({ name, slug?, description?, coverImage? })`、`updateCollection(id, {...})`、`deleteCollection(id)`（slug 用 `articles.ts` 导出的 `slugify`）。
- `setCollectionArticles(collectionId, articleIds[])`：删旧建新，`position = 下标`（合集管理页排序用）。
- `setArticleCollections(articleId, collectionIds[])`：删旧建新（文章编辑器保存用）。

### 3. API 路由（均仿 `/api/categories` 结构：无鉴权、处理 `isUniqueError` 返回 409）

- 新增 `src/app/api/collections/route.ts`：`GET`（`getCollections()`）、`POST`（创建，校验 `name` 必填）。
- 新增 `src/app/api/collections/[id]/route.ts`：`PATCH`（更新）、`DELETE`。
- 新增 `src/app/api/collections/[id]/articles/route.ts`：`GET`（`getCollectionBySlug` 按 id 拿详情，含文章）、`PUT`（`{ articleIds: string[] }` → `setCollectionArticles`）。
- 修改 `src/app/api/articles/route.ts` 与 `src/app/api/articles/[id]/route.ts`：`POST/PATCH` 的 body 增加 `collectionIds` 并透传给 `createArticle/updateArticle`；`GET [id]` 因 `mapArticle` 已含 collections 自动返回。

### 4. 管理后台

#### 4a. 新增 `src/app/admin/collections/page.tsx`（合集管理页，"use client"）
- 顶部"新建合集"按钮；合集列表（名称、文章数、创建时间、编辑/删除）。
- 创建/编辑表单：名称、slug（留空自动）、简介（textarea）、封面链接（可选）。
- 每行"管理文章"展开区：调 `GET /api/collections/[id]/articles` 展示已排序文章，支持**上移/下移**（交换 `articleIds` 后 `PUT`）、**移除**；"添加文章"下拉（`GET /api/articles?search=` 筛选，选中后 `PUT` 追加到末尾）。
- 删除合集前 `window.confirm` 确认（级联删除关联关系，文章不受影响）。

#### 4b. 侧边栏
- `src/components/admin/admin-sidebar.tsx` 增加"合集管理"入口 → `/admin/collections`。

#### 4c. 文章编辑器接入 — `src/components/admin/article-editor-dialog.tsx`
- 新增 `collections: CollectionListItem[]` prop 与 `collectionIds: string[]` 状态，从编辑对象的 `article.collections` 初始化。
- 在标签区块附近新增"合集（可多选）"：chips 点击切换（同标签交互），并提供"新建合集"（POST `/api/collections` 后追加到列表并选中）。
- 保存时在 `POST/PATCH /api/articles/[id]` 的 body 中加入 `collectionIds`。

#### 4d. `src/app/admin/articles/page.tsx`
- 并行 `fetch("/api/collections")`，传给 `ArticleEditorDialog`；表格可选展示合集徽标。

### 5. 前台（固定内置样式，前缀 `jjc-` 防样式冲突）

#### 5a. 重构渲染入口 — `src/lib/blog.ts`
- 抽出 `renderThemePage(pageType: "home" | "list" | "detail", dynamicData, opts?)`，内部即现有 `renderBlogTheme` 的合并+渲染流程，返回 HTML 字符串；`renderBlogTheme(dynamicData)` 改为调用它并包 `Response`（现有路由零改动）。
- `opts`：
  - `afterBodyHtml?: string`：渲染后经 JSDOM 插入到 `[data-content="article-body"]` 元素之后（详情页合集导航）。
  - `beforeListHtml?: string`：插入到第一个 `[data-content-type="dynamic-articles"]` 容器之前（合集头/合集网格）；无容器则追加到 `<main>`。
  - `stripEmptyLists?: boolean`：移除渲染后没有子元素的动态文章容器（合集列表页用，避免空网格）。

#### 5b. 新增 `src/lib/collections-render.ts`（纯函数，可单测）
- `escapeHtml(s)`。
- `buildCollectionNavHtml(navItems)`：固定样式导航条（合集名+链接、`第 N 篇 / 共 M 篇`、`← 上一篇 / 下一篇 →`，无则显示"已是最后一篇"占位）。多个合集时逐个渲染。
- `buildCollectionHeadHtml(collection)`：合集头（名称、简介、`共 N 篇文章`）。
- `buildCollectionsGridHtml(collections)`：合集卡片网格（名称、简介、文章数）。
- 内置一个 `<style>`（`jjc-` 前缀）：清新简约风格（浅色底、细边框、圆角、点缀色 `#E5A83D`）。

#### 5c. 新增 `src/app/collections/route.ts`（合集列表页）
- `getCollections(true)`（仅含已发布文章的合集）。
- `renderThemePage("list", { pagination: { page:1, totalPages:1, basePath:"/collections" } }, { beforeListHtml: gridHtml, stripEmptyLists: true })` → 主题导航/页脚 + 合集网格。

#### 5d. 新增 `src/app/collections/[slug]/route.ts`（合集详情页）
- 先 `renderCustomThemePage(\`/collections/${slug}\`)`（与现有路由一致，支持主题自定义页覆盖）。
- `getCollectionBySlug(slug, { publishedOnly: true })`；不存在 → `blogNotFoundHtml` 404。
- `renderThemePage("list", { articles: 合集文章.map(toArticleData), categories, tags, pagination: { page:1, totalPages:1, basePath:\`/collections/${slug}\` } }, { beforeListHtml: collectionHeadHtml })`。

#### 5e. 详情页合集导航 — `src/app/blog/[slug]/route.ts`
- 取文章后调用 `getArticleCollectionNav(article.id)`。
- 有合集时：`renderBlogTheme` 改为调用 `renderThemePage("detail", {...}, { afterBodyHtml: buildCollectionNavHtml(nav) })`；无合集则保持原 `renderBlogTheme` 行为。

### 6. 测试

- 新增 `src/lib/collections-render.test.ts`（纯函数，无需 DB）：
  - `escapeHtml` 转义。
  - `buildCollectionNavHtml` 正确输出 prev/next 链接与"第 N 篇/共 M 篇"；无 prev/next 时输出占位。
  - 注入逻辑（`afterBodyHtml` 插到 body 容器之后、`beforeListHtml` 插到动态列表前）可复用 `content-renderer.test.ts` 的 JSDOM 断言方式。
- 运行 `npx vitest run`，全量通过。

## 四、假设与决策

1. 一篇文章可加入多个合集；合集内文章顺序由 `ArticleCollection.position`（`setCollectionArticles` 的数组下标）决定，查询按 `position asc, createdAt asc` 兜底稳定排序。
2. 文章编辑器的合集多选顺序 = 保存后的合集内排序（MVP，不做拖拽排序；精细排序在合集管理页用上移/下移完成）。
3. 前台合集列表只展示含已发布文章的合集；合集详情页即使全为草稿也正常渲染（空列表），不存在才 404。
4. 前台合集导航/页面为固定内置样式（`jjc-` 前缀），不引入新主题字段类型；主题的导航/页脚/列表布局仍复用（通过 list/detail 页面类型）。
5. 删除合集仅级联删除关联关系，不删除文章；删除文章时其合集关系级联删除。
6. 不额外引入第三方库；slug 复用 `articles.ts` 的 `slugify`。

## 五、验证步骤

1. `npx prisma db push && npx prisma generate`，重启 `npm run dev`。
2. `npx vitest run` 全量通过（含新增 `collections-render.test.ts`）。
3. 后台：创建合集 A/B → 在文章编辑器为多篇文章勾选合集 A → 在合集管理页对 A 内文章做上移/下移/移除/添加，确认顺序与数量正确。
4. 前台浏览器验证（localhost:3000）：
   - `/collections` 显示合集卡片网格，点击进入详情。
   - `/collections/a` 显示合集头 + 按自定义顺序排列的文章卡片，点击文章可进入详情。
   - 文章详情页出现合集导航条，显示"第 N 篇 / 共 M 篇"，上一篇/下一篇跳转正确；非合集文章无导航条。
5. 回归：`/blog`、`/blog/category/*`、`/blog/tag/*`、文章详情页原有渲染不受影响。
