import {
  getArticlesPage,
  getArticlesByIds,
  getCategories,
  getTags,
} from "@smart-blog/core/lib/articles"
import { getFeaturedArticleIds } from "@smart-blog/core/lib/site-config"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  HOME_PAGE_ARTICLE_LIMIT,
  HOME_PAGE_TAG_LIMIT,
} from "@smart-blog/core/lib/blog"

/** 渲染主题首页；站点根路径 `/` 与 `/blog` 共用同一份实现。 */
export async function renderHomePage(): Promise<Response> {
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
    tags: [...tags]
      .sort((a, b) => b.articleCount - a.articleCount)
      .slice(0, HOME_PAGE_TAG_LIMIT)
      .map(toTagData),
  })
}
