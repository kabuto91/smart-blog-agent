import { createLLM } from "@/lib/llm/client"
import { StateGraph, Annotation, START, END } from "@langchain/langgraph"
import { SystemMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import { JSDOM } from "jsdom"
import { GLOBAL_FIELDS, STAT_FIELDS } from "@/lib/field-registry"

const FIELD_REFERENCE = [
  ...Object.entries(GLOBAL_FIELDS).map(([key, def]) => `- ${key}: ${def.label}`),
  ...Object.entries(STAT_FIELDS).map(([key, def]) => `- ${key}: ${def.label}（只读）`),
].join("\n")

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
2. 所有样式、字体、脚本内联在 <style> 标签中，不依赖外部 CDN；不使用外部图片 URL（禁止使用外部图片地址）
3. 确保内容有基本的博客结构：标题、正文段落、文章列表、侧边栏（如有）、导航、页脚
4. 用中文内容填充占位文字
5. 样式需精致且具有明确的设计感，遵循下方"设计要求"的风格准则，具有良好的排版与留白
6. 如果用户没有特别说明，默认生成一个简约风格的博客页面（简约也应精炼克制，注重留白、排版细节与质感，而非平淡无设计感）
7. 作者/人物介绍区域的头像容器必须设置 overflow: hidden，且头像内图片使用 object-fit: cover 并填满容器，防止图片溢出圆形头像
8. 主题会同时渲染在三个页面：博客首页 /blog（仅显示少量近期文章）、文章列表页 /blog/archive、/blog/category/{slug}、/blog/tag/{slug}（显示全部文章并自动分页）、文章详情页 /blog/{slug}（正文区域替换为文章内容，且只保留导航与页脚，侧边栏与文章列表会被隐藏）。页面之间必须通过 data-page-type 属性彻底分离（详见"内容标记规则-类型二点六"）：
   - 导航（<nav>）、页脚（<footer>）与 <head> 中的样式是三个页面共享的布局，不要打 data-page-type（其它区块必须标记）
   - 所有只在首页出现的区域（hero/banner 介绍区、「近期文章/最新文章」标题头、「查看全部/更多文章」按钮、精选文章、首页专属装饰等）必须标记 data-page-type="home"
   - 「更多文章」按钮应放在文章列表区域之外（不要放在 <nav> 或 <footer> 链接列表中，避免被当作导航项）
   - 导航中可添加「全部文章」链接到 /blog/archive
   - 所有链接必须使用完整路由：/blog、/blog/archive、/blog/category/{slug}、/blog/tag/{slug}、/blog/{slug}

设计要求（每次生成都需遵循）：
1. 明确美学方向：先确定一个清晰大胆的设计方向（如极简、杂志编辑风、复古未来、日式侘寂、新艺术几何、工业实用、温柔粉彩、奢雅等），并全程贯彻，避免无风格、千篇一律的"AI 感"设计。简约与华丽都可以，关键是"有意图"而非"强强度"。
2. 排版：避免使用 Arial、Inter、Roboto 等通用无趣的字体。中文博客优先选用有特色的系统字体栈，标题与正文形成对比（如衬线/宋体系标题搭配无衬线正文）。由于不依赖外部资源，只使用系统可用字体。精心设定字号阶梯、行高（中文正文建议 1.7~2）、字距与段落间距。
3. 色彩：用 CSS 变量统一管理配色；确立"主色 + 锐利点缀色"的配色方案，避免均匀平淡的调色板。避免烂大街的配色（如白底紫色渐变）。
4. 背景与视觉细节：不要默认纯白平铺背景，应营造氛围与层次——可搭配渐变、噪点纹理、几何图案、透明叠加、装饰性边框、戏剧性阴影、颗粒覆盖等与主题一致的细节。
5. 空间构图：尝试不对称、错落、重叠、打破栅格的布局；善用充足留白或可控密度。
6. 动效与微交互：用纯 CSS 实现过渡、悬停态与入场动画（如页面加载时的阶梯式揭示，用 animation-delay 错开），提升精致感。
7. 差异化与迭代：根据用户描述选择对应的明暗主题与风格，避免每次生成雷同；迭代修改时保持既有视觉语言，仅按用户要求调整。

工具使用规则：
- 不使用任何外部图片 URL，也不要编造图片地址；没有可用图片素材时，直接以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计即可。

内容标记规则：
动态内容区域（文章列表、导航等）必须使用 data-content 和 data-content-type 属性标记。
普通文本区域（标题、段落、页脚等）建议使用 data-content 标记，便于后续编辑。
如果使用了这些属性，请遵循以下分类规则：

类型一 - 静态文本（data-content-type="text"）：
适用于标题、副标题、段落正文、页脚文字等纯文本内容。
用 data-content 属性命名每个字段。

常用字段命名参考：
${FIELD_REFERENCE}

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
文章列表区域会自动适配：首页 /blog 仅填充少量近期文章（不分页），文章列表页 /blog/archive、/blog/category/{slug}、/blog/tag/{slug} 填充全部文章并自动附加分页导航，无需额外处理。
注意：文章列表上方的「近期文章/最新文章」标题头属于首页专属内容，必须标记 data-page-type="home"（否则会出现在列表页）。若希望列表页有独立标题，可用 data-page-type 提供不同页面的变体（见类型二点六）。

类型二点五 - 文章正文（data-content-type="article-body"）：
【必须】页面中必须包含一个用于文章详情页正文的区域。容器用 data-content="article-body" 标记，文章详情页会把该区域整段替换为 markdown 渲染后的正文 HTML。该区域之外应同时包含文章的标题、日期、分类等展示元素（可用 data-map 绑定或占位文本，详情页同样会被数据覆盖）。
详情页渲染时会：只保留导航与页脚，自动隐藏侧边栏、文章列表及其他首页/列表专属内容。因此侧边栏请使用 <aside> 标签（便于识别隐藏），导航/页脚为所有页面共享，无需标记。
示例：
<article data-content="article-body" data-content-type="article-body">
  <h2>文章标题</h2>
  <p>这里的内容会被文章正文替换...</p>
</article>

类型二点六 - 页面分区（data-page-type）【强烈建议每个主要区块都声明】：
主题由同一个 HTML 渲染成首页 /blog、列表页 /blog/archive 等、详情页 /blog/{slug} 三种页面，必须用 data-page-type 声明每个区域属于哪个页面，实现彻底分离：
- data-page-type="home"：只在首页显示的区域（hero/banner 介绍区、「近期文章/最新文章」标题头、「查看全部/更多文章」按钮、精选文章、首页专属装饰、首页统计等）
- data-page-type="list"：只在列表页显示的区域（如「全部文章」标题）
- data-page-type="detail"：只在详情页显示的区域
- 不标记 = 三个页面共享（导航、页脚、侧边栏、作者卡片、分类、标签等）
一个元素可同时声明多个页面，用空格分隔，如 data-page-type="home list"。
示例（首页「近期文章」标题头 + 「查看全部」按钮标记为仅首页）：
<div class="section-header" data-page-type="home">
  <h3>近期文章</h3>
  <a href="/blog/archive">查看全部 →</a>
</div>
若希望列表页显示不同标题，可在同一区域为不同页面提供变体：
<div class="section-header">
  <h3 data-page-type="home">近期文章</h3>
  <h3 data-page-type="list">全部文章</h3>
</div>
旧写法 data-home-only 等价于 data-page-type="home"，仍然支持。

类型三 - 导航链接（data-content-type="nav-list"）：
适用于主导航、底部导航等链接列表。
每个 <a> 标签代表一个导航项。
顶部导航和底部导航是两处独立的区域，必须分别标记，并且 data-content 名称不能重复（顶部用 main-nav，底部用 footer-nav）。
顶部导航示例：
<nav data-content="main-nav" data-content-type="nav-list">
  <a href="/blog">首页</a>
  <a href="/blog/archive">全部文章</a>
  <a href="/about">关于</a>
</nav>
底部导航示例（页脚中的链接列表也属于导航）：
<footer>
  <ul data-content="footer-nav" data-content-type="nav-list">
    <li><a href="/blog">首页</a></li>
    <li><a href="/about">关于</a></li>
  </ul>
</footer>
如果页面包含底部导航或页脚链接列表，请务必用 data-content-type="nav-list" 标记。

建议为博客标题、正文段落、页脚文字等可编辑文本区域添加 data-content 标记。

直接输出内容，不要有任何额外的解释性文字。`

/** 从模型输出中提取完整的 HTML 页面（含 DOCTYPE）。 */
export function extractHtmlFromContent(content: string): string {
  const pick = (s: string | undefined): string => (s ? s.trim() : "")

  const fencedAtEnd = content.match(/```(?:html|htm)?\s*\n([\s\S]*?)(?:\n)?```\s*$/i)
  if (fencedAtEnd && /<[a-zA-Z!\/]/.test(fencedAtEnd[1])) return pick(fencedAtEnd[1])

  const doctype = content.match(/<!DOCTYPE[\s\S]*$/i)
  if (doctype) return pick(doctype[0].replace(/```(?:html|htm)?\s*$/i, ""))

  const htmlTag = content.match(/<html[\s>][\s\S]*$/i)
  if (htmlTag) return pick(htmlTag[0])

  const bodyTag = content.match(/<body[\s>][\s\S]*$/i)
  if (bodyTag) return pick(bodyTag[0])

  const anyFenced = content.match(/```(?:html|htm)?\s*\n([\s\S]*?)\n```/i)
  if (anyFenced && /<[a-zA-Z!\/]/.test(anyFenced[1])) return pick(anyFenced[1])

  const anyTag = content.match(/<[a-zA-Z][\s\S]*$/i)
  if (anyTag) return pick(anyTag[0].replace(/```(?:html|htm)?\s*$/i, ""))

  return ""
}

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => (Array.isArray(right) ? left.concat(right) : left.concat([right])),
    default: () => [],
  }),
})

export type ThemePageType = "home" | "list" | "detail"

const SKELETON_SYSTEM_PROMPT = `你是一个专业的博客主题设计师，任务分为两阶段：
1. 本阶段只负责产出【主题骨架】——即共享布局 HTML（包含 <!DOCTYPE html>、<html>、<head>、<body>）。
2. 后续阶段会基于这份骨架，并行生成三个页面的正文（首页 /blog、列表页 /blog/archive、详情页 /blog/{slug}），填入骨架的正文占位节点。

【骨架应包含】
1. <head> 中的完整 <style>：这是整站设计系统，所有页面共享。
   - 用 CSS 变量（:root）统一管理配色、字体、字号阶梯、行高、间距、圆角、阴影、动效参数
   - 定义正文会用到的通用类：容器（.container/.wrap/.section）、标题（.section-title/.page-title/.post-title）、卡片（.post-card）、按钮（.btn）、hero 区（.hero）、文章网格、列表、侧边栏（.sidebar）、文章详情（.article-header/.article-body/.article-cover）、标签等
   - 设计感要求：明确美学方向（极简/杂志/复古/日式/工业/粉彩/奢雅等），避免"AI 感"平淡设计；排版有对比（中文标题选有特色的系统字体栈）；色彩"主色+锐利点缀色"；背景不默认纯白（可用渐变/噪点/几何/颗粒营造层次）；用纯 CSS 做过渡与入场动效
2. 站点导航 <nav>：用 data-content="main-nav" data-content-type="nav-list" 标记，包含到 /blog、/blog/archive、/blog/category/{slug}、/blog/tag/{slug}、/blog/{slug} 的完整路由
3. 页脚 <footer>：含链接列表（可选 data-content="footer-nav" data-content-type="nav-list"）
4. body 中【必须】包含一个正文占位节点，且仅此一个：
   <div data-page-host=""></div>
   后续三个页面的正文会被依次填入这里。除该占位节点外，骨架不要包含其它正文内容。

【图片规则】
- 不使用任何外部图片 URL，也不要编造图片地址；没有可用图片素材时，直接以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计即可。

【内容标记规则】
- 导航/页脚等链接列表用 data-content + data-content-type="nav-list" 标记。
- 静态文本（标题、页脚文字）建议用 data-content + data-content-type="text" 标记。
常用字段命名参考：
${FIELD_REFERENCE}

直接输出内容，不要有任何额外的解释性文字。`

const PAGE_SPEC: Record<
  ThemePageType,
  { context: string; bodyPrompt: string }
> = {
  home: {
    context: "博客首页 /blog",
    bodyPrompt: `生成优质首页正文，包含：hero/介绍区（可配图）、精选文章、近期文章卡片列表、统计与作者简介栏等。
文章列表用 <section data-content="article-list" data-content-type="dynamic-articles"> 包裹，其首个子元素为模板，字段用 data-map 标记（如 title、excerpt、date、category、link），其余示例项会被清除并替换为真实数据。`,
  },
  list: {
    context: "文章列表页 /blog/archive 等",
    bodyPrompt: `生成完整的文章列表正文：顶部一个「全部文章」标题，下方用 data-content-type="dynamic-articles" 的动态文章列表（列表会自动填充全部文章并附加分页，正文不要写分页）。`,
  },
  detail: {
    context: "文章详情页 /blog/{slug}",
    bodyPrompt: `生成文章详情页正文：包含文章标题、日期、分类等展示元素，并【必须】有一个正文容器：
<article data-content="article-body" data-content-type="article-body">
  <h2 data-map="title">文章标题</h2>
  <span data-map="date">2024-01-01</span>
  <span data-map="category">分类</span>
  <div data-map="body">这里会被渲染后的正文替换</div>
</article>
详情页只会保留导航、页脚与该正文区域（侧边栏、列表会被隐藏），因此正文不要写侧边栏。
标题/排版/容器直接用骨架已有的类（如 .container/.article-header/.article-body/.post-title）；不要自建 .article-hero 之类的独立类。`,
  },
}

/**
 * 从骨架 HTML 提炼出紧凑的"视觉契约"，供各页面生成器参考，
 * 避免把整份骨架 HTML 重复注入每个页面 prompt。
 */
export function buildPagePromptContext(skeletonHtml: string): string {
  const dom = new JSDOM(skeletonHtml)
  const doc = dom.window.document

  const styles: string[] = []
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) styles.push(style.textContent)
  }
  const css = styles.join("\n").slice(0, 6000)

  const navLinks: string[] = []
  for (const el of Array.from(doc.querySelectorAll("nav a"))) {
    const href = el.getAttribute("href") ?? ""
    const text = el.textContent?.trim() ?? ""
    if (href) navLinks.push(`${text} -> ${href}`)
  }

  const parts: string[] = []
  parts.push(`主题共享骨架的完整 CSS 类库与设计变量（配色、字体、间距、动效参数都必须从中选取并保持一致）：\n\`\`\`css\n${css || "（无 CSS）"}\n\`\`\``)
  if (navLinks.length) {
    parts.push(`骨架导航链接（在正文中复用，保证路由一致）：\n${navLinks.join("\n")}`)
  }
  parts.push(`硬性约束（必须严格遵守）：
- 只输出 body 内的页面正文，不要输出 <!DOCTYPE html>、<html>、<head>、<body>；
- 不要输出任何 <style>、<script>、<link>、<meta>、<title> 标签；
- 不要输出 <nav>、<header>、<footer>（它们由布局统一提供）；
- 正文的类名必须从骨架的 CSS 类库中选取，不要自创独立的页面类名或设计系统，否则会失去样式；
- 顶部不要自己写 fixed 导航的留白（padding-top/margin-top 让位导航），布局已统一处理该间距。`)
  return parts.join("\n\n")
}

/** 骨架阶段 agent：产出共享布局（head 样式 + 导航 + 页脚 + data-page-host 占位）。 */
export async function createSkeletonAgent() {
  const llm = await createLLM(true)

  const callModel = async (state: typeof StateAnnotation.State) => {
    const messages = [new SystemMessage(SKELETON_SYSTEM_PROMPT), ...state.messages]
    const response = await llm.invoke(messages)
    return { messages: [response] }
  }

  const graph = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addEdge(START, "agent")
    .addEdge("agent", END)

  return graph.compile()
}

/** 页面阶段 agent：基于视觉契约产出某一页正文（home/list/detail）。 */
export async function createPageAgent(
  pageType: ThemePageType,
  context: string
) {
  const spec = PAGE_SPEC[pageType]
  const systemPrompt = `你是一个博客「${spec.context}」的正文设计者。请基于给定的共享骨架（其样式/类名/设计语言已由骨架阶段产出）输出该页面正文。

${context}

【正文要求】
${spec.bodyPrompt}

【内容标记规则】
动态内容区域（文章列表等）必须使用 data-content 和 data-content-type 属性标记，容器首个子元素作为模板，模板内用 data-map 标记字段名（如 title、excerpt、date、category、link）。
普通文本区域（标题、段落、页脚文字等）建议用 data-content + data-content-type="text" 标记，便于后续编辑。
常用字段命名参考：
${FIELD_REFERENCE}
示例：<h1 data-content="blog-title" data-content-type="text">我的博客</h1>

【图片规则】
不使用任何外部图片 URL，也不要编造图片地址；没有可用图片素材时，直接以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计。

用中文填充占位内容，保持精致设计与骨架视觉语言完全一致。直接输出正文 HTML，不要额外解释性文字。`

  const llm = await createLLM(true)

  const callModel = async (state: typeof StateAnnotation.State) => {
    const messages = [new SystemMessage(systemPrompt), ...state.messages]
    const response = await llm.invoke(messages)
    return { messages: [response] }
  }

  const graph = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addEdge(START, "agent")
    .addEdge("agent", END)

  return graph.compile()
}

export async function createThemeAgent() {
  const llm = await createLLM(true)

  const callModel = async (state: typeof StateAnnotation.State) => {
    const messages = [new SystemMessage(SYSTEM_PROMPT), ...state.messages]
    const response = await llm.invoke(messages)
    return { messages: [response] }
  }

  const graph = new StateGraph(StateAnnotation)
    .addNode("agent", callModel)
    .addEdge(START, "agent")
    .addEdge("agent", END)

  return graph.compile()
}