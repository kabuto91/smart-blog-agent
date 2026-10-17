import {
  getArticleBySlug,
  getArticlesByIds,
  getArticlesPage,
  getCategories,
  getTags,
} from "../articles"
import type { TagListItem } from "../articles"
import { getFeaturedArticleIds } from "../site-config"
import {
  BLOG_PAGE_SIZE,
  HOME_PAGE_ARTICLE_LIMIT,
  HOME_PAGE_TAG_LIMIT,
  toArticleData,
  toArticleDetailData,
  toCategoryData,
  toTagData,
} from "../blog"
import type { DynamicData, PageType } from "./content-renderer"

/** 首页/列表页标签云只展示文章数最多的前 N 个标签（与线上渲染口径一致）。 */
function topTags(tags: TagListItem[]) {
  return [...tags]
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, HOME_PAGE_TAG_LIMIT)
    .map(toTagData)
}

/**
 * 后台主题预览专用的动态数据，口径与线上 /blog 各页面保持一致。
 *
 * 生成的主题片段里，动态列表项模板往往不含示例文案（提示词要求不手写占位条目），
 * 若预览时不注入真实数据，文章列表/标签云会渲染成空白，导致页面布局塌陷，
 * 被误判为「主题样式乱掉」。注入与线上一致的数据后，后台预览与线上渲染所见即所得。
 */
export async function buildPreviewDynamicData(
  pageType: PageType
): Promise<DynamicData> {
  const [categories, tags] = await Promise.all([getCategories(true), getTags()])

  if (pageType === "home") {
    const [result, featuredIds] = await Promise.all([
      getArticlesPage({ publishedOnly: true }, 1, HOME_PAGE_ARTICLE_LIMIT),
      getFeaturedArticleIds(),
    ])
    const featured = featuredIds.length
      ? await getArticlesByIds(featuredIds)
      : []
    return {
      articles: result.items.map(toArticleData),
      featuredArticles: featured.map(toArticleData),
      categories: categories.map(toCategoryData),
      tags: topTags(tags),
    }
  }

  if (pageType === "detail") {
    const latest = await getArticlesPage({ publishedOnly: true }, 1, 1)
    const slug = latest.items[0]?.slug
    const article = slug ? await getArticleBySlug(slug) : null
    return {
      articles: article ? [toArticleDetailData(article)] : [],
      categories: categories.map(toCategoryData),
      tags: topTags(tags),
    }
  }

  const result = await getArticlesPage(
    { publishedOnly: true },
    1,
    BLOG_PAGE_SIZE
  )
  return {
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: topTags(tags),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: "/blog/archive",
    },
  }
}
