import { unstable_cache } from "next/cache"
import {
  getArticleBySlug,
  getArticlesByIds,
  getArticlesPage,
  getCategories,
  getTags,
} from "@smart-blog/core/lib/articles"
import { getFeaturedArticleIds } from "@smart-blog/core/lib/site-config"
import {
  getArticleCollectionNav,
  getCollectionBySlug,
  getCollections,
} from "@smart-blog/core/lib/collections"
import {
  buildCollectionHeadHtml,
  buildCollectionNavHtml,
  buildCollectionsGridHtml,
} from "@smart-blog/core/lib/collections-render"
import { buildArticleStatsBar } from "@smart-blog/core/lib/article-stats"
import { getActiveTheme } from "@smart-blog/core/lib/theme/theme"
import {
  toArticleData,
  toArticleDetailData,
  toCategoryData,
  toTagData,
  renderThemePage,
  renderCustomThemePage,
  blogNotFoundHtml,
  blogNotConfiguredHtml,
  BLOG_PAGE_SIZE,
  HOME_PAGE_ARTICLE_LIMIT,
  HOME_PAGE_TAG_LIMIT,
} from "@smart-blog/core/lib/blog"
import type { TagListItem } from "@smart-blog/core/lib/articles"

/** 缓存产出的最终页面：HTML 字符串 + HTTP 状态码。 */
export interface CachedPage {
  html: string
  status: number
}

/** 把缓存产出的页面包装成 HTML 响应。 */
export function htmlResponse(page: CachedPage): Response {
  return new Response(page.html, {
    status: page.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

/**
 * 渲染并返回响应，捕获渲染异常并返回 500 错误页（与旧 renderBlogTheme 的兜底一致）。
 * 兜底放在缓存层之外，保证异常不会被写入缓存。
 */
export async function renderResponse(page: Promise<CachedPage>): Promise<Response> {
  try {
    return htmlResponse(await page)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return new Response(
      `<!DOCTYPE html><html><body><h1>渲染错误</h1><p>${msg}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }
}

/** 缓存标签：便于后续接入按需失效（revalidateTag）。 */
export const BLOG_CACHE_TAGS = [
  "theme",
  "site-config",
  "articles",
  "collections",
  "taxonomy",
]

/** 生产环境缓存 TTL（秒）。主题/文章改动在此窗口内自动传播。 */
const REVALIDATE_SECONDS = 60

/**
 * 用 Next 内置缓存包裹一个「返回 HTML 字符串」的异步函数。
 * - 生产环境：走 unstable_cache（跨请求复用，命中即零 DB 查询 + 零 JSDOM 解析）
 * - 开发环境：直接调用，避免本地预览时缓存导致看不到即时改动
 * 函数参数（slug / page 等）会自动进入缓存 key。
 */
function cacheable<A extends unknown[], R>(
  keyParts: string[],
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  if (process.env.NODE_ENV !== "production") return fn
  return unstable_cache(fn, keyParts, {
    revalidate: REVALIDATE_SECONDS,
    tags: BLOG_CACHE_TAGS,
  }) as unknown as (...args: A) => Promise<R>
}

/** 首页标签云只取文章数最多的前 N 个标签。 */
function toHomeTagList(tags: TagListItem[]) {
  return [...tags]
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, HOME_PAGE_TAG_LIMIT)
    .map(toTagData)
}

function pageOf(html: string | null): CachedPage {
  return html === null
    ? { html: blogNotConfiguredHtml, status: 200 }
    : { html, status: 200 }
}

function notFound(): CachedPage {
  return { html: blogNotFoundHtml, status: 404 }
}

function notConfigured(): CachedPage {
  return { html: blogNotConfiguredHtml, status: 200 }
}

/** 根路径 `/` 与 `/blog` 共用的主题首页。 */
async function renderHome(): Promise<CachedPage> {
  const [result, categories, tags, featuredIds] = await Promise.all([
    getArticlesPage({ publishedOnly: true }, 1, HOME_PAGE_ARTICLE_LIMIT),
    getCategories(true),
    getTags(),
    getFeaturedArticleIds(),
  ])
  const featured = featuredIds.length ? await getArticlesByIds(featuredIds) : []

  const html = await renderThemePage("home", {
    articles: result.items.map(toArticleData),
    featuredArticles: featured.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: toHomeTagList(tags),
  })
  return pageOf(html)
}

export const getHomeHtml = cacheable(["blog:home"], renderHome)

/** 文章归档分页列表 `/blog/archive`。 */
async function renderArchive(page: number): Promise<CachedPage> {
  const [result, categories, tags] = await Promise.all([
    getArticlesPage({ publishedOnly: true }, page, BLOG_PAGE_SIZE),
    getCategories(true),
    getTags(),
  ])
  const html = await renderThemePage("list", {
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: [...tags]
      .sort((a, b) => b.articleCount - a.articleCount)
      .slice(0, HOME_PAGE_TAG_LIMIT)
      .map(toTagData),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: "/blog/archive",
    },
  })
  return pageOf(html)
}

export const getArchiveHtml = cacheable(["blog:archive"], renderArchive)

/** 分类列表 `/blog/category/:slug`。 */
async function renderCategory(slug: string, page: number): Promise<CachedPage> {
  const custom = await renderCustomThemePage(`/blog/category/${slug}`)
  if (custom) return { html: custom, status: 200 }

  const [result, categories, tags] = await Promise.all([
    getArticlesPage(
      { publishedOnly: true, categorySlug: slug },
      page,
      BLOG_PAGE_SIZE
    ),
    getCategories(true),
    getTags(),
  ])

  if (!categories.find((c) => c.slug === slug)) return notFound()

  const html = await renderThemePage("list", {
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: `/blog/category/${slug}`,
    },
  })
  return pageOf(html)
}

export const getCategoryHtml = cacheable(["blog:category"], renderCategory)

/** 标签列表 `/blog/tag/:slug`。 */
async function renderTag(slug: string, page: number): Promise<CachedPage> {
  const custom = await renderCustomThemePage(`/blog/tag/${slug}`)
  if (custom) return { html: custom, status: 200 }

  const [result, categories, tags] = await Promise.all([
    getArticlesPage({ publishedOnly: true, tagSlug: slug }, page, BLOG_PAGE_SIZE),
    getCategories(true),
    getTags(),
  ])

  if (!tags.find((t) => t.slug === slug)) return notFound()

  const html = await renderThemePage("list", {
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: toHomeTagList(tags),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: `/blog/tag/${slug}`,
    },
  })
  return pageOf(html)
}

export const getTagHtml = cacheable(["blog:tag"], renderTag)

/** 文章详情 `/blog/:slug`（阅读量由客户端脚本另行累加，渲染路径只读）。 */
async function renderDetail(slug: string): Promise<CachedPage> {
  const custom = await renderCustomThemePage(`/blog/${slug}`)
  if (custom) return { html: custom, status: 200 }

  const article = await getArticleBySlug(slug)
  if (!article || !article.published) return notFound()

  const [categories, tags, nav] = await Promise.all([
    getCategories(true),
    getTags(),
    getArticleCollectionNav(article.id),
  ])

  const statsBar = buildArticleStatsBar({
    id: article.id,
    readCount: article.readCount,
    likeCount: article.likeCount,
  })
  const afterBodyHtml =
    nav.length > 0 ? buildCollectionNavHtml(nav) + statsBar : statsBar

  const html = await renderThemePage(
    "detail",
    {
      articles: [toArticleDetailData(article)],
      categories: categories.map(toCategoryData),
      tags: toHomeTagList(tags),
    },
    { afterBodyHtml }
  )
  return pageOf(html)
}

export const getDetailHtml = cacheable(["blog:detail"], renderDetail)

/** 合集总览 `/collections`。 */
async function renderCollections(): Promise<CachedPage> {
  const custom = await renderCustomThemePage("/collections")
  if (custom) return { html: custom, status: 200 }

  const collections = await getCollections(true)
  const gridHtml = buildCollectionsGridHtml(
    collections.map((c) => ({
      name: c.name,
      slug: c.slug,
      description: c.description,
      articleCount: c.articleCount,
    }))
  )

  const html = await renderThemePage(
    "list",
    { pagination: { page: 1, totalPages: 1, basePath: "/collections" } },
    { beforeListHtml: gridHtml, stripEmptyLists: true }
  )
  return pageOf(html)
}

export const getCollectionsHtml = cacheable(
  ["blog:collections"],
  renderCollections
)

/** 单个合集 `/collections/:slug`。 */
async function renderCollection(slug: string): Promise<CachedPage> {
  const custom = await renderCustomThemePage(`/collections/${slug}`)
  if (custom) return { html: custom, status: 200 }

  const collection = await getCollectionBySlug(slug, { publishedOnly: true })
  if (!collection) return notFound()

  const [categories, tags] = await Promise.all([getCategories(true), getTags()])

  const html = await renderThemePage(
    "list",
    {
      articles: collection.articles.map(toArticleData),
      categories: categories.map(toCategoryData),
      tags: tags.map(toTagData),
      pagination: { page: 1, totalPages: 1, basePath: `/collections/${slug}` },
    },
    { beforeListHtml: buildCollectionHeadHtml(collection) }
  )
  return pageOf(html)
}

export const getCollectionHtml = cacheable(
  ["blog:collection"],
  renderCollection
)

/** 主题自定义页（catch-all 兜底路由）。 */
async function renderCustomPage(route: string): Promise<CachedPage> {
  if (!(await getActiveTheme())) return notConfigured()

  const html = await renderCustomThemePage(route)
  return html ? { html, status: 200 } : notFound()
}

export const getCustomPageHtml = cacheable(
  ["blog:custom"],
  renderCustomPage
)
