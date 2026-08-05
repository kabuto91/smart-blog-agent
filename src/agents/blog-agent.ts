import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph"
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt"
import { AIMessage, SystemMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import { createLLM } from "@/lib/llm/client"
import { getCurrentTimeTool } from "./tools/example"
import { callExternalApiTool } from "./tools/api-integration"
import { searchImageTool } from "./tools/image-search"

const SYSTEM_PROMPT = `你是一个智能博客助手 Agent，可以帮助用户：
1. 获取当前时间
2. 调用外部 API 获取数据

请根据用户的需求选择合适的工具来完成任务。回复时使用中文。`

const tools = [
  getCurrentTimeTool,
  callExternalApiTool,
  searchImageTool,
]

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => (Array.isArray(right) ? left.concat(right) : left.concat([right])),
    default: () => [],
  }),
})

export async function createBlogAgent(conversationId: string) {
  const llm = (await createLLM()).bindTools(tools)
  const checkpointer = new MemorySaver()

  const callModel = async (state: typeof StateAnnotation.State) => {
    const messages = [new SystemMessage(SYSTEM_PROMPT), ...state.messages]
    const response = await llm.invoke(messages)
    return { messages: [response] }
  }

  const graph = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition, {
      [END]: END,
      tools: "tools",
    })
    .addEdge("tools", "agent")

  return graph.compile({ checkpointer })
}
