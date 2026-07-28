import { MemorySaver } from "@langchain/langgraph"

const memoryMap = new Map<string, MemorySaver>()

export function getCheckpointer(conversationId: string) {
  if (!memoryMap.has(conversationId)) {
    memoryMap.set(conversationId, new MemorySaver())
  }
  return memoryMap.get(conversationId)!
}
