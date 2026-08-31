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

/** 作者头像占位。src 留空，渲染时自动填入选中的头像 URL；
 * 渲染期（content-renderer）会自动注入并按需全局去重，确保全站只有一个头像。
 */
export const AVATAR_PLACEHOLDER = `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">`

// ---------------------------------------------------------------------------
// 随机设计种子：从原型池随机抽取组合，注入 planner 简报，避免每次生成都
// 收敛到同一批"安全"美学方向。
// ---------------------------------------------------------------------------

export type DesignRhythm = "compact" | "balanced" | "airy"

export interface DesignSeeds {
  /** 美学方向 */
  aesthetic: string
  /** 布局原型 */
  layout: string
  /** 配色策略 */
  palette: string
  /** 标题排版 */
  typography: string
  /** 节奏档位 */
  rhythm: DesignRhythm
}

export const DESIGN_SEED_POOLS = {
  aesthetic: [
    "瑞士国际主义（网格驱动、无衬线、克制配色）",
    "Brutalism 粗野主义（裸露结构、粗边框、硬阴影、原生质感）",
    "玻璃拟态（半透明层、模糊背景、柔和光晕）",
    "暗色极客终端（近黑底、等宽字、扫描线/光标细节）",
    "纸墨书法（宣纸底色、墨色层级、笔触留白）",
    "Zine 拼贴（剪切感、倾斜元素、胶带/贴纸细节）",
    "孟菲斯几何（波点、锯齿、撞色几何装饰）",
    "报刊印刷（栏线、字距紧凑、黑白灰+单点红）",
    "北欧极简（原木色温、大量留白、细线条）",
    "赛博霓虹（深紫蓝底、霓虹描边、发光边缘）",
    "新艺术装饰（对称卷曲线条、金色描边、复古纹样）",
    "蓝图工程风（网格纸底、标注线、单色线稿感）",
  ],
  layout: [
    "顶部导航 + 居中单栏",
    "顶部导航 + 双栏（正文 + 侧边栏）",
    "左侧竖排导航 + 右侧内容",
    "杂志多栏网格（不等宽栏目穿插）",
    "全宽卡片纵列流（一屏一卡）",
    "紧凑列表流（无卡片边框、分隔线分组）",
  ],
  palette: [
    "高对比单色 + 锐利点缀色",
    "低饱和柔和（莫兰迪系）",
    "深色底 + 荧光强调色",
    "双色调（仅两个色相构建全部层级）",
    "大胆撞色互补（如橙蓝、红绿）",
    "暖调大地色（陶土、赭石、亚麻）",
  ],
  typography: [
    "超大展示型标题（远超常规字号、强对比）",
    "衬线标题 × 无衬线正文对比",
    "等宽字体系统（全局等宽，工程感）",
    "细字重大留白（超细字重 + 极疏行距）",
  ],
  rhythm: ["compact", "balanced", "airy"] as DesignRhythm[],
} satisfies Record<keyof DesignSeeds, string[]> & {
  rhythm: DesignRhythm[]
}

/** 节奏档位的中文描述（用于 prompt 注入与简报展示）。 */
export const RHYTHM_LABELS: Record<DesignRhythm, string> = {
  compact: "紧凑（信息密集，section padding 20~36px）",
  balanced: "均衡（标准节奏，section padding 32~56px）",
  airy: "大留白（呼吸感，section padding 64~110px，hero 可到 120px）",
}

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 每次全新生成时随机抽取一组设计方向种子。 */
export function rollDesignSeeds(): DesignSeeds {
  return {
    aesthetic: pick(DESIGN_SEED_POOLS.aesthetic),
    layout: pick(DESIGN_SEED_POOLS.layout),
    palette: pick(DESIGN_SEED_POOLS.palette),
    typography: pick(DESIGN_SEED_POOLS.typography),
    rhythm: pick(DESIGN_SEED_POOLS.rhythm),
  }
}

/** 通用图片规则：除作者头像外，禁止任何图片素材，一律用纯 CSS 视觉手段完成设计。 */
const IMAGE_RULE = `【图片规则】
本主题禁止使用任何图片素材（包括外部图片 URL 或编造的图片地址），一律以纯排版、色彩、几何图形、渐变、纹理等 CSS 视觉手段完成设计。
唯一允许的例外是作者头像占位（渲染期自动注入选中的头像 URL）。`

/** 动态文章列表的数据绑定规则（首页/列表页共用）。 */
const DYNAMIC_ARTICLES_RULE = `- 文章列表区域用 <section data-content="article-list" data-content-type="dynamic-articles"> 包裹；
- 动态区的首个子元素是单个列表项模板（<li> 或 <article>），模板内用 data-map 标记 title、excerpt、date、category、link 等字段；
- 模板外的静态结构（标题、容器、按钮等）放在模板项同级位置，不要包在模板项里面；
- 模板之外的示例项会被清除并替换为真实数据。`

/** 动态标签/分类列表的数据绑定规则（首页/列表页若有标签云或分类侧栏时使用）。 */
const DYNAMIC_TAG_RULE = `- 标签云区域用 <div data-content="tag-cloud" data-content-type="dynamic-tags"> 包裹，容器内首个子元素作为单个标签项模板，用 data-map="name" 标记标签名、data-map="link" 标记链接（href 写占位 # 即可）；
- 若设计了分类列表区域，用 data-content-type="dynamic-categories" 同理标记（模板内 data-map="name" 标记分类名）。
- 请勿用静态链接硬编码标签/分类列表——运行时会用后台维护的真实标签/分类自动替换（即便列表内同时混有标签与分类链接、或仅为分类链接，也会被替换）。`

/** 动态内容识别规则：统一指导 LLM 判断区块属于动态列表还是静态文本。 */
const DYNAMIC_CONTENT_RULE = `【动态内容识别规则】生成页面时，先判断每个区块属于「动态列表」还是「静态文本」：

一、动态列表（运行时会自动填充真实数据，禁止手写占位条目、禁止硬编码链接）：
1. 文章类列表：任何「展示多篇文章 / 多个卡片 / 网格 / 日期+标题条目」的区块（如 热门文章、近期/最新文章、推荐阅读、文章卡片、文章网格、侧边栏「时间锚点/归档」日期列表）都归为此类，整块只用一个外层容器标记：
   <section data-content="article-list" data-content-type="dynamic-articles">
     首个子元素是单个文章项模板（<article> 或 <li>），模板内用 data-map 标记 title、excerpt、date、category、link；封面用 <img data-map="cover">（仅限网格/多列卡片容器内）；若卡片展示标签，用 <div data-map="tags"> 包裹标签芯片（内嵌的 <span class="tag"> 作为单个标签样式模板，渲染时会逐个填入真实标签）。
   </section>
   切勿给每个文章项的标题/摘要/日期单独打 data-content="text"——整块就是一个动态列表。
   其中，「精选文章/编辑推荐」这类由后台手动挑选的区块，请改用 data-content="featured-articles"（同样 data-content-type="dynamic-articles"），其余文章列表/网格都用 data-content="article-list"。
2. 标签/分类列表：标签云、标签/分类导航、筛选行 → 分别用 data-content-type="dynamic-tags" / "dynamic-categories"（模板项内 data-map="name" 标记名称、data-map="link" 标记链接）。
3. 导航/页脚链接列表 → data-content-type="nav-list"。

二、静态文本（单条内容，运行时按后台配置替换）：区块标题、段落、统计数字、作者介绍等 → data-content + data-content-type="text"。

【识别要点】同标签、同 class、含文章链接、>1 个的重复结构即为文章列表；不要把重复文章卡片拆成多条 text，不要硬编码文章标题或链接；侧边栏「时间锚点/归档」这类「日期+标题」列表也按文章列表处理（模板项内 data-map 标记 date、title、link，日期不要写死成 2024.05 之类的样例）。`

export const SKELETON_SYSTEM_PROMPT = `你是一个专业的博客主题设计师，任务分为两阶段：
1. 本阶段只负责产出【主题骨架】——即共享布局 HTML（包含 <!DOCTYPE html>、<html>、<head>、<body>）。
2. 后续阶段会基于这份骨架，并行生成三个页面的正文（首页 /blog、列表页 /blog/archive、详情页 /blog/{slug}），填入骨架的正文占位节点。

【骨架应包含】
1. <head> 中的完整 <style>：这是整站设计系统，所有页面共享。
   - 用 CSS 变量（:root）统一管理配色、字体、字号阶梯、行高、间距、圆角、阴影、动效参数
   - 定义正文会用到的通用类：容器（.container/.wrap/.section）、标题（.section-title/.page-title/.post-title）、卡片（.post-card）、按钮（.btn）、文章网格、列表、侧边栏（.sidebar）、文章详情（.article-header/.article-body）、标签等
   - 设计感要求：明确美学方向（极简/杂志/复古/日式/工业/粉彩/奢雅等），避免"AI 感"平淡设计；排版有对比（中文标题选有特色的系统字体栈）；色彩"主色+锐利点缀色"；背景不默认纯白（可用渐变/噪点/几何/颗粒营造层次）；用纯 CSS 做过渡与入场动效
   - 【导航留白契约】:root 中必须定义 --nav-h（等于导航自身的实际高度，单位 px，例如 --nav-h: 72px）。若导航为 position: fixed，页面正文将由布局读取该变量自动让位，.data-page-host 无需、也不应自行写 padding-top。
2. 站点导航 <nav>：用 data-content="main-nav" data-content-type="nav-list" 标记，链接列表必须用 <ul>/<ol> 包裹 <li>（li 不要直接挂在 div 下），包含到 /blog、/blog/archive、/blog/category/{slug}、/blog/tag/{slug}、/blog/{slug} 的完整路由。若导航固定于视口顶部（position:fixed 或 sticky），必须把 :root 中的 --nav-h 定义为导航真实高度。导航品牌区（品牌名/logo 所在）如需放置作者头像占位：${AVATAR_PLACEHOLDER}，并在 CSS 中为 .avatar 定义圆形样式（overflow:hidden + 内部 img object-fit:cover）。
3. 页脚 <footer>：含链接列表（可选 data-content="footer-nav" data-content-type="nav-list"）
4. body 中【必须】包含一个正文占位节点，且仅此一个：
   <div data-page-host=""></div>
   后续三个页面的正文会被依次填入这里。除该占位节点外，骨架不要包含其它正文内容。

【JS 交互特效（可选能力）】
- 仅当用户明确提出"跟随鼠标移动、鼠标悬停跟随、滚动浮现、打字机标题"等纯 CSS 无法实现的交互特效时，才允许放置特效脚本；无此类需求时不要写任何脚本。
- 脚本用原生 Vanilla JS（不依赖任何库/CDN），内联放在 <head> 末尾的独立 <script> 中（不要放在 data-page-host 内）。
- 特效须为全站共享的全局增强效果：代码简洁、无解耦、不阻塞首屏；可用 CSS 实现的动效优先用 CSS，避免不必要的 script。
- 特效不能修改任何 data-content / data-map 内容，不能遮挡或干扰导航、正文的阅读与点击，不能移除页面里的元素；元素未被加载时须安全降级（不报错、不影响功能）。
- 若与"设计感要求"中的纯 CSS 过渡/入场动效配合，可只用一个自执行函数包裹实现，并监听 DOMContentLoaded 后再绑定事件。

${IMAGE_RULE}
作者头像全站仅需一个即可（渲染期会自动注入并按需去重）；如需在品牌区展示，放置：${AVATAR_PLACEHOLDER}

【内容标记规则】
- 导航/页脚等链接列表用 data-content + data-content-type="nav-list" 标记。
- 静态文本（标题、页脚文字）建议用 data-content + data-content-type="text" 标记。
常用字段命名参考：
${FIELD_REFERENCE}

【间距与节奏】
根据设计简报中的节奏档位决定间距体系，三档参考：
- 紧凑（compact）：section padding 20~36px，gap 12~20px，信息密集；
- 均衡（balanced）：section padding 32~56px，gap 16~28px；
- 大留白（airy）：section padding 64~110px，hero 区可到 120px，gap 24~40px，强调呼吸感。
同档内保持一致，禁止跨档混用；hero/banner 类视觉大区块可在档位基础上再放大约 1.5 倍。
footer 与正文之间的 margin-top 建议 32~64px。

直接输出内容，不要有任何额外的解释性文字。`

const PAGE_SPEC: Record<
  ThemePageType,
  { context: string; bodyPrompt: string }
> = {
  home: {
    context: "博客首页 /blog",
    bodyPrompt: `根据用户描述的风格和需求，自由组织首页区块布局。首页是博客的门面，可以包含任意区块组合（如文章展示、作者介绍、统计、时间线等），由你根据设计方向决定。

【数据绑定规则】
${DYNAMIC_CONTENT_RULE}
${DYNAMIC_ARTICLES_RULE}
${DYNAMIC_TAG_RULE}
- 首页自由组织的区块（作者介绍、统计、时间线、特色卡片组合等）内的所有标题（h2/h3/h4）与段落文本（p）都必须标记 data-content + data-content-type="text"，key 用语义化英文命名（如 core-modules-title、feature-card-desc）。

【头像占位】
如需在正文展示作者信息，可放一个作者头像占位：${AVATAR_PLACEHOLDER}（渲染期会确保全局只有 1 个；该区域不要标记 data-page-type）。`,
  },
  list: {
    context: "文章列表页 /blog/archive 等",
    bodyPrompt: `根据用户描述的风格，自由组织文章列表页布局。页面核心是展示文章列表，但你可以自由设计标题区域、筛选区、分页样式等。

【数据绑定规则】
${DYNAMIC_CONTENT_RULE}
${DYNAMIC_ARTICLES_RULE}
${DYNAMIC_TAG_RULE}
- 列表会自动填充全部文章并附加分页，正文不要写分页；
- 可在列表上方或周围添加标题、筛选、搜索等辅助区块。`,
  },
  detail: {
    context: "文章详情页 /blog/{slug}",
    bodyPrompt: `根据用户描述的风格，自由组织文章详情页布局。页面核心是文章内容展示，只包含以下区块：

【允许的区块】
1. 文章标题区（标题 + 发布日期 + 分类标签）
2. 文章正文容器（必须按下方数据绑定规则）
3. 文章标签列表
4. 作者信息区（姓名 + 简介 + 头像占位）

不要生成任何其它区块（如相关推荐、延伸阅读、返回列表按钮、评论区、分享按钮等）。

【数据绑定规则】
- 必须有一个文章正文容器：
<article data-content="article-body" data-content-type="article-body">
  <h2 data-map="title">文章标题</h2>
  <span data-map="date">2024-01-01</span>
  <span data-map="category">分类</span>
  <div data-map="body">这里会被渲染后的正文替换</div>
</article>
- <div data-map="body"> 必须放在 <article data-content="article-body"> 容器内部（正文占位不能拆到容器外）；
- data-map="body" 内部是会被整块替换的占位正文，不要给其中的元素标记 data-content。
- 标题/排版/容器尽量用骨架已有的类

【头像占位】
如需在底部作者信息区放置头像：${AVATAR_PLACEHOLDER}（渲染期会确保全局只有 1 个；该元素不要标记 data-page-type）。`,
  },
}

/** 页面阶段 agent 的系统提示词：基于视觉契约产出某一页正文。 */
export function buildPageSystemPrompt(
  pageType: ThemePageType,
  context: string
): string {
  const spec = PAGE_SPEC[pageType]
  const imageSection =
    pageType === "detail"
      ? `【图片规则】
本页（文章详情页）正文不含封面或配图，文章配图会随正文内容自动渲染（data-map="body"），不要使用任何图片素材。底部如需放置作者头像占位：${AVATAR_PLACEHOLDER}（渲染期会确保全局只有 1 个；该元素不要标记 data-page-type）。`
      : IMAGE_RULE

  return `你是一个博客「${spec.context}」的正文设计者。请基于给定的共享骨架（其样式/类名/设计语言已由骨架阶段产出），结合用户描述的风格需求，输出该页面正文。

${context}

【正文要求】
${spec.bodyPrompt}

【设计原则】
根据用户描述的风格和需求自由发挥，决定页面包含哪些区块、如何排布。区块组合没有固定模板，完全由你根据设计方向和用户偏好来组织。保持与骨架视觉语言一致，追求精致的设计感。

${imageSection}

【内容标记规则】
动态内容区域（文章列表等）必须使用 data-content 和 data-content-type 属性标记，容器首个子元素作为模板，模板内用 data-map 标记字段名（如 title、excerpt、date、category、link）。
普通文本区域（标题、段落、卡片文字、统计数字、时间线条目、说明文字等）必须用 data-content + data-content-type="text" 标记，否则该内容无法在后台自定义。每个独立区块内的标题与正文文本元素都要分别标记（例如一个卡片区块的标题一个 key、摘要一个 key）。注意：标签云 / 分类列表属于动态列表，应按上述动态标签规则用 data-content-type="dynamic-tags" / "dynamic-categories" 标记，勿把它们当普通文本。判断某个区块是动态列表还是静态文本，遵循上述【动态内容识别规则】：重复的含文章链接卡片/网格结构应整体标记为 dynamic-articles，切勿拆成多个 text 字段。
常用字段命名参考：
${FIELD_REFERENCE}
示例：<h1 data-content="blog-title" data-content-type="text">我的博客</h1>
用中文填充占位内容，保持精致设计与骨架视觉语言完全一致。直接输出正文 HTML，不要额外解释性文字。`
}

// ---------------------------------------------------------------------------
// CSS 无损压缩与安全截断：用于控制注入 prompt 的输入体积，不改变推导语义。
// ---------------------------------------------------------------------------

/** 压缩 CSS：去注释、压空白（保留字符串字面量内容不变）。 */
export function minifyCss(css: string): string {
  // 先保护字符串字面量，避免其内部空白/逗号等被压缩改变含义（如 content: "a, b"）。
  const strings: string[] = []
  const protectedCss = css.replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, (m) => {
    strings.push(m)
    return `__MINIFY_STRING_${strings.length - 1}__`
  })

  let out = protectedCss
  // 去块注释
  out = out.replace(/\/\*[\s\S]*?\*\//g, " ")
  // 压缩连续空白为单个空格（缩进/换行归一）
  out = out.replace(/\s+/g, " ")
  // 压缩分隔符两侧空白（不含冒号，避免把后代选择器 a :hover 误变伪类 a:hover）
  out = out.replace(/\s*([{};,<>])\s*/g, "$1")

  // 还原字符串字面量
  out = out.replace(/__MINIFY_STRING_\d+__/g, () => strings.shift() ?? "")
  return out.trim()
}

/**
 * 在不超过 maxChars 的前提下，截到最后一个完整的顶层规则。
 * 天然支持 @media 等嵌套块；未超限时原样返回。
 */
export function truncateCssRules(css: string, maxChars: number): string {
  if (css.length <= maxChars) return css
  let depth = 0
  let lastSafeCut = -1
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      // 顶层规则结束处为安全切点
      if (depth === 0) lastSafeCut = i + 1
    }
    // 累积已超预算，取最近一个完整规则切点
    if (i + 1 >= maxChars) {
      return lastSafeCut > 0 ? css.slice(0, lastSafeCut) : css
    }
  }
  return css
}

/**
 * 从骨架 HTML 提炼出紧凑的"视觉契约"，供各页面生成器参考，
 * 避免把整份骨架 HTML 重复注入每个页面 prompt。
 */
export function buildPagePromptContext(
  skeletonHtml: string,
  pageType?: ThemePageType
): string {
  const doc = new JSDOM(skeletonHtml).window.document

  const styles: string[] = []
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) styles.push(style.textContent)
  }
  // 先无损压缩、再按规则边界安全截断：同预算容纳更多规则，类名清单始终完整下发。
  const MAX_CSS_CHARS = 16000
  const cssFull = minifyCss(styles.join("\n"))
  const css = truncateCssRules(cssFull, MAX_CSS_CHARS)
  const cssTruncated = cssFull.length > MAX_CSS_CHARS

  const navLinks: string[] = []
  for (const el of Array.from(doc.querySelectorAll("nav a"))) {
    const href = el.getAttribute("href") ?? ""
    const text = el.textContent?.trim() ?? ""
    if (href) navLinks.push(`${text} -> ${href}`)
  }

  const classManifest = getManifestClasses(doc, {
    // 详情页不展示封面相关类，避免诱导生成封面/头图区块
    exclude:
      pageType === "detail" ? (cls) => /\bcover\b/i.test(cls) : undefined,
  })

  const parts: string[] = []
  parts.push(`主题共享骨架的完整 CSS 类库与设计变量（配色、字体、间距、动效参数都必须从中选取并保持一致）：\n\`\`\`css\n${css || "（无 CSS）"}\n\`\`\``)
  parts.push(
    `骨架已有的可复用类名清单（正文只能使用以下类名，禁止自创其它类名或样式、禁止对骨架类名的类写样式覆盖）：\n${
      classManifest.length > 0
        ? classManifest.join(", ")
        : "（骨架未提供类名，仅使用骨架 CSS 中定义的基础标签样式）"
    }\n${
      cssTruncated
        ? "类名清单始终完整，优先于被截断的 CSS，务必从中选取。"
        : "以上类名已由骨架 CSS 完整推导，从中选取即可。"
    }`
  )
  if (navLinks.length) {
    parts.push(`骨架导航链接（在正文中复用，保证路由一致）：\n${navLinks.join("\n")}`)
  }
  parts.push(`硬性约束（必须严格遵守）：
- 只输出 body 内的页面正文，不要输出 <!DOCTYPE html>、<html>、<head>、<body>；
- 不要输出任何 <style>、<script>、<link>、<meta>、<title> 标签；不要使用 !important；不要书写自定义 @media 规则（响应式已由骨架统一处理）；
- 不要输出 <nav>、<header>、<footer>（它们由布局统一提供）；
- 顶部不要自己写 fixed 导航的留白（padding-top/margin-top 让位导航），布局已通过 --nav-h 统一处理该间距；
- 正文以 data-page-host 下的单层结构组织，不要自建整份 fixed 宽度的全屏容器；不得使用固定 px/vw 的 width、min-width、max-width、height，也不得用固定 px 字号覆盖骨架（layout 与字号交给骨架设计变量），以免造成溢出或错乱；
- 封面/头图占位类（如 post-cover 等）只能用于网格/多列卡片容器内，全宽列表卡片内不要放 16:9 大幅封面块；网格/多列卡片容器内的文章封面占位必须使用 <img data-map="cover">（有封面时自动填充 src、无封面时整块隐藏），且必须放在列表宿主容器内；
- 不要把 section 间距类与 container 容器类叠加在同一元素上（两者的 padding 会互相覆盖，导致容器失去左右内边距）。`)
  return parts.join("\n\n")
}

/** 从骨架 DOM（含 CSS）提取既有的可复用类名清单。 */
function getManifestClasses(
  doc: Document,
  options?: { exclude?: (cls: string) => boolean }
): string[] {
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