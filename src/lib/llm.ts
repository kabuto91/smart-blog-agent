import { ChatOpenAI } from "@langchain/openai"

export function createLLM() {
  return new ChatOpenAI({
    modelName: process.env.QWEN_MODEL || "qwen-plus",
    configuration: {
      baseURL: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    apiKey: process.env.QWEN_API_KEY,
    temperature: 0.7,
  })
}
