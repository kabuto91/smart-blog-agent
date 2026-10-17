const SLUG_SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

/** 生成长度为 length 的随机后缀（base36 小写）。 */
function randomSlugSuffix(length = 5): string {
  let suffix = ""
  for (let i = 0; i < length; i++) {
    suffix +=
      SLUG_SUFFIX_ALPHABET[
        Math.floor(Math.random() * SLUG_SUFFIX_ALPHABET.length)
      ]
  }
  return suffix
}

/**
 * 生成随机文章 slug：秒级时间戳 + 随机后缀，形如 "1760000000-a1b2c"。
 * 不依赖标题，避免中文/特殊字符在 URL 中显得突兀或出现格式问题。
 * 纯函数（无数据库/Node 依赖），可被浏览器端组件直接引用。
 */
export function generateArticleSlug(): string {
  return `${Math.floor(Date.now() / 1000)}-${randomSlugSuffix()}`
}
