import type { CollectionNavItem } from "./collections"

/** 转义 HTML 特殊字符，防止合集名称/简介等用户输入破坏页面结构。 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** 固定内置样式（jjc- 前缀防与主题样式冲突）：清新简约、浅色底、细分割线、点缀色 #E5A83D。 */
const COLLECTIONS_STYLE = `<style>
.jjc-wrap{--jjc-accent:#E5A83D;--jjc-ink:#1C1C1E;--jjc-sub:#6B7280;--jjc-line:rgba(0,0,0,.08)}
.jjc-nav{box-sizing:border-box;max-width:760px;margin:28px auto 0;padding:0 16px}
.jjc-nav__card{border-top:1px solid var(--jjc-line);padding-top:18px}
.jjc-nav__card+.jjc-nav__card{margin-top:22px}
.jjc-nav__head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.jjc-nav__meta{display:inline-flex;align-items:center;gap:8px}
.jjc-nav__label{display:inline-flex;align-items:center;gap:5px;font-size:11px;letter-spacing:.04em;color:var(--jjc-accent);background:rgba(229,168,61,.12);border-radius:999px;padding:2px 8px}
.jjc-nav__name{font-size:15px;font-weight:600;color:var(--jjc-ink);text-decoration:none}
.jjc-nav__name:hover{color:var(--jjc-accent)}
.jjc-nav__prog{font-size:12px;color:var(--jjc-sub);font-variant-numeric:tabular-nums}
.jjc-nav__body{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
.jjc-nav__link{font-size:13px;color:var(--jjc-ink);text-decoration:none;transition:color .15s}
.jjc-nav__link:hover{color:var(--jjc-accent)}
.jjc-nav__link.is-disabled{color:#B0B4BB;pointer-events:none}
.jjc-head{box-sizing:border-box;max-width:960px;margin:0 auto;padding:32px 20px 8px}
.jjc-head__name{font-size:26px;font-weight:700;color:var(--jjc-ink);margin:0}
.jjc-head__desc{margin:10px 0 0;font-size:14px;color:var(--jjc-sub);line-height:1.7}
.jjc-head__meta{margin-top:12px;font-size:13px;color:var(--jjc-accent)}
.jjc-grid{box-sizing:border-box;max-width:960px;margin:0 auto;padding:24px 20px 48px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.jjc-card{display:block;border:1px solid var(--jjc-line);border-radius:12px;background:#fff;padding:18px;text-decoration:none;transition:box-shadow .15s,transform .15s}
.jjc-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.06);transform:translateY(-2px)}
.jjc-card__name{font-size:16px;font-weight:600;color:var(--jjc-ink);margin:0}
.jjc-card__desc{margin:8px 0 0;font-size:13px;color:var(--jjc-sub);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.jjc-card__count{margin-top:12px;font-size:12px;color:var(--jjc-accent)}
.jjc-empty{box-sizing:border-box;max-width:960px;margin:0 auto;padding:64px 20px;text-align:center;color:var(--jjc-sub);font-size:14px}
</style>`

/** 文章详情页合集导航：每个所属合集渲染一张卡片，含进度与上一篇/下一篇。 */
export function buildCollectionNavHtml(navItems: CollectionNavItem[]): string {
  if (navItems.length === 0) return ""
  const cards = navItems
    .map((item) => {
      const prev = item.prev
        ? `<a class="jjc-nav__link" href="/blog/${encodeURIComponent(item.prev.slug)}">← 上一篇</a>`
        : `<span class="jjc-nav__link is-disabled">已是第一篇</span>`
      const next = item.next
        ? `<a class="jjc-nav__link" href="/blog/${encodeURIComponent(item.next.slug)}">下一篇 →</a>`
        : `<span class="jjc-nav__link is-disabled">已是最后一篇</span>`
      return `
  <div class="jjc-nav__card">
    <div class="jjc-nav__head">
      <span class="jjc-nav__meta">
        <span class="jjc-nav__label">合集</span>
        <a class="jjc-nav__name" href="/collections/${encodeURIComponent(item.collection.slug)}">${escapeHtml(item.collection.name)}</a>
      </span>
      <span class="jjc-nav__prog">第 ${item.current} 篇 / 共 ${item.total} 篇</span>
    </div>
    <div class="jjc-nav__body">
      ${prev}
      ${next}
    </div>
  </div>`
    })
    .join("")
  return `${COLLECTIONS_STYLE}
<div class="jjc-wrap jjc-nav">${cards}
</div>`
}

/** 合集详情页头部：名称、简介、文章数。 */
export function buildCollectionHeadHtml(collection: {
  name: string
  description: string | null
  articleCount: number
}): string {
  return `${COLLECTIONS_STYLE}
<div class="jjc-wrap jjc-head">
  <h1 class="jjc-head__name">${escapeHtml(collection.name)}</h1>
  ${collection.description ? `<p class="jjc-head__desc">${escapeHtml(collection.description)}</p>` : ""}
  <p class="jjc-head__meta">共 ${collection.articleCount} 篇文章</p>
</div>`
}

/** 合集列表页卡片网格。 */
export function buildCollectionsGridHtml(
  collections: Array<{
    name: string
    slug: string
    description: string | null
    articleCount: number
  }>
): string {
  if (collections.length === 0) {
    return `${COLLECTIONS_STYLE}
<div class="jjc-wrap jjc-empty">暂无合集，敬请期待</div>`
  }
  const cards = collections
    .map(
      (c) => `
  <a class="jjc-card" href="/collections/${encodeURIComponent(c.slug)}">
    <h3 class="jjc-card__name">${escapeHtml(c.name)}</h3>
    ${c.description ? `<p class="jjc-card__desc">${escapeHtml(c.description)}</p>` : ""}
    <p class="jjc-card__count">${c.articleCount} 篇文章</p>
  </a>`
    )
    .join("")
  return `${COLLECTIONS_STYLE}
<div class="jjc-wrap jjc-grid">${cards}
</div>`
}
