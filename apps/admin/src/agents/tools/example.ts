import { tool } from "@langchain/core/tools"
import { z } from "zod"

export const getCurrentTimeTool = tool(
  async () => {
    const now = new Date()
    return `当前时间: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
  },
  {
    name: "get_current_time",
    description: "获取当前的日期和时间（北京时间）",
    schema: z.object({}),
  }
)
