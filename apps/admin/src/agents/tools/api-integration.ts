import { tool } from "@langchain/core/tools"
import { z } from "zod"

export const callExternalApiTool = tool(
  async (input) => {
    const { url, method, body } = input
    try {
      const response = await fetch(url, {
        method: method || "GET",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.text()
      return `API 响应 (${response.status}): ${data.substring(0, 2000)}`
    } catch (error) {
      return `API 调用失败: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: "call_external_api",
    description: "调用外部 REST API。用于获取或提交外部服务的数据。",
    schema: z.object({
      url: z.string().describe("API 端点 URL"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP 方法"),
      body: z.any().optional().describe("请求体（POST/PUT/PATCH 时使用）"),
    }),
  }
)
