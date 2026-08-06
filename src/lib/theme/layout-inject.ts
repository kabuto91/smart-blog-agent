export const PAGE_HOST_PLACEHOLDER = '<div data-page-host=""></div>'

export function injectPageIntoLayout(
  layoutHtml: string,
  pageHtml: string,
  options?: { navClearance?: boolean }
): string {
  const style = options?.navClearance ? ' style="padding-top:var(--nav-h,0px)"' : ""
  const wrapper = `<div data-page-host=""${style}>${pageHtml}</div>`
  if (layoutHtml.includes(PAGE_HOST_PLACEHOLDER)) {
    return layoutHtml.replace(PAGE_HOST_PLACEHOLDER, wrapper)
  }
  return layoutHtml.replace("</body>", `${wrapper}</body>`)
}
