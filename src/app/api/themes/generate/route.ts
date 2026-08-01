import { createLLM } from "@/lib/llm"
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages"
import { getMessages, addMessage, getLatestHtml } from "@/lib/theme-session"
import { extractContentConfig } from "@/lib/content-extractor"
import { ensureAvatarOverflow } from "@/lib/content-renderer"
import { getSiteConfig } from "@/lib/site-config"
import { randomUUID } from "crypto"
import type { AIMessageChunk } from "@langchain/core/messages"

export const runtime = "nodejs"

const SYSTEM_PROMPT = `你是一个专业的博客页面设计师。

工作模式：
- 首次生成：根据用户描述生成完整的 HTML 博客页面
- 迭代修改：基于之前的 HTML 和用户的修改意见进行调整，保留不需要修改的部分

输出格式要求（严格遵守）：
1. 先输出你的思考过程，每一步单独一行
2. 然后输出完整的 HTML 页面

思考过程格式示例：
正在分析用户需求...
识别到关键要求：极简风格、白色背景、左侧导航
正在设计页面配色方案...
正在构建 HTML 结构...

然后输出完整的 HTML 页面（包含 DOCTYPE、html、head、body）

HTML 要求：
1. 输出的必须是完整的 HTML 文件，包含 <!DOCTYPE html>、<html>、<head>、<body> 标签
2. 所有样式内联在 <style> 标签中，不依赖外部资源
3. 确保内容有基本的博客结构：标题、正文段落、文章列表、侧边栏（如有）、导航、页脚
4. 用中文内容填充占位文字
5. 样式需精致且具有明确的设计感，遵循下方"设计要求"的风格准则，具有良好的排版与留白
6. 如果用户没有特别说明，默认生成一个简约风格的博客页面（简约也应精炼克制，注重留白、排版细节与质感，而非平淡无设计感）
7. 作者/人物介绍区域的头像容器必须设置 overflow: hidden，且头像内图片使用 object-fit: cover 并填满容器，防止图片溢出圆形头像

设计要求（每次生成都需遵循）：
1. 明确美学方向：先确定一个清晰大胆的设计方向（如极简、杂志编辑风、复古未来、日式侘寂、新艺术几何、工业实用、温柔粉彩、奢雅等），并全程贯彻，避免无风格、千篇一律的"AI 感"设计。简约与华丽都可以，关键是"有意图"而非"强强度"。
2. 排版：避免使用 Arial、Inter、Roboto 等通用无趣的字体。中文博客优先选用有特色的系统字体栈，标题与正文形成对比（如衬线/宋体系标题搭配无衬线正文）。由于不依赖外部资源，只使用系统可用字体。精心设定字号阶梯、行高（中文正文建议 1.7~2）、字距与段落间距。
3. 色彩：用 CSS 变量统一管理配色；确立"主色 + 锐利点缀色"的配色方案，避免均匀平淡的调色板。避免烂大街的配色（如白底紫色渐变）。
4. 背景与视觉细节：不要默认纯白平铺背景，应营造氛围与层次——可搭配渐变、噪点纹理、几何图案、透明叠加、装饰性边框、戏剧性阴影、颗粒覆盖等与主题一致的细节。
5. 空间构图：尝试不对称、错落、重叠、打破栅格的布局；善用充足留白或可控密度。
6. 动效与微交互：用纯 CSS 实现过渡、悬停态与入场动画（如页面加载时的阶梯式揭示，用 animation-delay 错开），提升精致感。
7. 差异化与迭代：根据用户描述选择对应的明暗主题与风格，避免每次生成雷同；迭代修改时保持既有视觉语言，仅按用户要求调整。

内容标记规则：
动态内容区域（文章列表、导航等）必须使用 data-content 和 data-content-type 属性标记。
普通文本区域（标题、段落、页脚等）建议使用 data-content 标记，便于后续编辑。
如果使用了这些属性，请遵循以下分类规则：

类型一 - 静态文本（data-content-type="text"）：
适用于标题、副标题、段落正文、页脚文字等纯文本内容。
用 data-content 属性命名每个字段。

常用字段命名参考：
- blog-title: 博客标题
- blog-subtitle: 博客副标题
- site-description: 站点描述
- author-name: 作者名
- copyright: 版权声明
- footer-text: 页脚文字
- site-url: 站点链接
- total-views: 总访问量
- total-articles: 文章数
- total-likes: 总点赞数

其他字段名可以自由命名。
示例：<h1 data-content="blog-title" data-content-type="text">我的博客</h1>

类型二 - 动态数据列表（data-content-type="dynamic-articles" / "dynamic-categories" / "dynamic-tags"）：
适用于文章列表、分类列表、标签云等需要从数据库获取数据的区域。
容器用 data-content 标记，其首个子元素作为模板。
模板内部使用 data-map 属性标记字段名（如 title、excerpt、date、category、link、name）。
其余子元素作为占位示例会被清除。
示例：
<section data-content="article-list" data-content-type="dynamic-articles">
  <article class="post-card">
    <h3 data-map="title">示例文章标题</h3>
    <span data-map="date">2024-01-15</span>
    <p data-map="excerpt">这是一篇示例文章的内容摘要...</p>
    <a data-map="link" href="/post/1">阅读更多</a>
  </article>
  <article class="post-card"><h3>文章2</h3></article>
</section>

类型三 - 导航链接（data-content-type="nav-list"）：
适用于主导航、底部导航等链接列表。
每个 <a> 标签代表一个导航项。
顶部导航和底部导航是两处独立的区域，必须分别标记，并且 data-content 名称不能重复（顶部用 main-nav，底部用 footer-nav）。
顶部导航示例：
<nav data-content="main-nav" data-content-type="nav-list">
  <a href="/">首页</a>
  <a href="/blog">博客</a>
  <a href="/about">关于</a>
</nav>
底部导航示例（页脚中的链接列表也属于导航）：
<footer>
  <ul data-content="footer-nav" data-content-type="nav-list">
    <li><a href="/">首页</a></li>
    <li><a href="/about">关于</a></li>
  </ul>
</footer>
如果页面包含底部导航或页脚链接列表，请务必用 data-content-type="nav-list" 标记。

建议为博客标题、正文段落、页脚文字等可编辑文本区域添加 data-content 标记。

直接输出内容，不要有任何额外的解释性文字。`

interface GenerateRequest {
  conversationId?: string
  message: string
}

export async function POST(request: Request) {
  try {
    const { conversationId: providedId, message } = (await request.json()) as GenerateRequest

    if (!message?.trim()) {
      return Response.json({ error: "请输入消息内容" }, { status: 400 })
    }

    const conversationId = providedId || randomUUID()

    // Save user message
    await addMessage(conversationId, "user", message)

    // Load history messages
    const historyMessages = await getMessages(conversationId)

    // Get latest HTML for context
    const latestHtml = await getLatestHtml(conversationId)

    // Build LLM messages
    const llmMessages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(SYSTEM_PROMPT),
    ]

    // Add history (skip the just-added user message)
    const historyForLlm = historyMessages.slice(0, -1)
    for (const msg of historyForLlm) {
      if (msg.role === "user") {
        llmMessages.push(new HumanMessage(msg.content))
      } else if (msg.role === "assistant") {
        // Include HTML context in assistant messages
        const content = msg.htmlSnapshot
          ? `${msg.content}\n\n之前生成的 HTML：\n\`\`\`html\n${msg.htmlSnapshot}\n\`\`\``
          : msg.content
        llmMessages.push(new AIMessage(content))
      }
    }

    // Add current user message with HTML context if exists
    let currentMessage = message
    if (latestHtml) {
      currentMessage = `${message}\n\n当前页面的 HTML：\n\`\`\`html\n${latestHtml}\n\`\`\``
    }
    llmMessages.push(new HumanMessage(currentMessage))

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          // Call LLM with streaming enabled
          const llm = createLLM(true)
          const streamIterable = await llm.stream(llmMessages)

          let fullContent = ""

          for await (const chunk of streamIterable) {
            const messageChunk = chunk as AIMessageChunk
            const content = messageChunk.content

            if (typeof content === "string" && content) {
              fullContent += content
              // Send each chunk to the client
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`)
              )
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  fullContent += block.text
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`)
                  )
                }
              }
            }
          }

          // Parse the complete content to extract HTML
          const htmlMatch = fullContent.match(/<!DOCTYPE[\s\S]*$/i)
          const html = htmlMatch ? htmlMatch[0].trim() : ""

          // Extract content config from generated HTML (match against site config)
          let contentConfigJson = ""
          let normalizedHtml = html
          if (html) {
            const siteConfig = await getSiteConfig()
            const result = extractContentConfig(html, siteConfig)
            normalizedHtml = ensureAvatarOverflow(result.htmlTemplate)
            contentConfigJson = JSON.stringify(result.contentConfig)
          }

          // Save assistant message with HTML snapshot and content config
          await addMessage(conversationId, "assistant", fullContent, normalizedHtml, contentConfigJson)

          // Send completion signal with conversation ID and content config
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId, html: normalizedHtml, contentConfig: contentConfigJson })}\n\n`)
          )
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "未知错误"
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`)
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
