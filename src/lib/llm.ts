import { ChatOpenAI } from "@langchain/openai"
import { prisma } from "./db"
import { decrypt } from "./crypto"

let cachedConfig: { baseUrl: string; model: string; apiKey: string } | null = null

async function getLLMConfig() {
  if (cachedConfig) {
    return cachedConfig
  }

  try {
    const config = await prisma.lLMConfig.findUnique({ where: { id: 1 } })
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

export function invalidateLLMConfigCache() {
  cachedConfig = null
}

export async function createLLM(streaming = false) {
  const dbConfig = await getLLMConfig()

  const modelName = dbConfig?.model || process.env.QWEN_MODEL || "qwen-plus"
  const baseURL = dbConfig?.baseUrl || process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const apiKey = dbConfig?.apiKey || process.env.QWEN_API_KEY

  return new ChatOpenAI({
    modelName,
    configuration: { baseURL },
    apiKey,
    temperature: 0.7,
    streaming,
  })
}
