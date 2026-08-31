import { prisma } from "@/lib/db/client"
import {
  getUserProfile,
  saveUserProfile,
} from "@/lib/site-config"
import { generateUserProfile, type ProfileArticleInput } from "@/lib/user-profile"

export const runtime = "nodejs"

/** 读取用户画像与注入开关。 */
export async function GET() {
  const { profile, enabled } = await getUserProfile()
  return Response.json({ profile, enabled })
}

interface SaveProfileRequest {
  profile?: unknown
  enabled?: unknown
}

/** 保存用户画像与注入开关。 */
export async function PUT(request: Request) {
  let body: SaveProfileRequest
  try {
    body = (await request.json()) as SaveProfileRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }
  if (typeof body.profile !== "string") {
    return Response.json({ error: "画像内容必须是字符串" }, { status: 400 })
  }
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled)
  const profile = body.profile.trim()
  await saveUserProfile(profile, enabled)
  return Response.json({ success: true, profile, enabled })
}

/** 基于最近已发布文章调用 AI 生成用户画像并保存。 */
export async function POST() {
  try {
    const articles = await prisma.article.findMany({
      where: { published: true },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    })

    if (articles.length === 0) {
      return Response.json({ error: "暂无已发布文章，无法生成画像" }, { status: 400 })
    }

    const inputs: ProfileArticleInput[] = articles.map((a) => ({
      title: a.title,
      excerpt: a.excerpt,
      category: a.category?.name ?? null,
      tags: a.tags.map((t) => t.tag.name),
      contentPreview: a.content.replace(/\s+/g, " ").trim().slice(0, 400),
    }))

    const profile = await generateUserProfile(inputs)

    const { enabled } = await getUserProfile()
    await saveUserProfile(profile, enabled)

    return Response.json({ success: true, profile, articleCount: articles.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: message }, { status: 500 })
  }
}
