import { prisma } from "./db/client"
import type { Prisma } from "@/generated/prisma/client"
import {
  ARTICLE_INCLUDE,
  mapArticle,
  slugify,
  type ArticleListItem,
  type CollectionMeta,
} from "./articles"

export { isUniqueError } from "./articles"

export interface CollectionListItem {
  id: string
  name: string
  slug: string
  description: string | null
  coverImage: string | null
  articleCount: number
  createdAt: Date
}

export interface CollectionArticleItem extends ArticleListItem {
  position: number
}

export interface CollectionDetail extends CollectionListItem {
  articles: CollectionArticleItem[]
}

/** 详情页合集导航项：单个合集内当前文章的位置与前后篇。 */
export interface CollectionNavItem {
  collection: CollectionMeta
  /** 合集内已发布文章总数（按 position 排序后的长度）。 */
  total: number
  /** 当前文章在合集内的位置，从 1 开始。 */
  current: number
  prev: { slug: string; title: string } | null
  next: { slug: string; title: string } | null
}

const COLLECTION_ARTICLES_INCLUDE = {
  articles: {
    include: { article: { include: ARTICLE_INCLUDE } },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.CollectionInclude

export type CollectionWithArticles = Prisma.CollectionGetPayload<{
  include: typeof COLLECTION_ARTICLES_INCLUDE
}>

function mapCollection(
  c: CollectionWithArticles,
  publishedOnly: boolean
): CollectionDetail {
  const list = c.articles
    .filter((ac) => !publishedOnly || ac.article.published)
    .map((ac) => ({ ...mapArticle(ac.article), position: ac.position }))
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    coverImage: c.coverImage,
    articleCount: list.length,
    createdAt: c.createdAt,
    articles: list,
  }
}

export async function getCollections(
  publishedOnly = false
): Promise<CollectionListItem[]> {
  const rows = await prisma.collection.findMany({
    include: {
      _count: {
        select: {
          articles: publishedOnly
            ? { where: { article: { published: true } } }
            : true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    coverImage: c.coverImage,
    articleCount: c._count.articles,
    createdAt: c.createdAt,
  }))
}

export async function getCollectionBySlug(
  slug: string,
  opts: { publishedOnly?: boolean } = {}
): Promise<CollectionDetail | null> {
  const row = await prisma.collection.findUnique({
    where: { slug },
    include: COLLECTION_ARTICLES_INCLUDE,
  })
  if (!row) return null
  return mapCollection(row, opts.publishedOnly ?? false)
}

export async function getCollectionById(
  id: string,
  opts: { publishedOnly?: boolean } = {}
): Promise<CollectionDetail | null> {
  const row = await prisma.collection.findUnique({
    where: { id },
    include: COLLECTION_ARTICLES_INCLUDE,
  })
  if (!row) return null
  return mapCollection(row, opts.publishedOnly ?? false)
}

/** 文章所属的全部合集元信息（含在该合集内的 position）。 */
export async function getCollectionsForArticle(
  articleId: string
): Promise<Array<CollectionMeta & { position: number }>> {
  const rows = await prisma.articleCollection.findMany({
    where: { articleId },
    include: { collection: true },
    orderBy: { position: "asc" },
  })
  return rows.map((ac) => ({
    id: ac.collection.id,
    name: ac.collection.name,
    slug: ac.collection.slug,
    position: ac.position,
  }))
}

/** 详情页合集导航数据：文章所属每个合集的进度与前后篇。 */
export async function getArticleCollectionNav(
  articleId: string
): Promise<CollectionNavItem[]> {
  const memberships = await prisma.articleCollection.findMany({
    where: { articleId },
    include: { collection: true },
    orderBy: { position: "asc" },
  })

  const items: CollectionNavItem[] = []
  for (const m of memberships) {
    const members = await prisma.articleCollection.findMany({
      where: { collectionId: m.collectionId, article: { published: true } },
      include: { article: { select: { slug: true, title: true } } },
      orderBy: { position: "asc" },
    })
    const idx = members.findIndex((x) => x.articleId === articleId)
    if (idx === -1) continue
    items.push({
      collection: {
        id: m.collection.id,
        name: m.collection.name,
        slug: m.collection.slug,
      },
      total: members.length,
      current: idx + 1,
      prev: idx > 0 ? members[idx - 1].article : null,
      next: idx < members.length - 1 ? members[idx + 1].article : null,
    })
  }
  return items
}

export async function createCollection(input: {
  name: string
  slug?: string
  description?: string | null
  coverImage?: string | null
}) {
  return prisma.collection.create({
    data: {
      name: input.name.trim(),
      slug: input.slug?.trim() || slugify(input.name),
      description: input.description ?? null,
      coverImage: input.coverImage ?? null,
    },
  })
}

export async function updateCollection(
  id: string,
  data: {
    name?: string
    slug?: string
    description?: string | null
    coverImage?: string | null
  }
) {
  return prisma.collection.update({ where: { id }, data })
}

export async function deleteCollection(id: string): Promise<void> {
  // 级联删除 article_collections 关联，不影响文章本身
  await prisma.collection.delete({ where: { id } })
}

/** 整体重排合集内文章：position = 数组下标。 */
export async function setCollectionArticles(
  collectionId: string,
  articleIds: string[]
): Promise<void> {
  await prisma.$transaction([
    prisma.articleCollection.deleteMany({ where: { collectionId } }),
    ...(articleIds.length > 0
      ? [
          prisma.articleCollection.createMany({
            data: articleIds.map((articleId, i) => ({
              articleId,
              collectionId,
              position: i,
            })),
          }),
        ]
      : []),
  ])
}

/**
 * 设置文章所属合集：保留已有关系的 position（不破坏合集内顺序），
 * 新加入的合集追加到该合集末尾，被移除的合集删除关系。
 */
export async function setArticleCollections(
  articleId: string,
  collectionIds: string[]
): Promise<void> {
  const unique = [...new Set(collectionIds)]
  const existing = await prisma.articleCollection.findMany({
    where: { articleId },
    select: { articleId: true, collectionId: true, position: true },
  })

  const keep = new Map(
    existing
      .filter((e) => unique.includes(e.collectionId))
      .map((e) => [e.collectionId, e.position])
  )
  const removed = existing.filter(
    (e) => !unique.includes(e.collectionId)
  )

  if (removed.length > 0) {
    await prisma.articleCollection.deleteMany({
      where: {
        OR: removed.map((r) => ({
          articleId: r.articleId,
          collectionId: r.collectionId,
        })),
      },
    })
  }

  for (const collectionId of unique) {
    if (keep.has(collectionId)) continue
    const max = await prisma.articleCollection.aggregate({
      where: { collectionId },
      _max: { position: true },
    })
    await prisma.articleCollection.create({
      data: {
        articleId,
        collectionId,
        position: (max._max.position ?? -1) + 1,
      },
    })
  }
}
