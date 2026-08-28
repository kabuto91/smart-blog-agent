import { getArticlesPage, getArticlesByIds, getCategories, getTags } from "@/lib/articles"
import { getFeaturedArticleIds } from "@/lib/site-config"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  HOME_PAGE_ARTICLE_LIMIT,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET() {
  const [result, categories, tags, featuredIds] = await Promise.all([
    getArticlesPage({ publishedOnly: true }, 1, HOME_PAGE_ARTICLE_LIMIT),
    getCategories(true),
    getTags(),
    getFeaturedArticleIds(),
  ])

  const featured = featuredIds.length
    ? await getArticlesByIds(featuredIds)
    : []

  return renderBlogTheme({
    articles: result.items.map(toArticleData),
    featuredArticles: featured.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
  })
}
