import { getArticles, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET() {
  const [articles, categories, tags] = await Promise.all([
    getArticles({ publishedOnly: true }),
    getCategories(true),
    getTags(),
  ])

  return renderBlogTheme({
    articles: articles.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
  })
}
