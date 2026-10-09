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
 *
 * 客户端断开（刷新/关页/网络中断）时触发 onClientGone，
 * 调用方据此中止正在执行的任务（保留检查点供续生）。
 */
export function createSSEStream(
  run: (handle: SseHandle) => Promise<void>,
  onClientGone?: () => void
): ReadableStream {
  let closed = false
  const markClientGone = () => {
    if (closed) return
    closed = true
    onClientGone?.()
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 写入失败说明连接已断开
          markClientGone()
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      }
      try {
        await run({ send, close })
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误"
        send({ type: "error", error: message })
      } finally {
        close()
      }
    },
    cancel() {
      // 客户端主动断开（刷新/关页/网络中断）
      markClientGone()
    },
  })
}