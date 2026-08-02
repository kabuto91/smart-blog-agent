import { getArticlesPage, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  BLOG_PAGE_SIZE,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1

  const [result, categories, tags] = await Promise.all([
    getArticlesPage({ publishedOnly: true }, page, BLOG_PAGE_SIZE),
    getCategories(true),
    getTags(),
  ])

  return renderBlogTheme({
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: "/blog/archive",
    },
  })
}
