import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/crypto"

export const runtime = "nodejs"

export async function GET() {
  try {
    const config = await prisma.lLMConfig.findUnique({ where: { id: 1 } })
    if (!config) {
      return Response.json({
        baseUrl: "",
        model: "",
        apiKey: "",
      })
    }

    return Response.json({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey ? decrypt(config.apiKey) : "",
    })
  } catch {
    return Response.json({
      baseUrl: "",
      model: "",
      apiKey: "",
    })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { baseUrl, model, apiKey } = body

    const encryptedApiKey = apiKey ? encrypt(apiKey) : ""

    await prisma.lLMConfig.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        baseUrl: baseUrl || "",
        model: model || "",
        apiKey: encryptedApiKey,
      },
      update: {
        baseUrl: baseUrl || "",
        model: model || "",
        apiKey: encryptedApiKey,
      },
    })

    return Response.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
