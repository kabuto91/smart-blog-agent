import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto"
import {
  invalidateVisionConfigCache,
  isVisionConfigured,
} from "@/lib/llm/vision-client"

export const runtime = "nodejs"

export async function GET() {
  try {
    const [config, configured] = await Promise.all([
      prisma.visionConfig.findUnique({ where: { id: 1 } }),
      isVisionConfigured(),
    ])
    if (!config) {
      return Response.json({
        baseUrl: "",
        model: "",
        apiKey: "",
        configured,
      })
    }

    return Response.json({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey ? decrypt(config.apiKey) : "",
      configured,
    })
  } catch {
    const configured = await isVisionConfigured().catch(() => false)
    return Response.json({
      baseUrl: "",
      model: "",
      apiKey: "",
      configured,
    })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { baseUrl, model, apiKey } = body

    const encryptedApiKey = apiKey ? encrypt(apiKey) : ""

    await prisma.visionConfig.upsert({
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

    invalidateVisionConfigCache()

    return Response.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
