// 临时验证：首页卡片内部结构（只读）
async function main() {
  const res = await fetch('http://localhost:3000/blog')
  const html = await res.text()
  const { JSDOM } = require('jsdom')
  const doc = new JSDOM(html).window.document
  const grid = doc.querySelector('[data-content="article-list"] .magazine-grid')
  if (!grid) { console.log('NO grid'); return }
  console.log('=== first card innerHTML (400 chars) ===')
  console.log((grid.children[0].innerHTML || '').replace(/\s+/g, ' ').slice(0, 400))
  console.log('=== card count:', grid.children.length)
  const section = doc.querySelector('[data-content="article-list"]')
  console.log('=== section inner (first 300):', (section?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 300))
}
main().catch((e) => console.log('ERR:', e.message))
