/** 占位常量（保留兼容）。 */
export const PAGE_HOST_PLACEHOLDER = '<div data-page-host=""></div>'

/**
 * 剥离页面片段顶部的"冗余包裹"，统一去耦列表/详情/首页片段与布局重复的容器。
 * 生成器常把布局已提供的容器也写进正文片段，常见形态：
 *   - <div data-page-host=""><div class="page-content"><div class="container">…
 *   - <main class="page-content" data-page-host="">…
 * 其中 data-page-host 是布局占位自身、page-content 是布局已提供的侧栏偏移容器。
 * 若二者留在片段里，会与布局的 .page-content（margin-left:var(--nav-w)）叠加，
 * 造成侧边栏偏移翻倍、排版错乱。此处迭代剥离片段根部属于这两类的元素。
 * 纯字符串实现（不依赖 jsdom / 浏览器 DOM），可安全用于客户端预览与服务端合并。
 */
export function stripRedundantFragmentWrappers(html: string): string {
  let s = html.trim()
  for (;;) {
    const inner = peelRootWrapper(s)
    if (inner === null) break
    s = inner.trim()
  }
  return s
}

/** 若字符串根部是冗余包裹（data-page-host 或含 page-content 类），剥掉外层元素并返回其内部内容。 */
function peelRootWrapper(s: string): string | null {
  const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)*?)\s*(\/?)\s*>/.exec(s)
  if (!openMatch) return null
  const tag = openMatch[1]
  const attrs = openMatch[2] ?? ""
  const selfClose = openMatch[3] === "/"
  if (attrs.indexOf("data-page-host") === -1 && !hasPageContentClass(attrs)) {
    return null
  }
  if (selfClose) return s.slice(openMatch[0].length)

  const afterOpen = s.slice(openMatch[0].length)
  const tokenRe = new RegExp(`<${tag}(\\s[^>]*?)?/?>|</${tag}\\s*>`, "gi")
  let depth = 1
  let m: RegExpExecArray | null
  tokenRe.lastIndex = 0
  while ((m = tokenRe.exec(afterOpen)) !== null) {
    const tok = m[0]
    if (tok.startsWith("</")) depth--
    else if (!/\/\s*>$/.test(tok)) depth++
    if (depth === 0) {
      const closeEnd = m.index + afterOpen.slice(m.index).indexOf(">") + 1
      return afterOpen.slice(0, m.index) + afterOpen.slice(closeEnd)
    }
  }
  return null
}

/** 属性串中 class="…" 是否含 page-content 类名。 */
function hasPageContentClass(attrs: string): boolean {
  const m = /\bclass\s*=\s*(['"])([^'"]*)\1/.exec(attrs)
  if (!m) return false
  return m[2]
    .split(/\s+/)
    .filter(Boolean)
    .includes("page-content")
}

/**
 * 客户端预览用的纯字符串合并函数（不依赖 jsdom/node internals，可被 client bundle 引用）。
 * 服务端真实渲染统一走 mergeThemePage（含布局契约补全）；此处只做脚本安全的显示合并：
 * - 占位存在 => 替换占位；
 * - 占位缺失 => 插到 <footer> 之前，避免正文跑到页脚之后。
 */
export function injectPageIntoLayout(
  layoutHtml: string,
  pageHtml: string,
  _options?: { navClearance?: boolean }
): string {
  // 布局自身已在 body 上提供 var(--nav-h) 级留白时不再叠加 host 留白（避免双重间距）；
  // 否则对所有页面（含 home）统一补 wrapper padding-top:var(--nav-h,0px)，
  // 与 mergeThemePage 保持一致，保证后台各页类型预览与线上渲染一致。
  const hasBodyClearance = /(?:html\s*,\s*body|body)\s*\{[^}]*padding[^}]*var\(--nav-h/i.test(
    layoutHtml
  )
  const style = !hasBodyClearance
    ? ' style="padding-top:var(--nav-h,0px)"'
    : ""
  const wrapper = `<div data-page-host=""${style}>${stripRedundantFragmentWrappers(
    pageHtml
  )}</div>`

  if (layoutHtml.includes(PAGE_HOST_PLACEHOLDER)) {
    return layoutHtml.replace(PAGE_HOST_PLACEHOLDER, wrapper)
  }

  const footerIndex = layoutHtml.toLowerCase().indexOf("<footer")
  if (footerIndex !== -1) {
    return (
      layoutHtml.slice(0, footerIndex) + wrapper + layoutHtml.slice(footerIndex)
    )
  }

  return layoutHtml.replace("</body>", `${wrapper}</body>`)
}