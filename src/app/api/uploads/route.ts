import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_SIZE, saveUpload } from "@/lib/uploads"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return Response.json({ error: "缺少文件" }, { status: 400 })
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return Response.json({ error: "仅支持 png、jpeg、webp、gif、svg 格式的图片" }, { status: 400 })
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return Response.json({ error: "图片大小不能超过 5MB" }, { status: 413 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const data = Buffer.from(arrayBuffer).toString("base64")

    const upload = await saveUpload(file.name || "image", file.type, data)

    return Response.json({ url: `/api/uploads/${upload.id}` }, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
