import { renderMarkdown } from "./markdown"
import { getActiveTheme, pageContentConfig } from "./theme/theme"
import { getSiteConfig } from "./site-config"
import { renderContent, resolvePageType } from "./theme/content-renderer"
import { mergeThemePage } from "./theme/theme-splitter"
import { normalizeRoute } from "./theme/custom-pages"
import type {
  ArticleData,
  CategoryData,
  TagData,
  DynamicData,
} from "./theme/content-renderer"
import type { ContentConfig } from "./types/content-config"
import type {
  ArticleListItem,
  CategoryListItem,
  TagListItem,
  ArticleRow,
} from "./articles"

export const BLOG_PAGE_SIZE = 10

export const HOME_PAGE_ARTICLE_LIMIT = 6

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function toArticleData(a: ArticleListItem): ArticleData {
  return {
    id: a.id,
    title: a.title,
    excerpt: a.excerpt ?? "",
    date: formatDate(a.createdAt),
    category: a.category?.name,
    slug: a.slug,
    tags: a.tags.map((t) => t.name),
  }
}

export function toArticleDetailData(a: ArticleRow): ArticleData {
  return {
    id: a.id,
    title: a.title,
    excerpt: a.excerpt ?? "",
    date: formatDate(a.createdAt),
    category: a.category?.name,
    slug: a.slug,
    contentHtml: renderMarkdown(a.content),
    tags: a.tags.map((at) => at.tag.name),
  }
}

export function toCategoryData(c: CategoryListItem): CategoryData {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    count: c.articleCount,
  }
}

export function toTagData(t: TagListItem): TagData {
  return { id: t.id, name: t.name, slug: t.slug }
}

export const blogNotConfiguredHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>博客未配置</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f4f1;
      color: #1c1c1e;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1.5rem; }
    a {
      display: inline-block;
      padding: 0.5rem 1.25rem;
      background: #e5a83d;
      color: #181a1e;
      text-decoration: none;
      border-radius: 0.5rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>博客尚未配置</h1>
    <p>请前往管理后台创建并启用一个主题</p>
    <a href="/admin/themes">前往管理后台</a>
  </div>
</body>
</html>`

export const blogNotFoundHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面未找到</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f4f1;
      color: #1c1c1e;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #6b7280; margin-bottom: 1.5rem; }
    a {
      display: inline-block;
      padding: 0.5rem 1.25rem;
      background: #e5a83d;
      color: #181a1e;
      text-decoration: none;
      border-radius: 0.5rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>文章未找到</h1>
    <p>请返回博客首页查看其他文章</p>
    <a href="/blog">返回博客</a>
  </div>
</body>
</html>`

export async function renderBlogTheme(
  dynamicData: DynamicData
): Promise<Response> {
  try {
    const activeTheme = await getActiveTheme()

    if (!activeTheme) {
      return new Response(blogNotConfiguredHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const pageType = resolvePageType(dynamicData)
    const page = activeTheme.pages.find((p) => p.type === pageType)
    if (!page) {
      return new Response(blogNotConfiguredHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const siteConfig = await getSiteConfig()
    const contentConfig: ContentConfig =
      pageContentConfig(activeTheme, pageType) ?? {}

const mergedHtml = mergeThemePage(activeTheme.layoutHtml, page.html, {
      navClearance: pageType !== "home",
    })

    const renderedHtml = renderContent(
      mergedHtml,
      contentConfig,
      dynamicData,
      siteConfig,
      { pageSpecific: true }
    )

    return new Response(renderedHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return new Response(
      `<!DOCTYPE html><html><body><h1>渲染错误</h1><p>${msg}</p></body></html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 500,
      }
    )
  }
}

/** 按 route 渲染某个自定义页面行（主题内存在则返回 HTML，否则返回 null）。 */
export async function renderCustomThemePage(
  route: string
): Promise<string | null> {
  const activeTheme = await getActiveTheme()
  if (!activeTheme) return null

  const target = normalizeRoute(route)
  const page = activeTheme.pages.find(
    (p) => p.type === "custom" && normalizeRoute(p.route ?? "") === target
  )
  if (!page) return null

  const siteConfig = await getSiteConfig()
  const contentConfig: ContentConfig =
    pageContentConfig(activeTheme, "custom") ?? {}

  const mergedHtml = mergeThemePage(activeTheme.layoutHtml, page.html, {
    navClearance: true,
  })
  return renderContent(mergedHtml, contentConfig, undefined, siteConfig, {
    pageSpecific: true,
  })
}
