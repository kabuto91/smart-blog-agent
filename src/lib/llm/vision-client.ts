import { ChatOpenAI } from "@langchain/openai"
import { prisma } from "../db/client"
import { decrypt } from "../crypto"

let cachedConfig: { baseUrl: string; model: string; apiKey: string } | null = null

async function getVisionConfig() {
  if (cachedConfig) {
    return cachedConfig
  }

  try {
    const config = await prisma.visionConfig.findUnique({ where: { id: 1 } })
    if (config) {
      cachedConfig = {
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey: config.apiKey ? decrypt(config.apiKey) : "",
      }
      return cachedConfig
    }
  } catch {
    // table may not exist yet
  }

  return null
}

export function invalidateVisionConfigCache() {
  cachedConfig = null
}

/** 是否已配置视觉模型（凭证 apiKey 来自数据库或环境变量兜底）。 */
export async function isVisionConfigured(): Promise<boolean> {
  const dbConfig = await getVisionConfig()
  return Boolean(dbConfig?.apiKey || process.env.QWEN_API_KEY)
}

export async function createVisionLLM(streaming = false) {
  const dbConfig = await getVisionConfig()

  const modelName = dbConfig?.model || "qwen-vl-max"
  const baseURL =
    dbConfig?.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const apiKey = dbConfig?.apiKey || process.env.QWEN_API_KEY

  return new ChatOpenAI({
    modelName,
    configuration: { baseURL },
    apiKey,
    temperature: 0.7,
    streaming,
  })
}
