import { JSDOM } from "jsdom"
import { GLOBAL_FIELDS, STAT_FIELDS } from "@smart-blog/core/lib/field-registry"

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
 * 渲染期（content-renderer）只在正文区注入/去重头像，导航品牌区头像由骨架提供，
 * 两者各自最多 1 个、互不影响。
 */
export const AVATAR_PLACEHOLDER = `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">`

/**
 * 头像占位的硬约束。
 * author-avatar 是「text 类型但值是图片 URL」的特殊全局字段：渲染器只对
 * <img>（或内部含 <img> 的容器）设置 src，其余元素会走普通文本路径把 URL
 * 写进 textContent。LLM 若用纯 CSS 圆形 div 充当头像并标 text 字段，
 * 页面就会显示一串 "/api/uploads/..." 字符而不是头像。
 */
const AVATAR_MARKUP_RULE = `【头像占位硬约束】作者头像必须是 <img> 元素；若需要外层 CSS 圆形容器，容器内部也必须放 <img>。
- 唯一允许的头像占位写法：${AVATAR_PLACEHOLDER}
- **禁止**把 <div>/<span> 等容器直接写成 data-content="author-avatar" data-content-type="text" 的头像占位：该字段的值是图片 URL，会被当作普通文本渲染成一串可见字符。
- 头像的圆形、边框、裁剪等样式写在 .avatar / .avatar-box 上，不要靠「容器里写文字」实现。`

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
唯一允许的例外是作者头像占位（渲染期自动注入选中的头像 URL）。

${AVATAR_MARKUP_RULE}`

/** 动态文章列表的数据绑定规则（首页/列表页共用）。 */
const DYNAMIC_ARTICLES_RULE = `- 文章列表区域用 <section data-content="article-list" data-content-type="dynamic-articles"> 包裹；
- 动态区的首个子元素是单个列表项模板（<li> 或 <article>），模板内用 data-map 标记 title、excerpt、date、category、link 等字段；
- 模板项内的每个字段必须填一句完整的示例文案（标题、摘要、日期各写一句），用于主题预览时完整呈现；渲染时会被真实文章数据整条替换，不会出现在线上页面；
- 模板外的静态结构（标题、容器、按钮等）放在模板项同级位置，不要包在模板项里面；
- 除模板项外不要再手写其它示例条目，那些都会被清除并替换为真实数据。`

/**
 * 重复卡片一致性契约：由骨架阶段的 CSS 设计系统保证。
 *
 * 渲染期会把每张文章卡片包进 <a style="display:contents"> 实现整卡可点，
 * 并按真实数据克隆模板。因此基于 :nth-child / 直接子选择器的差异化样式会失效或错配，
 * hover 里改动 font-size / padding / transform 会引发文字重排、同组卡片高低错落
 * —— 这是生成主题里最常见的「卡片排版乱掉」来源。
 */
const CARD_LAYOUT_CONTRACT = `【重复卡片一致性契约】（文章卡片、列表项等同类重复单元必须全部遵守）
- 同组卡片必须结构、类名、字号、颜色、间距完全一致；**禁止**用 :nth-child / :first-child / :last-child / 直接子选择器 (>) 给同类卡片设置不同的 font-size、color、padding、margin、width、height。渲染期会为每张卡片包裹一层链接，位置选择器会失效或错配，导致同组卡片样式不一致。差异化只允许用在**不改变布局与文字样式**的装饰性伪元素（::before/::after 的几何纹理）上。
- 卡片组必须等高：网格容器用 align-items:stretch；卡片本体 display:flex + flex-direction:column + height:100%；卡片底部的标签/按钮/日期等尾部元素用 margin-top:auto 贴底，保证标题长短不同时同行卡片仍然对齐。
- 标题与摘要必须钳制行数：标题 -webkit-line-clamp:2、摘要 -webkit-line-clamp:3，并配套 display:-webkit-box、-webkit-box-orient:vertical、overflow:hidden，避免长标题把卡片内容顶歪、标签上下错位。
- **hover / focus / 过渡态禁止改变任何影响布局的属性**：font-size、line-height、letter-spacing、padding、margin、width、height、gap、display、position 一律不允许；只允许 color、background-color、border-color、box-shadow、opacity、text-shadow，以及不引起重排的 transform（卡片内部装饰元素的 scale 可用，整卡 translateY 不超过 4px）。禁止在 hover 里放大标题、加大内边距或大幅上浮卡片——这会造成文字重排、卡片与相邻卡片错落。
- 卡片头图/封面一律用纯 CSS（渐变、几何、纹理）绘制，不要用 <img>：真实文章大多没有封面图，使用图片会让封面块在渲染期被整体移除，卡片高度塌陷、设计走样。`

/**
 * 正文区宽度契约：解决「内容只占左侧、右侧一大块空白」。
 * LLM 常给限宽容器只写 max-width 忘记居中，或把卡片网格写死 2 列，
 * 在 1920px 宽屏上就会留出一整块没人用的背景区。
 */
const LAYOUT_WIDTH_CONTRACT = `【正文区宽度与填充契约】（避免宽屏上右侧留出一大块空白）
- [data-page-host] 是全站唯一正文容器：必须 box-sizing:border-box；**禁止**给它设置固定/百分比宽度、max-width 或 grid-template-columns。需要为左侧固定导航留位时只用 margin-left / padding-left（叠加 width:100% 会横向溢出）。
- 正文里的限宽容器（.wrap / .container / .section 等）必须**同时**写 width:100%、max-width:min(100% - 2×水平内边距, 1440px)、margin-inline:auto；只写 max-width 不写居中，宽屏上内容会全挤在左侧、右侧空出一大块。max-width 不要小于 1200px，否则大屏仍会留下明显空白。
- **所有多列网格**（文章卡片网格、统计数字条、特性卡片、时间线、指标卡等）都必须用 repeat(auto-fill, minmax(280px, 1fr)) 或 repeat(auto-fit, minmax(240px, 1fr))，让列数随可用宽度自动增加；**禁止**写死 repeat(2, 1fr) / repeat(3, 1fr) / grid-template-columns: 1fr 1fr 这类固定列数，也禁止给网格容器单独设 max-width。固定列数下若子项数不是列数的整数倍，最后一行会露出容器背景形成一大块空白、并把下一区块顶出异常间隔；大屏上也会空出整列。
- 若设计「主内容 + 侧栏」双列（如 1fr 280px），侧栏必须有可见内容（作者卡 / 标签云 / 分类 / 归档）；没有内容时直接用单列，禁止预留空列。响应式断点把双列折叠成单列时，不要留下空的 grid 列。
- 网格子项数必须与列数匹配：固定列数时列数必须能整除子项数（4 个统计项就用 4 列或 2 列，**不要** 3 列），否则最后一行会露出容器背景，形成一大块空白。
- 相邻区块之间必须保留明显的垂直间距（≥16px）：面包屑与下方 kicker/标题、统计条与上方卡片网格、章节与章节之间都不能紧贴成一团；同理标题→描述、描述→按钮组之间也要有呼吸感。紧贴的两行不同层级的文字会被看成一句排坏的文本。
- 自检：在 1920px 宽视口下，正文最右侧内容应至少延伸到视口宽度的 85%，且左右留白大致对称。`

/** 动态标签/分类列表的数据绑定规则（首页/列表页/详情页若有标签云或分类侧栏时使用）。 */
const DYNAMIC_TAG_RULE = `- 标签云/标签列表区域用 <div data-content="tag-cloud" data-content-type="dynamic-tags"> 包裹，容器内首个子元素作为单个标签项模板，用 data-map="name" 标记标签名、data-map="link" 标记链接（href 写占位 # 即可），并填一个示例标签名（渲染时会被真实标签替换）；
- **文章详情页底部的「文章标签」区同样必须用 dynamic-tags 标记**（data-content="article-tags" data-content-type="dynamic-tags" data-content-scope="article"），渲染时会用**该文章的真实标签**及其链接替换；不要把文章标签写成普通 text 字段（那样会显示编造的假标签且无法点击）；
- 若详情页侧栏另有「标签云」，它用全站热门标签，请显式标注 data-content-scope="site"（不标注时按位置自动判断，侧栏里的会自动视为全站标签）；
- 若设计了分类列表区域，用 data-content-type="dynamic-categories" 同理标记（模板内 data-map="name" 标记分类名）。
- 请勿用静态链接硬编码标签/分类列表——运行时会用后台维护的真实标签/分类自动替换（即便列表内同时混有标签与分类链接、或仅为分类链接，也会被替换）。`

/** 动态内容识别规则：统一指导 LLM 判断区块属于动态列表还是静态文本。 */
const DYNAMIC_CONTENT_RULE = `【动态内容识别规则】生成页面时，先判断每个区块属于「动态列表」还是「静态文本」：

一、动态列表（运行时会自动填充真实数据，禁止硬编码真实链接、禁止手写多条示例条目）：
1. 文章类列表：任何「展示多篇文章 / 多个卡片 / 网格 / 日期+标题条目」的区块（如 热门文章、近期/最新文章、推荐阅读、文章卡片、文章网格、侧边栏「时间锚点/归档」日期列表）都归为此类，整块只用一个外层容器标记：
   <section data-content="article-list" data-content-type="dynamic-articles">
     首个子元素是单个文章项模板（<article> 或 <li>），模板内用 data-map 标记 title、excerpt、date、category、link；**卡片头图/封面一律用纯 CSS（渐变、几何、纹理）绘制，禁止用 <img data-map="cover">**（真实文章大多没有封面图，用图片会让封面块在渲染期被整体移除，卡片高度塌陷、同组卡片参差不齐）；若卡片展示标签，用 <div data-map="tags"> 包裹标签芯片（内嵌的 <span class="tag"> 作为单个标签样式模板，渲染时会逐个填入真实标签）；模板项内各字段都要填一句示例文案（渲染时整条替换为真实数据，仅为预览完整）。
   </section>
   切勿给每个文章项的标题/摘要/日期单独打 data-content="text"——整块就是一个动态列表。
   其中，「精选文章/编辑推荐」这类由后台手动挑选的区块，请改用 data-content="featured-articles"（同样 data-content-type="dynamic-articles"），其余文章列表/网格都用 data-content="article-list"。
   ⚠️【同一页只允许一个文章流】：同一页面最多只能有一个绑定「最新文章/全部文章」的动态文章区块（data-content="article-list"）。不要把同一批文章在同一页重复展示成多个区块（例如既放「最新文章」又放「归档/时间线/热门」，或放了 featured-articles 又放 article-list，结果都渲染成同一批文章）。一个页面只允许：要么一个 article-list（推荐），要么一个精选类 featured-articles，二者不并存；也不要在同一个页面上再做一个展示相同文章的归档/时间线列表。归档/时间线列表应放到归档页 /blog/archive。
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
   - 【导航留白契约】:root 中必须定义 --nav-h（等于导航自身的实际高度，单位 px，例如 --nav-h: 72px）。--nav-h 是**设计令牌**，只描述导航自身高度，运行时不会被改写，可放心用于 sticky 偏移、侧栏定位等计算。
     若导航为 position: fixed（固定顶部导航），布局会在运行时实测其高度并写入 --nav-clearance，由 --nav-clearance 统一为正文预留顶部空间 —— 你**不需要、也不应该**在 body 上写 padding-top: var(--nav-h)，顶层留白只由 --nav-clearance 承担。
     若导航不是固定顶部（sticky 吸顶 / 静态 / 左侧竖排），则不会有额外顶部留白，导航自身占据文档流位置即可。
2. 站点导航 <nav>：用 data-content="main-nav" data-content-type="nav-list" 标记，链接列表必须用 <ul>/<ol> 包裹 <li>（li 不要直接挂在 div 下）。
   - 导航**只放核心路由**：/blog（首页）、/blog/archive（归档）等站内固定页面。
   - **禁止**在导航里硬编码分类（/blog/category/...）、标签（/blog/tag/...）或具体文章（/blog/xxx）链接 —— 这些 slug 是编造的，点了会失效；而且正文里的动态标签云/分类列表已经按后台真实数据渲染了一份，导航里再写一份就是同一批标签重复出现两遍。
   - 导航品牌区（品牌名/logo 所在）如需放置作者头像占位：${AVATAR_PLACEHOLDER}，并在 CSS 中为 .avatar 定义圆形样式（overflow:hidden + 内部 img object-fit:cover）。
   - 导航品牌区的**站名必须标记为** <span data-content="blog-title" data-content-type="text">站名</span>（副标题同理用 data-content="blog-subtitle"），否则后台配置的站名无法生效；**不要**写成 {blog-title} 这类花括号占位符。
   - 若导航固定于视口顶部（position:fixed 或 sticky），必须把 :root 中的 --nav-h 定义为导航真实高度。
3. 页脚 <footer>：含链接列表（可选 data-content="footer-nav" data-content-type="nav-list"）
4. body 中【必须】包含一个正文占位节点，且仅此一个：
   <div data-page-host=""></div>
   后续三个页面的正文会被依次填入这里。除该占位节点外，骨架不要包含其它正文内容。

${CARD_LAYOUT_CONTRACT}

${LAYOUT_WIDTH_CONTRACT}

【JS 交互特效（可选能力）】
- 仅当用户明确提出"跟随鼠标移动、鼠标悬停跟随、滚动浮现、打字机标题"等纯 CSS 无法实现的交互特效时，才允许放置特效脚本；无此类需求时不要写任何脚本。
- 脚本用原生 Vanilla JS（不依赖任何库/CDN），内联放在 <head> 末尾的独立 <script> 中（不要放在 data-page-host 内）。
- 特效须为全站共享的全局增强效果：代码简洁、无解耦、不阻塞首屏；可用 CSS 实现的动效优先用 CSS，避免不必要的 script。
- 特效不能修改任何 data-content / data-map 内容，不能遮挡或干扰导航、正文的阅读与点击，不能移除页面里的元素；元素未被加载时须安全降级（不报错、不影响功能）。
- 若与"设计感要求"中的纯 CSS 过渡/入场动效配合，可只用一个自执行函数包裹实现，并监听 DOMContentLoaded 后再绑定事件。

${IMAGE_RULE}
作者头像分两处独立管理：导航品牌区的头像由本骨架提供（如需展示，放置：${AVATAR_PLACEHOLDER}），页面正文的头像由各页面自行决定；渲染期只保证正文区最多 1 个，不会因正文有头像而删除导航头像。

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
    bodyPrompt: `根据用户描述的风格和需求，自由组织首页区块布局。首页是博客的门面，可以包含任意区块组合（如文章展示、作者介绍、统计、特色卡片等），由你根据设计方向决定。

【数据绑定规则】
${DYNAMIC_CONTENT_RULE}
${DYNAMIC_ARTICLES_RULE}
${DYNAMIC_TAG_RULE}
- ⚠️ 首页通常只需要一个「最新文章」文章流区块（data-content="article-list"，且只出现一次）。仅在用户明确要「手动精选文章」时才额外考虑 featured-articles，但文章流区块整体全页只能有一个——不要把同一批文章用「最新文章」「精选」「归档/时间线」等多个区块重复呈现。
- 首页的「最新文章」只展示最新若干篇，是预览区块，**不要输出分页**（不要 .pagination / pagination-nav / data-content="pagination-nav" / 上一页 / 下一页 / 页码 1 2 3 之类的静态占位或 nav-list 标记，渲染期不会为首页生成分页）；可以在该区块放一个「查看全部文章」链接指向 /blog/archive，完整列表与翻页都在归档页；
- 首页自由组织的区块（作者介绍、统计、特色卡片组合等）内的所有标题（h2/h3/h4）与段落文本（p）都必须标记 data-content + data-content-type="text"，key 用语义化英文命名（如 core-modules-title、feature-card-desc）。

【头像占位】
如需在正文展示作者信息，可放一个作者头像占位：${AVATAR_PLACEHOLDER}（渲染期只保证正文区最多 1 个头像；导航栏头像由布局统一提供，不受正文内容影响；该区域不要标记 data-page-type）。`,
  },
  list: {
    context: "文章列表页 /blog/archive 等",
    bodyPrompt: `根据用户描述的风格，自由组织文章列表页布局。页面核心是展示文章列表，但你可以自由设计标题区域、筛选区、分页样式等。

【数据绑定规则】
${DYNAMIC_CONTENT_RULE}
${DYNAMIC_ARTICLES_RULE}
${DYNAMIC_TAG_RULE}
- 列表会自动填充全部文章并附加分页，正文不要写分页（不要输出 .pagination / pagination-nav / 上一页 / 下一页 / 页码 1 2 3 之类的静态分页占位或 nav-list 标记，渲染期会按真实页数自动生成并接好跳转）；
- 可在列表上方或周围添加标题、筛选、搜索等辅助区块。`,
  },
  detail: {
    context: "文章详情页 /blog/{slug}",
    bodyPrompt: `根据用户描述的风格，自由组织文章详情页布局。页面核心是文章内容展示，只包含以下区块：

【允许的区块】
1. 文章标题区（标题 + 发布日期 + 分类标签）
2. 文章正文容器（必须按下方数据绑定规则）
3. 文章标签列表（**必须**用 <div data-content="article-tags" data-content-type="dynamic-tags" data-content-scope="article"> 标记，容器内首个子元素作为标签项模板，用 data-map="name" 标记标签名、data-map="link" 标记链接，填一个示例标签名；渲染时会用该文章的真实标签与链接替换）
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
如需在底部作者信息区放置头像：${AVATAR_PLACEHOLDER}（渲染期只保证正文区最多 1 个头像；导航头像由布局提供，互不影响；该元素不要标记 data-page-type）。`,
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
本页（文章详情页）正文不含封面或配图，文章配图会随正文内容自动渲染（data-map="body"），不要使用任何图片素材。底部如需放置作者头像占位：${AVATAR_PLACEHOLDER}（渲染期只保证正文区最多 1 个头像；导航头像由布局提供，互不影响；该元素不要标记 data-page-type）。

${AVATAR_MARKUP_RULE}`
      : IMAGE_RULE

  return `你是一个博客「${spec.context}」的正文设计者。请基于给定的共享骨架（其样式/类名/设计语言已由骨架阶段产出），结合用户描述的风格需求，输出该页面正文。

${context}

【正文要求】
${spec.bodyPrompt}

【设计原则】
根据用户描述的风格和需求自由发挥，决定页面包含哪些区块、如何排布。区块组合没有固定模板，完全由你根据设计方向和用户偏好来组织。保持与骨架视觉语言一致，追求精致的设计感。

【重复卡片结构要求】同一组文章卡片/列表项的 HTML 结构、类名必须完全一致（渲染期按真实数据克隆单个模板，不要手写多条结构不同的示例卡片）；标题、摘要、日期、标签各自放在独立元素里，便于骨架 CSS 用 -webkit-line-clamp 钳制行数、用 margin-top:auto 把尾部元素贴底；卡片头图用纯 CSS 装饰元素，不要用 <img>。完整约束见骨架的【重复卡片一致性契约】。

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
- 不要输出 <nav>、<header>、<footer>（它们由布局统一提供）；文章/卡片内部的 <header> 可以正常使用；
- 不要输出 data-page-host（正文容器由布局提供），正文直接以页面自己的根元素开始；
- **不要复制布局的容器骨架**：正文只输出本页自己的内容块，不要再套一层与骨架同名的外层容器（如 .layout-grid / .content-area / .site-wrap 等布局容器）——重复的骨架会与布局叠加成两层栅格，正文被挤进窄列，同时还会多出一份导航；
- 顶部不要自己写 fixed 导航的留白（padding-top/margin-top 让位导航），布局已通过 --nav-clearance 统一处理该间距；
- 正文以单层结构组织，不要自建整份 fixed 宽度的全屏容器；不得使用固定 px/vw 的 width、min-width、max-width、height，也不得用固定 px 字号覆盖骨架（layout 与字号交给骨架设计变量），以免造成溢出或错乱；
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