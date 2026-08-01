import { prisma } from "./db"
import { setArticleCount } from "./stats"
import type { Prisma } from "@/generated/prisma/client"

export interface CategoryMeta {
  id: string
  name: string
  slug: string
}

export interface TagMeta {
  id: string
  name: string
  slug: string
}

export interface ArticleListItem {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  published: boolean
  category: CategoryMeta | null
  tags: TagMeta[]
  createdAt: Date
  updatedAt: Date
}

export interface CategoryListItem {
  id: string
  name: string
  slug: string
  articleCount: number
}

export interface TagListItem {
  id: string
  name: string
  slug: string
  articleCount: number
}

export interface ArticleInput {
  title: string
  slug: string
  content: string
  excerpt?: string
  published?: boolean
  categoryId?: string | null
  tagIds?: string[]
}

export interface ArticleFilters {
  categorySlug?: string
  tagSlug?: string
  search?: string
  publishedOnly?: boolean
}

const ARTICLE_INCLUDE = {
  category: true,
  tags: { include: { tag: true } },
} satisfies Prisma.ArticleInclude

export type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof ARTICLE_INCLUDE }>

function mapCategory(c: CategoryMeta | null): CategoryMeta | null {
  return c ? { id: c.id, name: c.name, slug: c.slug } : null
}

function mapArticle(row: ArticleRow): ArticleListItem {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    published: row.published,
    category: mapCategory(row.category),
    tags: row.tags.map((at) => ({
      id: at.tag.id,
      name: at.tag.name,
      slug: at.tag.slug,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function deriveExcerpt(excerpt: string | undefined, content: string): string | null {
  const trimmed = excerpt?.trim()
  if (trimmed) return trimmed

  const stripped = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_\-~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!stripped) return null
  return stripped.length > 120 ? `${stripped.slice(0, 120)}…` : stripped
}

export function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  )
}

export function isUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  )
}

async function refreshArticleCount(): Promise<void> {
  const count = await prisma.article.count()
  await setArticleCount(count)
}

export async function getArticles(
  filters: ArticleFilters = {}
): Promise<ArticleListItem[]> {
  const where: Prisma.ArticleWhereInput = {}
  if (filters.categorySlug) {
    where.category = { is: { slug: filters.categorySlug } }
  }
  if (filters.tagSlug) {
    where.tags = { some: { tag: { slug: filters.tagSlug } } }
  }
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { excerpt: { contains: filters.search } },
      { content: { contains: filters.search } },
    ]
  }
  if (filters.publishedOnly) where.published = true

  const rows = await prisma.article.findMany({
    where,
    include: ARTICLE_INCLUDE,
    orderBy: { createdAt: "desc" },
  })
  return rows.map(mapArticle)
}

export async function getArticleBySlug(
  slug: string
): Promise<ArticleRow | null> {
  return prisma.article.findUnique({
    where: { slug },
    include: ARTICLE_INCLUDE,
  })
}

export async function getArticleById(
  id: string
): Promise<ArticleRow | null> {
  return prisma.article.findUnique({
    where: { id },
    include: ARTICLE_INCLUDE,
  })
}

export async function createArticle(input: ArticleInput): Promise<ArticleListItem> {
  const row = await prisma.article.create({
    data: {
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: deriveExcerpt(input.excerpt, input.content),
      published: input.published ?? false,
      categoryId: input.categoryId ?? null,
      tags: input.tagIds?.length
        ? { create: input.tagIds.map((tagId) => ({ tagId })) }
        : undefined,
    },
    include: ARTICLE_INCLUDE,
  })
  await refreshArticleCount()
  return mapArticle(row)
}

export async function updateArticle(
  id: string,
  input: Partial<ArticleInput>
): Promise<ArticleListItem | null> {
  const existing = await prisma.article.findUnique({ where: { id } })
  if (!existing) return null

  const content = input.content ?? existing.content

  await prisma.article.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.excerpt !== undefined && {
        excerpt: deriveExcerpt(input.excerpt, content),
      }),
      ...(input.published !== undefined && { published: input.published }),
      ...(input.categoryId !== undefined && {
        category: input.categoryId
          ? { connect: { id: input.categoryId } }
          : { disconnect: true },
      }),
    },
  })

  if (input.tagIds !== undefined) {
    await prisma.articleTag.deleteMany({ where: { articleId: id } })
    if (input.tagIds.length > 0) {
      await prisma.articleTag.createMany({
        data: input.tagIds.map((tagId) => ({ articleId: id, tagId })),
      })
    }
  }

  const row = await prisma.article.findUnique({
    where: { id },
    include: ARTICLE_INCLUDE,
  })
  return row ? mapArticle(row) : null
}

export async function deleteArticle(id: string): Promise<void> {
  await prisma.article.delete({ where: { id } })
  await refreshArticleCount()
}

export async function getCategories(
  publishedOnly = false
): Promise<CategoryListItem[]> {
  const rows = await prisma.category.findMany({
    include: {
      _count: {
        select: {
          articles: publishedOnly ? { where: { published: true } } : true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    articleCount: c._count.articles,
  }))
}

export async function createCategory(name: string, slug?: string) {
  return prisma.category.create({
    data: { name, slug: slug?.trim() || slugify(name) },
  })
}

export async function updateCategory(
  id: string,
  data: { name?: string; slug?: string }
) {
  return prisma.category.update({ where: { id }, data })
}

export async function deleteCategory(id: string): Promise<void> {
  await prisma.category.delete({ where: { id } })
}

export async function getTags(): Promise<TagListItem[]> {
  const rows = await prisma.tag.findMany({
    include: { _count: { select: { articles: true } } },
    orderBy: { createdAt: "asc" },
  })
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    articleCount: t._count.articles,
  }))
}

export async function createTag(name: string, slug?: string) {
  return prisma.tag.create({
    data: { name, slug: slug?.trim() || slugify(name) },
  })
}

export async function updateTag(
  id: string,
  data: { name?: string; slug?: string }
) {
  return prisma.tag.update({ where: { id }, data })
}

export async function deleteTag(id: string): Promise<void> {
  await prisma.tag.delete({ where: { id } })
}
