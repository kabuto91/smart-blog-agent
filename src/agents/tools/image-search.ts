import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { saveUpload } from "@/lib/uploads"

const SOURCE_URL = "https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1"
const USER_AGENT = "SmartBlogAgent/1.0 (theme image search)"
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15000
const MIN_WIDTH = 400
const MAX_WIDTH = 3000
const MAX_HEIGHT = 4000

interface SafebooruPost {
  id: number
  width: number
  height: number
  sample: boolean
  sample_url: string
  file_url: string
  rating: string
  tags: string
}

interface SearchResult {
  url: string
  width: number
  height: number
  title: string
}

function guessMimeType(url: string, contentType?: string): string {
  if (contentType) {
    const mime = contentType.split(";")[0].trim().toLowerCase()
    if (mime) return mime
  }
  const ext = url.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  if (ext === "svg") return "image/svg+xml"
  return "image/jpeg"
}

async function searchPosts(query: string, limit: number): Promise<SafebooruPost[]> {
  const url = `${SOURCE_URL}&limit=${limit}&tags=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`图片搜索接口返回 ${response.status}`)
  }
  const data = (await response.json()) as unknown
  if (!Array.isArray(data)) {
    throw new Error("图片搜索接口返回了意外的数据格式")
  }
  return data as SafebooruPost[]
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const contentLength = Number(response.headers.get("content-length") || 0)
    if (contentLength > MAX_IMAGE_BYTES) return null

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null

    return {
      buffer,
      mimeType: guessMimeType(url, response.headers.get("content-type") ?? undefined),
    }
  } catch {
    return null
  }
}

async function searchAndSaveImages(input: { query: string; count: number }): Promise<string> {
  const { query, count } = input
  const limit = Math.min(Math.max(count, 1), 6)

  try {
    const posts = await searchPosts(query, limit * 2)
    const results: SearchResult[] = []

    for (const post of posts) {
      if (results.length >= limit) break

      const { width, height } = post
      if (!width || !height) continue
      if (width < MIN_WIDTH || width > MAX_WIDTH) continue
      if (height > MAX_HEIGHT) continue
      if (post.rating !== "general") continue

      const imageUrl = post.sample ? post.sample_url : post.file_url
      const download = await downloadImage(imageUrl)
      if (!download) continue

      const ext = imageUrl.split(".").pop()?.toLowerCase() || "jpg"
      const upload = await saveUpload(
        `safebooru-${post.id}.${ext}`,
        download.mimeType,
        download.buffer.toString("base64")
      )

      results.push({
        url: `/api/uploads/${upload.id}`,
        width,
        height,
        title: post.tags.split(" ").slice(0, 8).join(", "),
      })
    }

    if (results.length === 0) {
      return "没有找到符合条件的二次元图片。请尝试更换更常见、更宽泛的英文标签（如 landscape、scenery、original、1girl 等），或减少 count 数量。"
    }

    return `成功搜索到 ${results.length} 张二次元图片（已自动保存到本站，可直接用于 <img src> 或 CSS background-image）:\n${JSON.stringify(
      results,
      null,
      2
    )}\n请从中挑选最合适的图片，把 url 直接写入主题 HTML 中。`
  } catch (error) {
    return `图片搜索失败: ${error instanceof Error ? error.message : String(error)}`
  }
}

export const searchImageTool = tool(searchAndSaveImages, {
  name: "search_image",
  description:
    "搜索二次元(anime)风格的图片素材。当主题设计需要图片（如 Hero/横幅背景图、作者头像、文章缩略图、插画装饰等）时调用。搜索到的图片会自动下载并保存到本站，返回 /api/uploads/ 开头的本地地址，可直接写入 <img> 标签或 CSS background-image。建议使用英文标签提高命中率，多个标签用空格分隔。",
  schema: z.object({
    query: z.string().describe("英文标签或关键词，多个用空格分隔，如：blue_sky 1girl landscape"),
    count: z.number().int().min(1).max(6).default(3).describe("需要返回的图片数量"),
  }),
})
