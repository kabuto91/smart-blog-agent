/** 占位常量（保留兼容）。 */
export const PAGE_HOST_PLACEHOLDER = '<div data-page-host=""></div>'

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
  const wrapper = `<div data-page-host=""${style}>${pageHtml}</div>`

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