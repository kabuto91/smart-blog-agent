import { createVisionLLM } from "@/lib/llm/vision-client"
import { HumanMessage } from "@langchain/core/messages"

export const runtime = "nodejs"

export async function POST() {
  try {
    const llm = await createVisionLLM()
    llm.maxTokens = 1
    const response = await llm.invoke([new HumanMessage("hi")])

    return Response.json({
      success: true,
      message: "视觉模型连接正常",
      response: response.content,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json(
      {
        success: false,
        message: msg,
      },
      { status: 500 }
    )
  }
}
