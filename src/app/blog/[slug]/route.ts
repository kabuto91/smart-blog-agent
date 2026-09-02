import { getArticleBySlug, getCategories, getTags } from "@/lib/articles"
import { getArticleCollectionNav } from "@/lib/collections"
import {
  toArticleDetailData,
  toCategoryData,
  toTagData,
  renderThemePage,
  renderCustomThemePage,
  blogNotFoundHtml,
  blogNotConfiguredHtml,
  HOME_PAGE_TAG_LIMIT,
} from "@/lib/blog"
import { buildCollectionNavHtml } from "@/lib/collections-render"
import { bumpArticleRead, buildArticleStatsBar } from "@/lib/article-stats"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const customHtml = await renderCustomThemePage(`/blog/${slug}`)
  if (customHtml) {
    return new Response(customHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const article = await getArticleBySlug(slug)

  if (!article || !article.published) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  // 阅读量：每打开一次详情页 +1，并读取最新阅读数用于展示
  const readCount = await bumpArticleRead(article.id)
  const likeCount = article.likeCount

  const [categories, tags, nav] = await Promise.all([
    getCategories(true),
    getTags(),
    getArticleCollectionNav(article.id),
  ])

  const dynamicData = {
    articles: [toArticleDetailData(article)],
    categories: categories.map(toCategoryData),
    tags: [...tags]
      .sort((a, b) => b.articleCount - a.articleCount)
      .slice(0, HOME_PAGE_TAG_LIMIT)
      .map(toTagData),
  }

  // 正文后注入统计条（阅读数 + 点赞按钮）；文章属于合集时一并注入合集进度导航
  const statsBar = buildArticleStatsBar({
    id: article.id,
    readCount,
    likeCount,
  })
  const afterBodyHtml =
    nav.length > 0 ? buildCollectionNavHtml(nav) + statsBar : statsBar

  const html = await renderThemePage("detail", dynamicData, {
    afterBodyHtml,
  })
  if (html === null) {
    return new Response(blogNotConfiguredHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
