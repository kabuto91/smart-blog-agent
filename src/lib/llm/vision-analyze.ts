import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { createVisionLLM } from "./vision-client"

const ANALYZE_SYSTEM_PROMPT = `你是一个专业的视觉设计分析专家。请分析这张图片，提取以下设计特征，用中文输出：

1. 整体风格（如：极简、复古、杂志风、日式、工业风、粉彩、奢雅等）
2. 配色方案（主色、辅色、点缀色的色值或描述）
3. 布局特点（如：左右分栏、卡片式、全屏hero、单列等）
4. 排版特征（字体风格、字号对比、行距等）
5. 视觉元素（如：渐变、阴影、圆角、纹理、几何图案等）
6. 氛围感受（如：温暖、冷峻、活泼、沉稳等）

请用简洁的语言描述，每项一行，格式为"项目：描述"。不要输出额外的解释。`

export async function analyzeImage(
  imageBase64: string,
  mimeType: string
): Promise<string> {
  const llm = await createVisionLLM()

  const dataUrl = `data:${mimeType};base64,${imageBase64}`

  const response = await llm.invoke([
    new SystemMessage(ANALYZE_SYSTEM_PROMPT),
    new HumanMessage({
      content: [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        {
          type: "text",
          text: "请分析这张图片的设计特征。",
        },
      ],
    }),
  ])

  const content = response.content
  return typeof content === "string" ? content : JSON.stringify(content)
}
