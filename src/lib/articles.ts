import { prisma } from "./db/client"
import { setArticleCount } from "./db/stats"
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

export interface CollectionMeta {
  id: string
  name: string
  slug: string
}

export interface ArticleListItem {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverImage: string | null
  content: string
  published: boolean
  juejinArticleId: string | null
  category: CategoryMeta | null
  tags: TagMeta[]
  collections: CollectionMeta[]
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
  coverImage?: string | null
  published?: boolean
  juejinArticleId?: string | null
  categoryId?: string | null
  tagIds?: string[]
  collectionIds?: string[]
}

export interface ArticleFilters {
  categorySlug?: string
  tagSlug?: string
  search?: string
  publishedOnly?: boolean
}

export interface ArticlePageResult {
  items: ArticleListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function buildArticleWhere(filters: ArticleFilters): Prisma.ArticleWhereInput {
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
  return where
}

export const ARTICLE_INCLUDE = {
  category: true,
  tags: { include: { tag: true } },
  collections: { include: { collection: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ArticleInclude

export type ArticleRow = Prisma.ArticleGetPayload<{ include: typeof ARTICLE_INCLUDE }>

function mapCategory(c: CategoryMeta | null): CategoryMeta | null {
  return c ? { id: c.id, name: c.name, slug: c.slug } : null
}

export function mapArticle(row: ArticleRow): ArticleListItem {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverImage: row.coverImage,
    content: row.content,
    published: row.published,
    juejinArticleId: row.juejinArticleId,
    category: mapCategory(row.category),
    tags: row.tags.map((at) => ({
      id: at.tag.id,
      name: at.tag.name,
      slug: at.tag.slug,
    })),
    collections: row.collections.map((ac) => ({
      id: ac.collection.id,
      name: ac.collection.name,
      slug: ac.collection.slug,
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
  filters: ArticleFilters = {},
  pagination?: { page?: number; pageSize?: number }
): Promise<ArticleListItem[]> {
  const where = buildArticleWhere(filters)
  const page = pagination?.page ?? 1
  const pageSize = pagination?.pageSize

  const rows = await prisma.article.findMany({
    where,
    include: ARTICLE_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(pageSize ? { take: pageSize, skip: (page - 1) * pageSize } : {}),
  })
  return rows.map(mapArticle)
}

/** 按传入顺序返回指定 ID 的已发布文章；未发布/不存在的自动跳过。 */
export async function getArticlesByIds(ids: string[]): Promise<ArticleListItem[]> {
  const uniq = [...new Set(ids)]
  if (uniq.length === 0) return []
  const rows = await prisma.article.findMany({
    where: { id: { in: uniq }, published: true },
    include: ARTICLE_INCLUDE,
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  return uniq.flatMap((id) => (byId.has(id) ? [mapArticle(byId.get(id)!)] : []))
}

export async function countArticles(
  filters: ArticleFilters = {}
): Promise<number> {
  return prisma.article.count({ where: buildArticleWhere(filters) })
}

export async function getArticlesPage(
  filters: ArticleFilters = {},
  page = 1,
  pageSize = 10
): Promise<ArticlePageResult> {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const total = await countArticles(filters)
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(Math.max(1, Math.floor(page)), totalPages)
  const items = await getArticles(filters, {
    page: safePage,
    pageSize: safePageSize,
  })
  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  }
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
      coverImage: input.coverImage ?? null,
      published: input.published ?? false,
      juejinArticleId: input.juejinArticleId ?? null,
      categoryId: input.categoryId ?? null,
      tags: input.tagIds?.length
        ? { create: input.tagIds.map((tagId) => ({ tagId })) }
        : undefined,
    },
    include: ARTICLE_INCLUDE,
  })

  if (input.collectionIds?.length) {
    await prisma.articleCollection.createMany({
      data: input.collectionIds.map((collectionId, i) => ({
        articleId: row.id,
        collectionId,
        position: i,
      })),
    })
  }

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
      ...(input.coverImage !== undefined && { coverImage: input.coverImage }),
      ...(input.published !== undefined && { published: input.published }),
      ...(input.juejinArticleId !== undefined && {
        juejinArticleId: input.juejinArticleId,
      }),
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

  if (input.collectionIds !== undefined) {
    await prisma.articleCollection.deleteMany({ where: { articleId: id } })
    if (input.collectionIds.length > 0) {
      await prisma.articleCollection.createMany({
        data: input.collectionIds.map((collectionId, i) => ({
          articleId: id,
          collectionId,
          position: i,
        })),
      })
    }
  }

  const row = await prisma.article.findUnique({
    where: { id },
    include: ARTICLE_INCLUDE,
  })
  return row ? mapArticle(row) : null
}

/**
 * 单独维护掘金文章 ID（发布后回写 / 解除绑定置空）。
 * 使用 findFirst + update 而非 upsert，避免 route=null 之类的唯一约束问题。
 */
export async function updateJuejinArticleId(
  id: string,
  juejinArticleId: string | null
): Promise<boolean> {
  const existing = await prisma.article.findFirst({ where: { id } })
  if (!existing) return false
  await prisma.article.update({
    where: { id },
    data: { juejinArticleId },
  })
  return true
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

/**
 * 用指定名称集合整体重建本地标签库：
 * 清除所有标签及其与文章的关联（ArticleTag），再按名称批量新建标签。
 * 用于「从掘金导入标签」——以掘金官方标签库替换本地全部标签。
 */
export async function replaceAllTagsWith(
  names: string[]
): Promise<{ imported: number; deleted: number }> {
  const uniqueNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]

  // 掘金标签存在同义异构（如 "TypeScript" 与 "typescript"），slugify 后会撞唯一约束，
  // 这里在冲突时追加数字后缀，保证每个 slug 唯一。
  const used = new Map<string, number>()
  const rows = uniqueNames.map((name) => {
    const base = slugify(name)
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    const slug = count === 0 ? base : `${base}-${count + 1}`
    return { name, slug }
  })

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.articleTag.deleteMany()
    await tx.tag.deleteMany({})
    if (rows.length > 0) {
      await tx.tag.createMany({ data: rows })
    }
    return deleted.count
  })

  return { imported: rows.length, deleted: result }
}
