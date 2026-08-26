// 临时验证：文章列表内容是否被真实文章替换（只读）
async function main() {
  for (const path of ['/blog', '/blog/archive']) {
    const res = await fetch('http://localhost:3000' + path)
    const html = await res.text()
    const { JSDOM } = require('jsdom')
    const doc = new JSDOM(html).window.document
    const items = doc.querySelectorAll('[data-content="article-list"] > article, [data-content="article-list"] article.post-card')
    const firstItem = items[0]
    const title = firstItem?.querySelector('[data-map="title"]')
    const date = firstItem?.querySelector('[data-map="date"]')
    const link = firstItem?.querySelector('[data-map="link"]')
    const excerpt = firstItem?.querySelector('[data-map="excerpt"]')
    console.log('===', path, '===')
    console.log('items:', items.length)
    console.log('first title:', title?.textContent?.trim().slice(0, 30))
    console.log('first date:', date?.textContent?.trim())
    console.log('first link href:', link?.getAttribute('href'))
    console.log('excerpt ok:', !!excerpt?.textContent?.trim())
    // 检查是否还是样本内容（赛博朋克样本）
    const samplePhrases = ['霓虹深渊的赛博回声', '磁带、显像管与像素诗', '故障艺术指南']
    for (const p of samplePhrases) {
      if (html.includes(p)) console.log('SAMPLE STILL PRESENT:', p)
    }
  }
}
main().catch((e) => console.log('ERR:', e.message))
