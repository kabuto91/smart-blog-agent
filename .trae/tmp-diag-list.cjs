// 临时诊断：分析渲染后列表项的结构与 data-map 状态（只读）
async function main() {
  const res = await fetch('http://localhost:3000/blog/archive')
  const html = await res.text()
  const fs = require('fs')
  fs.writeFileSync('.trae/tmp-archive-rendered.html', html)

  const { JSDOM } = require('jsdom')
  const doc = new JSDOM(html).window.document
  const section = doc.querySelector('[data-content="article-list"]')
  if (!section) {
    console.log('NO section')
    return
  }
  console.log('section children:', section.children.length)
  for (const c of Array.from(section.children)) {
    const maps = Array.from(c.querySelectorAll('[data-map]')).map(
      (m) => m.getAttribute('data-map') + '=' + (m.textContent || '').trim().slice(0, 12)
    )
    console.log(
      '<' + c.tagName.toLowerCase() + ' class=' + (c.getAttribute('class') || '') + '> maps:',
      JSON.stringify(maps)
    )
  }
}
main().catch((e) => console.log('ERR:', e.message))
