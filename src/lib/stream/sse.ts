export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const

export interface SseHandle {
  /** 发送一个 SSE 数据帧（自动 JSON 序列化）。 */
  send: (data: unknown) => void
  /** 关闭流。 */
  close: () => void
}

/**
 * 创建统一的 SSE ReadableStream：内部统一处理 error 帧与关闭逻辑，
 * 路由只需在 run 里调用 send/close。
 */
export function createSSEStream(
  run: (handle: SseHandle) => Promise<void>
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        await run({ send, close: () => controller.close() })
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误"
        send({ type: "error", error: message })
      } finally {
        try {
          controller.close()
        } catch {
          // 已关闭（正常路径里 run 已 close）
        }
      }
    },
  })
}