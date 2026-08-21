import { JSDOM } from "jsdom"
import { GLOBAL_FIELDS, STAT_FIELDS } from "@/lib/field-registry"

export const FIELD_REFERENCE = [
  ...Object.entries(GLOBAL_FIELDS).map(([key, def]) => `- ${key}: ${def.label}`),
  ...Object.entries(STAT_FIELDS).map(([key, def]) => `- ${key}: ${def.label}（只读）`),
].join("\n")

export type ThemePageType = "home" | "list" | "detail"

export const PAGE_TYPES: ThemePageType[] = ["home", "list", "detail"]

export function pageTypeLabel(pageType: ThemePageType): string {
  switch (pageType) {
    case "home":
      return "首页"
    case "list":
      return "文章列表页"
    case "detail":
      return "文章详情页"
  }
}

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

export const SKELETON_SYSTEM_PROMPT = `你是一个专业的博客主题设计师，任务分为两阶段：
1. 本阶段只负责产出【主题骨架】——即共享布局 HTML（包含 <!DOCTYPE html>、<html>、<head>、<body>）。
2. 后续阶段会基于这份骨架，并行生成三个页面的正文（首页 /blog、列表页 /blog/archive、详情页 /blog/{slug}），填入骨架的正文占位节点。

【骨架应包含】
1. <head> 中的完整 <style>：这是整站设计系统，所有页面共享。
   - 用 CSS 变量（:root）统一管理配色、字体、字号阶梯、行高、间距、圆角、阴影、动效参数
   - 定义正文会用到的通用类：容器（.container/.wrap/.section）、标题（.section-title/.page-title/.post-title）、卡片（.post-card）、按钮（.btn）、hero 区（.hero）、文章网格、列表、侧边栏（.sidebar）、文章详情（.article-header/.article-body）、标签等
   - 设计感要求：明确美学方向（极简/杂志/复古/日式/工业/粉彩/奢雅等），避免"AI 感"平淡设计；排版有对比（中文标题选有特色的系统字体栈）；色彩"主色+锐利点缀色"；背景不默认纯白（可用渐变/噪点/几何/颗粒营造层次）；用纯 CSS 做过渡与入场动效
   - 【导航留白契约】:root 中必须定义 --nav-h（等于导航自身的实际高度，单位 px，例如 --nav-h: 72px）。若导航为 position: fixed，页面正文将由布局读取该变量自动让位，.data-page-host 无需、也不应自行写 padding-top。
2. 站点导航 <nav>：用 data-content="main-nav" data-content-type="nav-list" 标记，包含到 /blog、/blog/archive、/blog/category/{slug}、/blog/tag/{slug}、/blog/{slug} 的完整路由。若导航固定于视口顶部（position:fixed 或 sticky），必须把：root 中的 --nav-h 定义为导航真实高度。导航品牌区（品牌名/logo 所在）需放置作者头像占位：<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充），并在 CSS 中为 .avatar 定义圆形样式（overflow:hidden + 内部 img object-fit:cover）。
3. 页脚 <footer>：含链接列表（可选 data-content="footer-nav" data-content-type="nav-list"）
4. body 中【必须】包含一个正文占位节点，且仅此一个：
   <div data-page-host=""></div>
   后续三个页面的正文会被依次填入这里。除该占位节点外，骨架不要包含其它正文内容。

【图片规则】
- 不要使用任何图片素材（包括外部图片 URL 或编造的图片地址），一律以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计。
- 唯一允许的例外是作者头像占位 <img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充，见上方导航要求）。

【内容标记规则】
- 导航/页脚等链接列表用 data-content + data-content-type="nav-list" 标记。
- 静态文本（标题、页脚文字）建议用 data-content + data-content-type="text" 标记。
常用字段命名参考：
${FIELD_REFERENCE}

【间距规范】
- 章节（section）的 padding-top 和 padding-bottom 控制在 24~40px，不要超过 48px
- 标题与内容之间的 gap 控制在 12~20px
- 卡片网格（post-grid 等）的 gap 控制在 16~24px
- hero 区域 padding-top 建议 32~48px，padding-bottom 建议 24~32px
- footer 与正文之间的 margin-top 建议 32~48px
- 整体风格紧凑精致，避免大面积空白；间距要让人感觉"透气但不松散"

直接输出内容，不要有任何额外的解释性文字。`

const PAGE_SPEC: Record<
  ThemePageType,
  { context: string; bodyPrompt: string }
> = {
  home: {
    context: "博客首页 /blog",
    bodyPrompt: `生成优质首页正文，包含：hero/介绍区（可配图）、精选文章、近期文章卡片列表、统计与作者简介栏等。
文章列表用 <section data-content="article-list" data-content-type="dynamic-articles"> 包裹；【必须】动态区的首个子元素是单个列表项模板（如 <li> 或 <article>，内部用 data-map 标记 title、excerpt、date、category、link 等字段）。「近期文章」标题、包裹列表的 <ul>/<div>、底部按钮等静态结构放在模板项的同级位置（模板项之外），不要包在模板项里面。其余示例项会被清除并替换为真实数据。
【必须】在作者简介/关于区域放置头像占位：<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充）。该头像区域不要标记 data-page-type（确保列表页也能显示）。`,
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
标题/排版/容器直接用骨架已有的类（如 .container/.article-header/.article-body/.post-title）；不要自建 .article-hero 之类的独立类。
【建议】在文章底部作者信息区放置头像占位：<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充），该元素不要标记 data-page-type。`,
  },
}

/** 页面阶段 agent 的系统提示词：基于视觉契约产出某一页正文。 */
export function buildPageSystemPrompt(
  pageType: ThemePageType,
  context: string
): string {
  const spec = PAGE_SPEC[pageType]
  const imageRule =
    pageType === "detail"
      ? `【图片规则】
本页（文章详情页）正文不含封面或配图，文章配图会随正文内容自动渲染（data-map="body"）。不要使用任何图片素材。底部可放置作者头像占位：<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充；该元素不要标记 data-page-type）。`
      : `【图片规则】
不要使用任何图片素材（包括外部图片 URL 或编造的图片地址），一律以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计。
唯一允许的例外是作者头像占位：<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">（src 留空，渲染时自动填充；【必须】在首页 hero/作者简介栏放置，与骨架导航中的头像共用同一 data-content，会同时填充；该头像区域不要标记 data-page-type，确保所有页面都能显示）。`

  return `你是一个博客「${spec.context}」的正文设计者。请基于给定的共享骨架（其样式/类名/设计语言已由骨架阶段产出）输出该页面正文。

${context}

【正文要求】
${spec.bodyPrompt}

【内容标记规则】
动态内容区域（文章列表等）必须使用 data-content 和 data-content-type 属性标记，容器首个子元素作为模板，模板内用 data-map 标记字段名（如 title、excerpt、date、category、link）。
普通文本区域（标题、段落、页脚文字等）建议用 data-content + data-content-type="text" 标记，便于后续编辑。
常用字段命名参考：
${FIELD_REFERENCE}
示例：<h1 data-content="blog-title" data-content-type="text">我的博客</h1>

${imageRule}

用中文填充占位内容，保持精致设计与骨架视觉语言完全一致。直接输出正文 HTML，不要额外解释性文字。`
}

/**
 * 从骨架 HTML 提炼出紧凑的"视觉契约"，供各页面生成器参考，
 * 避免把整份骨架 HTML 重复注入每个页面 prompt。
 */
export function buildPagePromptContext(
  skeletonHtml: string,
  pageType?: ThemePageType
): string {
  const dom = new JSDOM(skeletonHtml)
  const doc = dom.window.document

  const styles: string[] = []
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) styles.push(style.textContent)
  }
  // 尽量保留完整 CSS；仅在超出安全长度时截断，但类名清单始终完整下发。
  const MAX_CSS_CHARS = 16000
  const cssFull = styles.join("\n")
  const css = cssFull.slice(0, MAX_CSS_CHARS)

  const navLinks: string[] = []
  for (const el of Array.from(doc.querySelectorAll("nav a"))) {
    const href = el.getAttribute("href") ?? ""
    const text = el.textContent?.trim() ?? ""
    if (href) navLinks.push(`${text} -> ${href}`)
  }

  const classManifest = getManifestClasses(skeletonHtml, {
    // 详情页不展示封面相关类，避免诱导生成封面/头图区块
    exclude:
      pageType === "detail" ? (cls) => /\bcover\b/i.test(cls) : undefined,
  })
  const manifestText =
    classManifest.length > 0
      ? classManifest.join(", ")
      : "（骨架未提供类名，仅使用骨架 CSS 中定义的基础标签样式）"

  const parts: string[] = []
  parts.push(`主题共享骨架的完整 CSS 类库与设计变量（配色、字体、间距、动效参数都必须从中选取并保持一致）：\n\`\`\`css\n${css || "（无 CSS）"}\n\`\`\``)
  parts.push(`骨架已有的可复用类名清单（正文只能使用以下类名，禁止自创其它类名或样式）：\n${manifestText}\n以上类名清单优先于 CSS 中被截断的部分，务必从中选取。`)
  if (navLinks.length) {
    parts.push(`骨架导航链接（在正文中复用，保证路由一致）：\n${navLinks.join("\n")}`)
  }
  parts.push(`硬性约束（必须严格遵守）：
- 只输出 body 内的页面正文，不要输出 <!DOCTYPE html>、<html>、<head>、<body>；
- 不要输出任何 <style>、<script>、<link>、<meta>、<title> 标签；不要使用 !important；不要书写自定义 @media 规则（响应式已由骨架统一处理）；
- 不要输出 <nav>、<header>、<footer>（它们由布局统一提供）；
- 正文的类名必须从上述"可复用类名清单"中选取，禁止自创新的页面类名、禁止对骨架类名的类写样式覆盖，否则会与骨架样式冲突并失去样式；
- 顶部不要自己写 fixed 导航的留白（padding-top/margin-top 让位导航），布局已通过 --nav-h 统一处理该间距。`)
  return parts.join("\n\n")
}

/** 从骨架 HTML + CSS 提取既有的可复用类名清单。 */
function getManifestClasses(
  skeletonHtml: string,
  options?: { exclude?: (cls: string) => boolean }
): string[] {
  const dom = new JSDOM(skeletonHtml)
  const doc = dom.window.document
  const set = new Set<string>()

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[class]"))) {
    for (const cls of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
      set.add(cls)
    }
  }

  for (const style of Array.from(doc.querySelectorAll("style"))) {
    const css = style.textContent ?? ""
    const re = /\.([a-zA-Z_][\w-]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(css)) !== null) {
      set.add(m[1])
    }
  }

  return Array.from(set)
    .filter((cls) => !options?.exclude?.(cls))
    .sort()
}