export const PAGE_HOST_PLACEHOLDER = '<div data-page-host=""></div>'

export function injectPageIntoLayout(
  layoutHtml: string,
  pageHtml: string
): string {
  if (layoutHtml.includes(PAGE_HOST_PLACEHOLDER)) {
    return layoutHtml.replace(
      PAGE_HOST_PLACEHOLDER,
      `<div data-page-host="">${pageHtml}</div>`
    )
  }
  return layoutHtml.replace(
    "</body>",
    `<div data-page-host="">${pageHtml}</div></body>`
  )
}
