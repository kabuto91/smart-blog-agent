import { getUpload } from "@/lib/uploads"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const upload = await getUpload(id)
    if (!upload) {
      return Response.json({ error: "图片不存在" }, { status: 404 })
    }

    const buffer = Buffer.from(upload.data, "base64")

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": upload.mimeType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
