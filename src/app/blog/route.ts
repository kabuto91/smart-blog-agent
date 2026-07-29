import { getActiveTheme } from "@/lib/theme"
import { getSiteConfig } from "@/lib/site-config"
import { renderContent } from "@/lib/content-renderer"
import type { ArticleData, CategoryData } from "@/lib/content-renderer"
import type { ContentConfig } from "@/lib/types/content-config"

export const runtime = "nodejs"

const mockArticles: ArticleData[] = [
  {
    id: 1,
    title: "欢迎来到我的博客",
    excerpt: "这是使用 AI 生成主题的第一篇文章。你的博客将拥有独特的外观和风格。",
    date: "2026-07-29",
    category: "公告",
    slug: "welcome",
  },
  {
    id: 2,
    title: "如何使用智能博客助手",
    excerpt: "智能博客助手可以帮助你快速生成个性化的博客主题，只需要用自然语言描述你想要的风格。",
    date: "2026-07-28",
    category: "教程",
    slug: "how-to-use",
  },
  {
    id: 3,
    title: "极简主义设计趋势",
    excerpt: "2026 年的博客设计趋势更加注重内容可读性和用户体验，极简主义仍然是主流方向。",
    date: "2026-07-27",
    category: "设计",
    slug: "minimalist-design",
  },
  {
    id: 4,
    title: "开始你的写作之旅",
    excerpt: "写作是思考的延伸。建立一个博客，与世界分享你的想法和见解。",
    date: "2026-07-26",
    category: "随笔",
    slug: "start-writing",
  },
]

const mockCategories: CategoryData[] = [
  { id: 1, name: "公告", slug: "announcement", count: 1 },
  { id: 2, name: "教程", slug: "tutorial", count: 1 },
  { id: 3, name: "设计", slug: "design", count: 1 },
  { id: 4, name: "随笔", slug: "essay", count: 1 },
]

const placeholderHtml = `<!DOCTYPE html>
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

export async function GET() {
  try {
    const activeTheme = await getActiveTheme()

    if (!activeTheme) {
      return new Response(placeholderHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }

    const siteConfig = await getSiteConfig()

    const contentConfig: ContentConfig = activeTheme.contentConfig ?? {}

    const renderedHtml = renderContent(
      activeTheme.html,
      contentConfig,
      { articles: mockArticles, categories: mockCategories },
      siteConfig
    )

    return new Response(renderedHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return new Response(
      `<!DOCTYPE html><html><body><h1>渲染错误</h1><p>${msg}</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 }
    )
  }
}
