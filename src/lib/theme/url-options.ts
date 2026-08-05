import { getArticles, getCategories, getTags } from "@/lib/articles"
import { getActiveTheme } from "@/lib/theme/theme"

export interface UrlOption {
  url: string
  label: string
  type: "home" | "archive" | "category" | "tag" | "article" | "custom"
}

export async function getUrlOptions(): Promise<UrlOption[]> {
  const [articles, categories, tags, activeTheme] = await Promise.all([
    getArticles({ publishedOnly: true }),
    getCategories(),
    getTags(),
    getActiveTheme(),
  ])

  const options: UrlOption[] = [
    { url: "/blog", label: "博客首页", type: "home" },
    { url: "/blog/archive", label: "全部文章", type: "archive" },
  ]

  for (const category of categories) {
    if (category.articleCount > 0) {
      options.push({
        url: `/blog/category/${category.slug}`,
        label: `分类：${category.name}`,
        type: "category",
      })
    }
  }

  for (const tag of tags) {
    if (tag.articleCount > 0) {
      options.push({
        url: `/blog/tag/${tag.slug}`,
        label: `标签：${tag.name}`,
        type: "tag",
      })
    }
  }

  for (const article of articles) {
    options.push({
      url: `/blog/${article.slug}`,
      label: article.title,
      type: "article",
    })
  }

  if (activeTheme) {
    for (const page of activeTheme.pages) {
      if (page.type !== "custom" || !page.route) continue
      options.push({
        url: page.route,
        label: `自定义页面：${page.route}`,
        type: "custom",
      })
    }
  }

  return options
}
