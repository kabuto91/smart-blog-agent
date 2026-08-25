import { describe, it, expect } from "vitest"
import { JSDOM } from "jsdom"
import { renderContent, ensureSingleAuthorAvatar } from "./content-renderer"
import type { ContentConfig } from "../types/content-config"

describe("renderContent pageSpecific", () => {
  const config: ContentConfig = {
    "hero-title": { type: "text", label: "Hero", value: "你好" },
  }

  it("拆分模式下跳过 hero/banner 启发式剪枝，保留正文", () => {
    const out = renderContent(SKELETON_TEMPLATE, config, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain("你好")
    expect(out).toContain("article-list")
  })
})

const SKELETON_TEMPLATE = `<!DOCTYPE html>
<html>
<head><style>.hero{padding:40px}.post-list{display:grid}.container{max-width:900px}</style></head>
<body>
<nav><a href="/blog">首页</a></nav>
<main>
  <section class="hero" data-page-type="home"><h2 data-content="hero-title" data-content-type="text">Hero</h2></section>
  <div data-page-type="home list" class="container"></div>
  <section><div data-content="article-list" data-content-type="dynamic-articles"><article class="post-list"></article></div></section>
</main>
<footer>footer</footer>
</body>
</html>`

describe("renderContent nav-label 不被文本字段覆盖", () => {
  const config: ContentConfig = {
    "main-nav": {
      type: "nav-list",
      label: "main-nav",
      items: [
        { label: "首页", href: "/blog" },
        { label: "归档", href: "/blog/archive" },
      ],
      itemTemplate:
        '<a href="{href}" class="nav-brand" data-content="blog-title" data-content-type="text">{label}</a>',
    },
  }
  const layout = `<nav class="main-nav" data-content="main-nav" data-content-type="nav-list"><a href="/">导航</a></nav>`

  it("nav 链接的 data-content=blog-title 不被全局标题覆盖", () => {
    const out = renderContent(
      layout,
      config,
      undefined,
      { "blog-title": "刚入行的小菜鸟" },
      { pageSpecific: true }
    )
    expect(out).toContain('>首页</a>')
    expect(out).toContain('>归档</a>')
    expect(out).not.toContain('>刚入行的小菜鸟</a>')
  })
})

describe("renderContent legacy mode", () => {
  it("非拆分模式仍执行 data-page-type 剪枝（保留 home）", () => {
    // resolvePageType(undefined) => home
    const out = renderContent(SKELETON_TEMPLATE, {}, undefined, undefined)
    expect(out).toContain("Hero")
    expect(out).not.toContain('data-page-type="list"')
  })
})

describe("renderContent nav 结构保留", () => {
  const config: ContentConfig = {
    "main-nav": {
      type: "nav-list",
      label: "main-nav",
      items: [
        { label: "首页", href: "/blog" },
        { label: "归档", href: "/blog/archive" },
      ],
      itemTemplate: '<li><a href="{href}">{label}</a></li>',
    },
  }
  const layout = `<nav class="main-nav" data-content="main-nav" data-content-type="nav-list">
  <div class="nav-inner">
    <a href="/blog" class="nav-brand"><span>极简日志</span></a>
    <ul class="nav-links"><li><a href="/">占位</a></li></ul>
  </div>
</nav>`

  it("渲染到 .nav-links 列表容器而非展平导航", () => {
    const out = renderContent(layout, config, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain('<ul class="nav-links">')
    expect(out).toContain("<li><a href=\"/blog\">首页</a></li>")
    expect(out).toContain("<li><a href=\"/blog/archive\">归档</a></li>")
    expect(out).toContain('class="nav-brand"')
    // 不再是品牌模板套在所有链接上
    expect(out).not.toContain('class="nav-brand">首页')
  })

  it("无列表容器时退化为直接 a 渲染", () => {
    const flat = `<nav class="main-nav" data-content="main-nav" data-content-type="nav-list"><a href="/">占位</a></nav>`
    const out = renderContent(flat, config, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain('href="/blog">首页</a>')
    expect(out).toContain('href="/blog/archive">归档</a>')
  })

  it("页面级内容不被垂直导航遮挡（padding-top 由 --nav-h 驱动）", () => {
    // 渲染前后都应保留 host 的 padding-top 占位
    const withHost = `<div data-page-host="" style="padding-top:var(--nav-h,0px)"></div>`
    const out = renderContent(withHost, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain('style="padding-top:var(--nav-h,0px)"')
  })
})

describe("renderContent author-avatar", () => {
  const AVATAR_URL = "/api/uploads/abc"

  it("无 data-content 的 .avatar 容器，img src 为空时自动填充全局头像", () => {
    const html = `<div class="avatar"><img src="" alt="头像"></div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`src="${AVATAR_URL}"`)
  })

  it("带 data-content=\"author-avatar\" 的元素会被全局头像填充", () => {
    const html = `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="头像">`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`src="${AVATAR_URL}"`)
  })

  it("管理后台配置的头像会覆盖主题中的占位 src", () => {
    const html = `<div class="avatar"><img src="https://example.com/x.png" alt="头像"></div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`src="${AVATAR_URL}"`)
  })

  it("未配置全局头像时不注入", () => {
    const html = `<div class="avatar"><img src="" alt="头像"></div>`
    const out = renderContent(html, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain('src=""')
  })
})

describe("renderContent 渐变圆形头像占位兜底", () => {
  const AVATAR_URL = "/api/uploads/abc"

  it("圆形+渐变的空 div 会被填充为头像背景", () => {
    const html = `<div class="sidebar-widget">
      <div style="width:64px;height:64px;border-radius:var(--radius-full);background:linear-gradient(135deg,#111,#222);margin-bottom:8px;"></div>
      <p data-content="author-name" data-content-type="text">作者</p>
    </div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain("background-image: url")
    expect(out).toContain(AVATAR_URL)
  })

  it("有内容或含 img 的圆形元素不被覆盖", () => {
    const withText = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);">文字</div>`
    expect(
      renderContent(withText, {}, undefined, { "author-avatar": AVATAR_URL }, {
        pageSpecific: true,
      })
    ).not.toContain(`background-image: url("${AVATAR_URL}")`)

    const withImg = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);"><img src=""></div>`
    expect(
      renderContent(withImg, {}, undefined, { "author-avatar": AVATAR_URL }, {
        pageSpecific: true,
      })
    ).not.toContain(`background-image: url("${AVATAR_URL}")`)
  })

  it("未配置头像时保持渐变占位", () => {
    const html = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);"></div>`
    const out = renderContent(html, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).not.toContain("background-image:")
    expect(out).toContain("linear-gradient")
  })
})

describe("renderContent ensureMultipleAvatarPlaces 兜底", () => {
  const AVATAR_URL = "/api/uploads/avatar1"

  const withHost = (body: string) =>
    `<body><nav><a href="/">导航</a></nav><div data-page-host="">${body}</div><footer>尾</footer></body>`

  it("正文区域内无头像标记时，在 aside 顶部注入头像", () => {
    const html = withHost("<aside><p>侧边栏内容</p></aside>")
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`<img class="avatar" src="${AVATAR_URL}"`)
    expect(out).toContain("侧边栏内容")
  })

  it("正文区域已含 data-content=author-avatar 时不注入", () => {
    const html = withHost(
      '<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="头像"><aside><p>内容</p></aside>'
    )
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    // data-page-host 内的 aside 不应被额外注入头像
    const hostMatch = out.match(/data-page-host=""[^>]*>([\s\S]*?)<\/div>/)
    const hostContent = hostMatch?.[1] ?? ""
    const avatarInHost = hostContent.match(/<img class="avatar"/g)
    // 只有 renderTextField 填充的那一个，不应多出额外注入
    expect(avatarInHost?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it("正文区域已含 class=avatar 的 img 时不注入", () => {
    const html = withHost(
      '<div class="avatar"><img src="" alt="头像"></div><aside><p>内容</p></aside>'
    )
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    const hostMatch = out.match(/data-page-host=""[^>]*>([\s\S]*?)<\/div>/)
    const hostContent = hostMatch?.[1] ?? ""
    const avatarInHost = hostContent.match(/<img class="avatar"/g)
    expect(avatarInHost?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it("无 aside 但有含 author 类的容器时，注入到该容器", () => {
    const html = withHost('<div class="author-card"><p>作者简介</p></div>')
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`<img class="avatar" src="${AVATAR_URL}"`)
    expect(out).toContain("作者简介")
  })

  it("无 aside 也无 author 容器时，不注入裸头像到正文顶部", () => {
    const html = withHost("<p>正文内容</p>")
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    const hostMatch = out.match(/data-page-host=""[^>]*>([\s\S]*?)<\/div>/)
    const hostContent = hostMatch?.[1] ?? ""
    expect(hostContent).not.toContain(`<img class="avatar" src="${AVATAR_URL}"`)
  })

  it("无 data-page-host 时不报错", () => {
    const html = `<body><main><p>无 host</p></main></body>`
    expect(() =>
      renderContent(
        html,
        {},
        undefined,
        { "author-avatar": AVATAR_URL },
        { pageSpecific: true }
      )
    ).not.toThrow()
  })

  it("未配置头像时不注入", () => {
    const html = withHost("<aside><p>内容</p></aside>")
    const out = renderContent(html, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).not.toContain(`class="avatar" src=`)
  })

  it("导航栏有头像但正文无作者容器时，正文区域不注入裸头像", () => {
    // 模拟：导航栏有 avatar（通过骨架生成），但正文区域没有可承载作者信息的容器
    const html = `<body>
      <nav><img class="avatar" src="/nav-avatar.png" alt="导航头像"><a href="/">首页</a></nav>
      <div data-page-host=""><p>正文内容</p></div>
      <footer>尾</footer>
    </body>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    // 正文区域不应被注入孤立头像
    const hostMatch = out.match(/data-page-host=""[^>]*>([\s\S]*?)<\/div>/)
    expect(hostMatch?.[1]).not.toContain(`<img class="avatar" src="${AVATAR_URL}"`)
  })
})

describe("renderContent 动态列表不重复整块面板", () => {
  const PANEL_HTML = `<section class="section" data-content="article-list" data-content-type="dynamic-articles">
  <div class="container">
    <h2 class="section-title">近期文章</h2>
    <ul class="archive-list">
      <li class="archive-item" data-map="template">
        <span class="archive-item__date" data-map="date">2024.03.01</span>
        <a href="#" class="archive-item__title" data-map="link">模板标题</a>
        <span class="archive-item__cat" data-map="category">设计</span>
      </li>
      <li class="archive-item">
        <span class="archive-item__date">2024.02.22</span>
        <a href="/blog/a-sample-slug" class="archive-item__title">示例一</a>
        <span class="archive-item__cat">设计</span>
      </li>
      <li class="archive-item">
        <span class="archive-item__date">2024.02.15</span>
        <a href="/blog/a-sample-slug" class="archive-item__title">示例二</a>
        <span class="archive-item__cat">随笔</span>
      </li>
    </ul>
    <div style="text-align: center; margin-top: 64px;">
      <a href="/blog/archive" class="btn">查看归档</a>
    </div>
  </div>
</section>`

  const PANEL_CONFIG: ContentConfig = {
    "article-list": {
      type: "dynamic-articles",
      label: "article-list",
      itemTemplate: `<div class="container">
    <h2 class="section-title">近期文章</h2>
    <ul class="archive-list">
      <li class="archive-item" data-map="template">
        <span class="archive-item__date" data-map="date">2024.03.01</span>
        <a href="#" class="archive-item__title" data-map="link">模板标题</a>
        <span class="archive-item__cat" data-map="category">设计</span>
      </li>
      <li class="archive-item">
        <span class="archive-item__date">2024.02.22</span>
        <a href="/blog/a-sample-slug" class="archive-item__title">示例一</a>
        <span class="archive-item__cat">设计</span>
      </li>
      <li class="archive-item">
        <span class="archive-item__date">2024.02.15</span>
        <a href="/blog/a-sample-slug" class="archive-item__title">示例二</a>
        <span class="archive-item__cat">随笔</span>
      </li>
    </ul>
    <div style="text-align: center; margin-top: 64px;">
      <a href="/blog/archive" class="btn">查看归档</a>
    </div>
  </div>`,
      fieldMapping: {
        template: "template",
        date: "date",
        link: "link",
        category: "category",
      },
    },
  }

  const dynamicData = {
    articles: [
      { id: 1, title: "真实文章A", excerpt: "", date: "2026-01-01", category: "设计", slug: "real-a" },
      { id: 2, title: "真实文章B", excerpt: "", date: "2026-01-02", category: "随笔", slug: "real-b" },
    ],
  }

  it("itemTemplate 为整块面板时不逐条复制面板，标题/按钮只渲染一次", () => {
    const out = renderContent(PANEL_HTML, PANEL_CONFIG, dynamicData, undefined, {
      pageSpecific: true,
    })
    expect(out.match(/近期文章/g)?.length ?? 0).toBe(1)
    expect(out.match(/查看归档/g)?.length ?? 0).toBe(1)
    expect(out).toContain("真实文章A")
    expect(out).toContain("真实文章B")
    expect(out).toContain('href="/blog/real-a"')
    expect(out).toContain('href="/blog/real-b"')
    expect(out).not.toContain("示例一")
    expect(out).not.toContain("示例二")
    expect(out).not.toContain("模板标题")
  })

  it("首子元素即列表项（常规）时保持原行为，N 项全部渲染", () => {
    const config: ContentConfig = {
      "articles": {
        type: "dynamic-articles",
        label: "articles",
        itemTemplate: `<li class="archive-item">
          <time class="archive-item__date" data-map="date">2023.10.24</time>
          <a href="#" class="archive-item__title" data-map="link"><span data-map="title">模板</span></a>
          <span class="archive-item__cat" data-map="category">设计</span>
        </li>`,
        fieldMapping: {
          date: "date",
          link: "link",
          title: "title",
          category: "category",
        },
      },
    }
    const html = `<ul class="archive-list" data-content="articles" data-content-type="dynamic-articles">
      <li class="archive-item">占位模板</li>
    </ul>`
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain("真实文章A")
    expect(out).toContain("真实文章B")
    expect(out).toContain('href="/blog/real-a"')
    expect(out).not.toContain("占位模板")
  })

  it("容器直接含单个样本项且与 itemTemplate 同构时，克隆项平铺不嵌套", () => {
    // 复现列表页 bug：section 直接含唯一样本 <article class="post-list-item">，
    // itemTemplate 与样本同构（同标签同类名），宿主应回退为 section 自身
    const config: ContentConfig = {
      "article-list": {
        type: "dynamic-articles",
        label: "article-list",
        itemTemplate: `<article class="post-list-item">
          <span class="date" data-map="date">2023-10-24</span>
          <a class="title" data-map="link" href="#"><span data-map="title">模板标题</span></a>
        </article>`,
        fieldMapping: {
          date: "date",
          link: "link",
          title: "title",
        },
      },
    }
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-list-item">
        <span class="date" data-map="date">2023-10-24</span>
        <a class="title" data-map="link" href="#"><span data-map="title">样本标题</span></a>
      </article>
    </section>`
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const dom = new JSDOM(out)
    const doc = dom.window.document
    const section = doc.querySelector('[data-content="article-list"]')
    expect(section).toBeTruthy()
    // 克隆项是 section 的直接子元素（不嵌套进样本项内部）
    const directItems = section!.querySelectorAll(":scope > article.post-list-item")
    expect(directItems.length).toBe(2)
    // 没有嵌套 article（article 内不再包含 article）
    expect(section!.querySelectorAll("article article").length).toBe(0)
    // 样本项被清除，克隆项内容正确
    expect(out).not.toContain("样本标题")
    expect(directItems[0].textContent).toContain("真实文章A")
    expect(directItems[1].textContent).toContain("真实文章B")
    expect(directItems[0].querySelector("a")!.getAttribute("href")).toBe("/blog/real-a")
    expect(directItems[0].querySelector(".date")!.textContent).toBe("2026-01-01")
  })
})

describe("ensureSingleAuthorAvatar", () => {
  function count(doc: Document): number {
    return doc.querySelectorAll(
      '[data-content="author-avatar"], img.avatar, [class*="avatar"]'
    ).length
  }

  it("同一页面 3 个头像时只保留 1 个", () => {
    const dom = new JSDOM(`<body>
      <nav><img class="avatar" data-content="author-avatar" src="" alt="导航头像"></nav>
      <section class="hero"><img class="avatar" data-content="author-avatar" src="" alt="hero头像"></section>
      <aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="作者头像"></aside>
    </body>`)
    ensureSingleAuthorAvatar(dom.window.document)
    expect(count(dom.window.document)).toBe(1)
    // 优先保留作者/简介区内的头像
    expect(dom.window.document.querySelector(".author-bio")).not.toBeNull()
    expect(dom.window.document.querySelector(".author-bio img")).not.toBeNull()
  })

  it("移除多余头像时保留兄弟文字与结构", () => {
    const dom = new JSDOM(`<body>
      <nav><img class="avatar" data-content="author-avatar" src="" alt="导航头像"></nav>
      <aside class="author-bio"><h3>关于我</h3><img class="avatar" data-content="author-avatar" src="" alt="作者头像"></aside>
    </body>`)
    ensureSingleAuthorAvatar(dom.window.document)
    expect(count(dom.window.document)).toBe(1)
    // 作者区文字仍在，头像被保留
    expect(dom.window.document.querySelector(".author-bio h3")?.textContent).toBe(
      "关于我"
    )
    expect(dom.window.document.querySelector("nav img")).toBeNull()
  })

  it("仅 1 个头像时不破坏布局", () => {
    const dom = new JSDOM(`<body>
      <aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="作者头像"></aside>
    </body>`)
    ensureSingleAuthorAvatar(dom.window.document)
    expect(count(dom.window.document)).toBe(1)
  })

  it("装饰性渐变圆不作为头像被删除", () => {
    const dom = new JSDOM(`<body>
      <div class="blob" style="border-radius:50%;width:80px;height:80px;background:radial-gradient(circle,#fff,#000)"></div>
      <div class="blob" style="border-radius:50%;width:120px;height:120px;background:linear-gradient(135deg,#f00,#00f)"></div>
      <aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="作者头像"></aside>
    </body>`)
    ensureSingleAuthorAvatar(dom.window.document)
    // 两个装饰渐变圆保留，作者头像保留，总计 3 个视觉元素
    expect(dom.window.document.querySelectorAll(".blob").length).toBe(2)
    expect(dom.window.document.querySelector('[data-content="author-avatar"]')).not.toBeNull()
  })
})