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

  it("grid-sidebar 布局容器不注入头像，头像注入到真正的 sidebar 内", () => {
    const html = withHost(
      `<div class="grid-sidebar">
        <div class="content-main">
          <section data-content="article-list" data-content-type="dynamic-articles">
            <article><a data-map="title">样本标题</a></article>
          </section>
        </div>
        <div class="sidebar"><h3>关于我</h3><p>作者简介</p></div>
      </div>`
    )
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    const doc = new JSDOM(out).window.document
    const host = doc.querySelector("[data-page-host]")!
    // 头像必须注入到 .sidebar 内，而不是 .grid-sidebar 的顶部
    expect(host.querySelector(".sidebar img.avatar")).not.toBeNull()
    expect(host.querySelector(".grid-sidebar > img.avatar")).toBeNull()
    const children = Array.from(host.querySelectorAll(".grid-sidebar > *"))
    expect(children[0]?.className ?? "").toContain("content-main")
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
    // 克隆项被 display:contents 的整卡 <a> 包裹，平铺为 section 直接子级（不嵌套进样本项内部）
    const directItems = section!.querySelectorAll(":scope > a > article.post-list-item")
    expect(directItems.length).toBe(2)
    // 没有嵌套 article（article 内不再包含 article）
    expect(section!.querySelectorAll("article article").length).toBe(0)
    // 样本项被清除，克隆项内容正确
    expect(out).not.toContain("样本标题")
    expect(directItems[0].textContent).toContain("真实文章A")
    expect(directItems[1].textContent).toContain("真实文章B")
    // 链接在整卡包裹层上，卡内原 <a> 已降级为 span
    expect(directItems[0].parentElement!.tagName).toBe("A")
    expect(directItems[0].parentElement!.getAttribute("href")).toBe("/blog/real-a")
    expect(directItems[0].querySelector(".date")!.textContent).toBe("2026-01-01")
  })

  it("卡片模板内嵌分类标签组 ul 时仍是合法模板，克隆卡片平铺且字段齐全", () => {
    // 复现真实 bug：卡片内嵌 <ul class="tag-list"><li><span data-map="category">>
    // 曾导致 looksLikeItemTemplate 拒绝卡片模板 + findDynamicListHost 误取标签组 ul，
    // 克隆出只有 category 的残缺 li
    const config: ContentConfig = {
      "article-list": {
        type: "dynamic-articles",
        label: "article-list",
        itemTemplate: `<article class="post-card">
          <div class="meta" data-map="date">2049.10.24</div>
          <h3 class="post-title"><a data-map="link" href="#"><span data-map="title">模板标题</span></a></h3>
          <p class="excerpt" data-map="excerpt">模板摘要</p>
          <ul class="tag-list"><li><span class="tag" data-map="category">CYBER</span></li></ul>
        </article>`,
        fieldMapping: {
          date: "date",
          link: "link",
          title: "title",
          excerpt: "excerpt",
          category: "category",
        },
      },
    }
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card">
        <div class="meta" data-map="date">2049.10.24</div>
        <h3 class="post-title"><a data-map="link" href="#"><span data-map="title">样本标题</span></a></h3>
        <p class="excerpt" data-map="excerpt">样本摘要</p>
        <ul class="tag-list"><li><span class="tag" data-map="category">CYBER</span></li></ul>
      </article>
    </section>`
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const dom = new JSDOM(out)
    const doc = dom.window.document
    const section = doc.querySelector('[data-content="article-list"]')
    expect(section).toBeTruthy()
    // 克隆卡片被整卡 <a> 包裹，平铺为 section 直接子级且数量正确
    const cards = section!.querySelectorAll(":scope > a > article.post-card")
    expect(cards.length).toBe(2)
    // 卡片未被嵌套进其他卡片，也没有残缺 li 克隆散落
    expect(section!.querySelectorAll("article article").length).toBe(0)
    // 样本内容被清除
    expect(out).not.toContain("样本标题")
    expect(out).not.toContain("样本摘要")
    // 字段全部替换为真实数据（含内嵌标签组里的 category）
    expect(cards[0].querySelector('[data-map="title"]')!.textContent).toContain("真实文章A")
    expect(cards[0].querySelector('[data-map="date"]')!.textContent).toBe("2026-01-01")
    expect(cards[0].querySelector('[data-map="link"]')!.getAttribute("href")).toBe("/blog/real-a")
    expect(cards[0].querySelector('[data-map="category"]')!.textContent).toBe("设计")
    expect(cards[1].querySelector('[data-map="category"]')!.textContent).toBe("随笔")
  })

  it("游离模板卡 + 网格包装容器时，真实卡片渲染进网格、样例全部清除", () => {
    // 复现首页真实 bug：容器首个子元素是被提取为 itemTemplate 的样例卡（带
    // data-map），真正的列表宿主是网格包装 div.magazine-grid（内部样例卡无
    // data-map）。曾导致真实文章被追加到 section、网格内样例卡残留。
    const config: ContentConfig = {
      "article-list": {
        type: "dynamic-articles",
        label: "article-list",
        itemTemplate: `<article class="post-card">
          <div class="meta">
            <span data-map="date">2084.11.05</span> // <span data-map="category">CYBER</span>
          </div>
          <h3 class="post-title"><a href="#" data-map="link"><span data-map="title">模板标题</span></a></h3>
          <p class="excerpt" data-map="excerpt">模板摘要</p>
          <ul class="tag-list"><li><a class="tag" href="#" data-map="link">SYNTHWAVE</a></li></ul>
        </article>`,
        fieldMapping: {
          date: "date",
          category: "category",
          link: "link",
          title: "title",
          excerpt: "excerpt",
        },
      },
    }
    const html = `<section class="section" data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card">
        <div class="meta">
          <span data-map="date">2084.11.05</span> // <span data-map="category">CYBER</span>
        </div>
        <h3 class="post-title"><a href="#" data-map="link"><span data-map="title">样本标题</span></a></h3>
        <p class="excerpt" data-map="excerpt">样本摘要</p>
        <ul class="tag-list"><li><a class="tag" href="#" data-map="link">SYNTHWAVE</a></li></ul>
      </article>
      <h2 class="section-title">最新电波</h2>
      <div class="magazine-grid">
        <article class="post-card"><div class="meta">2084.10.28 // TECH</div><h3 class="post-title">样例一</h3></article>
        <article class="post-card"><div class="meta">2084.10.12 // RETRO</div><h3 class="post-title">样例二</h3></article>
        <article class="post-card"><div class="meta">2084.09.30 // CODE</div><h3 class="post-title">样例三</h3></article>
      </div>
      <div><a class="btn" href="/blog/archive">查看全部档案</a></div>
    </section>`
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const dom = new JSDOM(out)
    const doc = dom.window.document
    const section = doc.querySelector('[data-content="article-list"]')
    expect(section).toBeTruthy()

    // 真实卡片渲染进网格包装内（不是 section 直接子级）
    const grid = section!.querySelector("div.magazine-grid")
    expect(grid).toBeTruthy()
    const cards = grid!.querySelectorAll(":scope > a > article.post-card")
    expect(cards.length).toBe(2)
    expect(section!.querySelectorAll(":scope > a > article.post-card").length).toBe(0)

    // section 的静态结构保留：标题 + 查看按钮
    expect(section!.querySelector("h2.section-title")?.textContent).toContain("最新电波")
    expect(out).toContain("查看全部档案")

    // 全部样例内容被清除（游离模板卡 + 网格内样例卡）
    expect(out).not.toContain("样本标题")
    expect(out).not.toContain("样本摘要")
    expect(out).not.toContain("样例一")
    expect(out).not.toContain("样例二")
    expect(out).not.toContain("样例三")
    expect(out).not.toContain("2084.10.28")

    // 字段全部替换为真实数据
    expect(cards[0].querySelector('[data-map="title"]')!.textContent).toContain("真实文章A")
    expect(cards[0].querySelector('[data-map="date"]')!.textContent).toBe("2026-01-01")
    expect(cards[0].querySelector('[data-map="category"]')!.textContent).toBe("设计")
    // 链接在整卡包裹层上，卡内原 link <a> 已降级为 span
    expect(cards[0].parentElement!.getAttribute("href")).toBe("/blog/real-a")

    // 标签形 link 锚点文本被分类填充，不再残留 SYNTHWAVE 样例（降级后为 span.tag）
    expect(out).not.toContain("SYNTHWAVE")
    expect(cards[0].querySelector("span.tag")!.textContent).toBe("设计")
    expect(cards[1].querySelector("span.tag")!.textContent).toBe("随笔")
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

describe("renderContent 详情页正文占位", () => {
  // 复现真实 bug 结构：data-map="body" 在 article-body 容器【外】（兄弟节点），
  // 且容器内 data-map 元素被 LLM 双重标记（data-map + data-content）
  const DETAIL_HTML = `<!DOCTYPE html>
<html><head><style>.container{max-width:800px}</style></head>
<body>
<nav><a href="/blog">首页</a></nav>
<div data-page-host="">
  <div class="container">
    <div class="article-header">
      <article data-content="article-body" data-content-type="article-body">
        <span class="tag" data-map="category" data-content="category" data-content-type="text">样本分类</span>
        <h1 data-map="title" data-content="title" data-content-type="text">样本标题</h1>
        <span data-map="date" data-content="date" data-content-type="text">2024-01-01</span>
      </article>
    </div>
    <div class="article-body">
      <div data-map="body">
        <p>样本假文章段落一</p>
        <h2>样本小标题</h2>
      </div>
    </div>
  </div>
</div>
</body></html>`

  const config: ContentConfig = {
    "article-body": {
      type: "article-body",
      label: "article-body",
      itemTemplate: "",
      fieldMapping: {},
    },
    category: { type: "text", label: "category", value: "样本分类" },
    title: { type: "text", label: "title", value: "样本标题" },
    date: { type: "text", label: "date", value: "2024-01-01" },
  }

  const dynamicData = {
    articles: [
      {
        id: 1,
        title: "真实文章标题",
        excerpt: "",
        date: "2026-08-01",
        category: "真实分类",
        slug: "real-a",
        contentHtml: "<p>真实文章正文</p>",
      },
    ],
  }

  it("body 在容器外时：正文写入 body 占位、样本内容被替换、标题头保留", () => {
    const out = renderContent(DETAIL_HTML, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const dom = new JSDOM(out)
    const doc = dom.window.document
    // 样本假文章消失，真实正文在 body 占位内
    expect(out).not.toContain("样本假文章段落一")
    expect(out).not.toContain("样本小标题")
    const bodyTarget = doc.querySelector('[data-map="body"]')
    expect(bodyTarget?.innerHTML).toContain("真实文章正文")
    // 容器未被整块替换：标题头仍在容器内
    const container = doc.querySelector('[data-content="article-body"]')
    expect(container?.querySelector('[data-map="title"]')).not.toBeNull()
  })

  it("双重标记的 data-map 元素不被文本字段样本值覆盖", () => {
    const out = renderContent(DETAIL_HTML, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    // data-map 元素保持动态真实值，而非 text 字段的样本值
    expect(out).toContain("真实文章标题")
    expect(out).toContain("真实分类")
    expect(out).toContain("2026-08-01")
    expect(out).not.toContain("样本标题")
    expect(out).not.toContain("样本分类")
  })
})

describe("renderContent 封面图渲染", () => {
  const LIST_CARD_HTML = `<section data-content="article-list" data-content-type="dynamic-articles">
    <article class="post-card">
      <div class="card-cover"><img data-map="cover" src="" alt="封面"></div>
      <h3 class="post-title"><a data-map="link" href="#"><span data-map="title">模板标题</span></a></h3>
    </article>
  </section>`

  const LIST_CARD_CONFIG: ContentConfig = {
    "article-list": {
      type: "dynamic-articles",
      label: "article-list",
      itemTemplate: `<article class="post-card">
        <div class="card-cover"><img data-map="cover" src="" alt="封面"></div>
        <h3 class="post-title"><a data-map="link" href="#"><span data-map="title">模板标题</span></a></h3>
      </article>`,
      fieldMapping: { cover: "cover", link: "link", title: "title" },
    },
  }

  it("列表卡片有封面时填充 img src，无封面时移除图片块", () => {
    const dynamicData = {
      articles: [
        { id: 1, title: "真实文章A", excerpt: "", date: "2026-01-01", category: "", slug: "real-a", cover: "/api/uploads/1" },
        { id: 2, title: "真实文章B", excerpt: "", date: "2026-01-02", category: "", slug: "real-b", cover: "" },
      ],
    }
    const out = renderContent(LIST_CARD_HTML, LIST_CARD_CONFIG, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const imgs = doc.querySelectorAll(".post-card img[data-map='cover']")
    expect(imgs.length).toBe(1)
    expect(imgs[0].getAttribute("src")).toBe("/api/uploads/1")
    // 无封面文章仅剩文字卡片，封面块（含空包装）已移除
    expect(doc.querySelectorAll(".card-cover").length).toBe(1)
  })

  it("列表卡片全部无封面时封面图片块（含空包装）被整体移除", () => {
    const dynamicData = {
      articles: [
        { id: 1, title: "真实文章A", excerpt: "", date: "2026-01-01", category: "", slug: "real-a", cover: "" },
        { id: 2, title: "真实文章B", excerpt: "", date: "2026-01-02", category: "", slug: "real-b", cover: "" },
      ],
    }
    const out = renderContent(LIST_CARD_HTML, LIST_CARD_CONFIG, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    expect(doc.querySelectorAll(".post-card img[data-map='cover']").length).toBe(0)
    expect(doc.querySelectorAll(".card-cover").length).toBe(0)
    expect(out).toContain("真实文章A")
    expect(out).toContain("真实文章B")
  })

  it("data-map=link 标在卡片容器上时，用 display:contents 的 <a> 包裹整卡使其可点击", () => {
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card" data-map="link">
        <div class="post-meta"><span data-map="date">2024.05</span></div>
        <h3 class="post-title" data-map="title">模板标题</h3>
        <p class="post-excerpt" data-map="excerpt">模板摘要</p>
      </article>
    </section>`
    const config: ContentConfig = {
      "article-list": {
        type: "dynamic-articles",
        label: "article-list",
        itemTemplate: `<article class="post-card" data-map="link">
          <div class="post-meta"><span data-map="date">2024.05</span></div>
          <h3 class="post-title" data-map="title">模板标题</h3>
          <p class="post-excerpt" data-map="excerpt">模板摘要</p>
        </article>`,
        // 真实场景：fieldMapping 不含 link（link 标在卡片容器上），走兜底包裹
        fieldMapping: { date: "date", title: "title", excerpt: "excerpt" },
      },
    }
    const dynamicData = {
      articles: [
        { id: 1, title: "真实文章A", excerpt: "摘要A", date: "2026-01-01", category: "", slug: "real-a" },
        { id: 2, title: "真实文章B", excerpt: "摘要B", date: "2026-01-02", category: "", slug: "real-b" },
      ],
    }
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const list = doc.querySelector('[data-content="article-list"]')!
    // 每张卡片被 <a style="display:contents" href="/blog/..."> 包裹
    const anchors = Array.from(list.children).filter((c) => c.tagName === "A")
    expect(anchors.length).toBe(2)
    expect(anchors[0].getAttribute("href")).toBe("/blog/real-a")
    expect(anchors[1].getAttribute("href")).toBe("/blog/real-b")
    expect(anchors.every((a) => a.getAttribute("style")?.includes("display:contents"))).toBe(true)
    expect(anchors[0].querySelector(".post-card .post-title")?.textContent).toContain("真实文章A")
    expect(anchors[0].querySelector(".post-card .post-excerpt")?.textContent).toContain("摘要A")
    // 原数据-map 仍在卡片上，但不在包裹锚点上
    expect(list.querySelector("article[data-map='link']")).not.toBeNull()
  })

  it("data-map=link 在卡内按钮上时，整卡被包裹成链接且按钮降级为 span（不嵌套 a）", () => {
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card">
        <h3 class="post-title" data-map="title">模板标题</h3>
        <a href="#" data-map="link" class="btn btn-sm">READ</a>
      </article>
    </section>`
    const config: ContentConfig = {
      "article-list": {
        type: "dynamic-articles",
        label: "article-list",
        itemTemplate: `<article class="post-card">
          <h3 class="post-title" data-map="title">模板标题</h3>
          <a href="#" data-map="link" class="btn btn-sm">READ</a>
        </article>`,
        fieldMapping: { title: "title", link: "link" },
      },
    }
    const dynamicData = {
      articles: [
        { id: 1, title: "真实文章A", excerpt: "", date: "2026-01-01", category: "", slug: "real-a" },
      ],
    }
    const out = renderContent(html, config, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const list = doc.querySelector('[data-content="article-list"]')!
    const wrapper = list.firstElementChild
    expect(wrapper?.tagName).toBe("A")
    expect(wrapper?.getAttribute("href")).toBe("/blog/real-a")
    expect(wrapper?.getAttribute("style")).toContain("display:contents")
    const card = wrapper?.querySelector(".post-card")
    expect(card).not.toBeNull()
    expect(card?.querySelector(".post-title")?.textContent).toContain("真实文章A")
    // 卡内按钮 <a> 已降级为 <span>，无嵌套 <a>，且按钮文案保留
    expect(wrapper?.querySelector("a")).toBeNull()
    const spanBtn = wrapper?.querySelector("span.btn")
    expect(spanBtn).not.toBeNull()
    expect(spanBtn?.textContent).toBe("READ")
  })

  const detailHtml = (withCoverPlaceholder: boolean) => `<!DOCTYPE html>
<html><head><style>.container{max-width:800px}</style></head>
<body>
<nav><a href="/blog">首页</a></nav>
<div data-page-host="">
  <div class="container">
    <article data-content="article-body" data-content-type="article-body">
      ${withCoverPlaceholder ? `<div class="article-cover"><img data-map="cover" src="" alt="封面"></div>` : ""}
      <h1 data-map="title" data-content="title" data-content-type="text">样本标题</h1>
    </article>
    <div data-map="body"><p>样本正文</p></div>
  </div>
</div>
</body></html>`

  const detailConfig: ContentConfig = {
    "article-body": { type: "article-body", label: "article-body", itemTemplate: "", fieldMapping: {} },
    title: { type: "text", label: "title", value: "样本标题" },
  }

  it("详情页有封面且容器无占位时在正文顶部注入封面图", () => {
    const dynamicData = {
      articles: [
        { id: 1, title: "真实标题", excerpt: "", date: "2026-08-01", category: "", slug: "real-a", contentHtml: "<p>真实正文</p>", cover: "/api/uploads/cover.png" },
      ],
    }
    const out = renderContent(detailHtml(false), detailConfig, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const body = doc.querySelector('[data-map="body"]')!
    const firstChild = body.firstElementChild as HTMLElement
    expect(firstChild.tagName.toLowerCase()).toBe("img")
    expect(firstChild.getAttribute("src")).toBe("/api/uploads/cover.png")
    expect(body.innerHTML).toContain("真实正文")
  })

  it("详情页有封面且容器含 data-map=cover 占位时填充 src 且不重复注入", () => {
    const dynamicData = {
      articles: [
        { id: 1, title: "真实标题", excerpt: "", date: "2026-08-01", category: "", slug: "real-a", contentHtml: "<p>真实正文</p>", cover: "/api/uploads/cover.png" },
      ],
    }
    const out = renderContent(detailHtml(true), detailConfig, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const imgs = doc.querySelectorAll('img[data-map="cover"]')
    expect(imgs.length).toBe(1)
    expect(imgs[0].getAttribute("src")).toBe("/api/uploads/cover.png")
    const body = doc.querySelector('[data-map="body"]')!
    expect((body.firstElementChild as HTMLElement).tagName.toLowerCase()).not.toBe("img")
  })

  it("详情页无封面时封面占位块被移除且不注入", () => {
    const dynamicData = {
      articles: [
        { id: 1, title: "真实标题", excerpt: "", date: "2026-08-01", category: "", slug: "real-a", contentHtml: "<p>真实正文</p>", cover: "" },
      ],
    }
    const out = renderContent(detailHtml(true), detailConfig, dynamicData, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    expect(doc.querySelectorAll('img[data-map="cover"]').length).toBe(0)
    expect(doc.querySelectorAll(".article-cover").length).toBe(0)
    const body = doc.querySelector('[data-map="body"]')!
    expect((body.firstElementChild as HTMLElement).tagName.toLowerCase()).not.toBe("img")
    expect(body.innerHTML).toContain("真实正文")
  })
})

describe("renderContent 静态标签云兜底", () => {
  const tags = [
    { id: "1", name: "Next.js", slug: "next-js" },
    { id: "2", name: "TypeScript", slug: "typescript" },
    { id: "3", name: "CSS", slug: "css" },
  ]
  const TS = (s: string) => ({ id: s, name: s, slug: s.toLowerCase() })

  const TAG_CLOUD_HTML = `<aside class="sidebar">
  <h3>标签云</h3>
  <ul class="tag-cloud">
    <li><a href="/blog/tag/retro">RETRO</a></li>
    <li><a href="/blog/tag/synthwave">SYNTHWAVE</a></li>
    <li><a href="/blog/tag/css">CSS</a></li>
    <li><a href="/blog/tag/sci-fi">SCI-FI</a></li>
    <li><a href="/blog/tag/design">DESIGN</a></li>
    <li><a href="/blog/tag/cyberpunk">CYBERPUNK</a></li>
  </ul>
</aside>`

  it("未标记静态标签链接被数据库标签替换 href 与文本", () => {
    const out = renderContent(
      `<!DOCTYPE html><body><main>${TAG_CLOUD_HTML}</main></body>`,
      {},
      { tags },
      undefined,
      { pageSpecific: true }
    )
    const dom = new JSDOM(out)
    const doc = dom.window.document
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/blog/tag/"]'))
    expect(links.length).toBe(3)
    expect(links[0].getAttribute("href")).toBe("/blog/tag/next-js")
    expect(links[0].textContent).toBe("Next.js")
    expect(links[1].getAttribute("href")).toBe("/blog/tag/typescript")
    expect(links[1].textContent).toBe("TypeScript")
    expect(links[2].getAttribute("href")).toBe("/blog/tag/css")
    expect(links[2].textContent).toBe("CSS")
    // 样本默认标签文本不再残留
    expect(out).not.toContain("RETRO")
    expect(out).not.toContain("SYNTHWAVE")
    expect(out).not.toContain("CYBERPUNK")
  })

  it("页面坑位少于数据库标签时按坑位数替换，不改变结构", () => {
    const html = `<body><ul class="tag-cloud">
      <li><a href="/blog/tag/retro">RETRO</a></li>
      <li><a href="/blog/tag/synthwave">SYNTHWAVE</a></li>
    </ul></body>`
    const out = renderContent(html, {}, { tags: [...tags, TS("架构")] }, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    const links = doc.querySelectorAll('a[href*="/blog/tag/"]')
    expect(links.length).toBe(2)
    expect(links[0].getAttribute("href")).toBe("/blog/tag/next-js")
    expect(links[1].getAttribute("href")).toBe("/blog/tag/typescript")
  })

  it("已标记 dynamic-tags 的区域不受影响（保留 data-map 结构）", () => {
    const html = `<body><section data-content="tag-cloud" data-content-type="dynamic-tags">
      <a href="#" data-map="link"><span data-map="name">占位</span></a>
    </section></body>`
    const out = renderContent(html, {}, { tags }, undefined, { pageSpecific: true })
    // 已标记区域不应被静态兜底触碰：data-map 结构保留，且不会被注入数据库标签链接
    expect(out).toContain('data-content="tag-cloud"')
    expect(out).toContain('data-map="link"')
    expect(out).toContain('data-map="name"')
    expect(out).not.toContain("/blog/tag/next-js")
  })

  const categories = [
    { id: "c1", name: "技术", slug: "tech" },
    { id: "c2", name: "设计", slug: "design" },
  ]
  const CAT = (s: string) => ({ id: s, name: s, slug: s.toLowerCase() })

  it("含分类链接的容器整体按分类列表重建，不混入标签", () => {
    const html = `<body><h2>筛选</h2><ul class="tag-list">
      <li><a href="/blog/archive">ALL</a></li>
      <li><a href="/blog/category/tech" class="tag">TECH</a></li>
      <li><a href="/blog/tag/next-js" class="tag">Next.js</a></li>
      <li><a href="/blog/category/design" class="tag">DESIGN</a></li>
      <li><a href="/blog/category/cyber" class="tag">CYBER</a></li>
    </ul></body>`
    const out = renderContent(
      html,
      {},
      { tags, categories },
      undefined,
      { pageSpecific: true }
    )
    const doc = new JSDOM(out).window.document
    const catLinks = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/blog/category/"]'))
    // 容器判定为分类列表：全部槽位用分类填充，标签槽位(Next.js)同样被分类(slot1)替换，
    // cyber 超出 categories 长度(2) 整项移除，故只剩 2 个分类链接
    expect(catLinks).toHaveLength(2)
    expect(catLinks[0].getAttribute("href")).toBe("/blog/category/tech")
    expect(catLinks[0].textContent).toBe("技术")
    expect(catLinks[1].getAttribute("href")).toBe("/blog/category/design")
    expect(catLinks[1].textContent).toBe("设计")
    // 非分类项 ALL 未被触碰
    expect(out).toContain('href="/blog/archive"')
    expect(out).not.toContain("DESIGN")
    expect(out).not.toContain("CYBER")
    // 不再向分类容器注入标签
    expect(out).not.toContain("/blog/tag/Next.js")
    expect(out).not.toContain(">Next.js<")
  })

  it("仅含标签链接的容整体按标签列表重建", () => {
    const html = `<body><ul class="tag-list">
      <li><a href="/blog/tag/retro" class="tag">RETRO</a></li>
      <li><a href="/blog/tag/synthwave" class="tag">SYNTHWAVE</a></li>
      <li><a href="/blog/tag/cyberpunk" class="tag">CYBERPUNK</a></li>
    </ul></body>`
    const out = renderContent(
      html,
      {},
      { tags, categories },
      undefined,
      { pageSpecific: true }
    )
    const doc = new JSDOM(out).window.document
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/blog/tag/"]'))
    expect(links).toHaveLength(3)
    expect(links[0].textContent).toBe("Next.js")
    expect(links[1].textContent).toBe("TypeScript")
    expect(links[2].textContent).toBe("CSS")
    expect(out).not.toContain("RETRO")
  })

  it("仅分类列表：分类链接被替换，且不依赖标签链接数量", () => {
    const html = `<body><ul class="tag-list">
      <li><a href="/blog/category/tech" class="tag">TECH</a></li>
      <li><a href="/blog/category/design" class="tag">DESIGN</a></li>
    </ul></body>`
    const out = renderContent(
      html,
      {},
      { categories: [...categories, CAT("建筑")] },
      undefined,
      { pageSpecific: true }
    )
    const doc = new JSDOM(out).window.document
    const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="/blog/category/"]'))
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute("href")).toBe("/blog/category/tech")
    expect(links[0].textContent).toBe("技术")
    expect(links[1].getAttribute("href")).toBe("/blog/category/design")
    expect(links[1].textContent).toBe("设计")
    expect(out).not.toContain('>TECH<')
    expect(out).not.toContain('>DESIGN<')
  })

  it("无标签也无分类数据时不触碰页面", () => {
    const html = `<body><ul class="tag-list">
      <li><a href="/blog/tag/retro">RETRO</a></li>
      <li><a href="/blog/category/tech">TECH</a></li>
    </ul></body>`
    const out = renderContent(html, {}, {}, undefined, { pageSpecific: true })
    expect(out).toContain("RETRO")
    expect(out).toContain("TECH")
  })

  it("页面宿主 data-page-host 不被误判为分类列表重建（回归：整页内容被误删）", () => {
    const html = `<body>
      <div data-page-host>
        <section class="hero">
          <div class="hero__tags tag-list">
            <a href="/blog/category/tech" class="tag">前端开发</a>
            <a href="/blog/tag/%E4%BA%8C%E6%AC%A1%E5%85%83" class="tag tag--accent">二次元</a>
            <a href="/blog/category/life" class="tag">日常随笔</a>
            <a href="#" class="tag tag--accent">赛博美学</a>
          </div>
        </section>
        <div class="container">
          <h2 data-content="latest-title">最新发布</h2>
          <section data-content="article-list" data-content-type="dynamic-articles">
            <article><h3 data-map="title">样例</h3></article>
          </section>
        </div>
      </div>
    </body>`
    const categories = [
      { id: "c1", name: "技术", slug: "tech" },
      { id: "c2", name: "生活", slug: "life" },
      { id: "c3", name: "教程", slug: "tutorial" },
    ]
    const tags = [{ id: "t1", name: "二次元", slug: "anime" }]
    const out = renderContent(html, {}, { tags, categories }, undefined, {
      pageSpecific: true,
    })
    const doc = new JSDOM(out).window.document
    // 页面宿主容器与其下区块必须完整保留，不被当作分类列表重写
    expect(doc.querySelectorAll("[data-page-host] > *")).toHaveLength(2)
    expect(out).toContain("最新发布")
    expect(out).toContain('data-content="article-list"')
    // 直接平铺的 <a> 标签槽位按数据库分类重建（三类槽位 → 技术/生活/教程）
    const links = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>("[data-page-host] a[href]")
    )
    const hrefs = links.map((a) => a.getAttribute("href"))
    expect(hrefs).toContain("/blog/category/tech")
    expect(hrefs).toContain("/blog/category/life")
    expect(hrefs).toContain("/blog/category/tutorial")
    // 非分类项（赛博美学 #）保留
    expect(hrefs).toContain("#")
  })

  it("直接平铺的纯标签 <a> 列表按标签数据重建", () => {
    const html = `<body>
      <div class="tag-list">
        <a href="/blog/tag/retro" class="tag">RETRO</a>
        <a href="/blog/tag/synthwave" class="tag">SYNTHWAVE</a>
      </div>
    </body>`
    const tags = [
      { id: "1", name: "Next.js", slug: "next-js" },
      { id: "2", name: "CSS", slug: "css" },
    ]
    const out = renderContent(html, {}, { tags }, undefined, { pageSpecific: true })
    const doc = new JSDOM(out).window.document
    const links = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>('a[href*="/blog/tag/"]')
    )
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute("href")).toBe("/blog/tag/next-js")
    expect(links[0].textContent).toBe("Next.js")
    expect(links[1].getAttribute("href")).toBe("/blog/tag/css")
    expect(links[1].textContent).toBe("CSS")
  })
})

describe("renderContent 可复用文本库绑定", () => {
  const HTML = `<div><p data-content="slogan"></p></div>`

  it("绑定可复用文本时渲染库中内容", () => {
    const config: ContentConfig = {
      slogan: {
        type: "text",
        label: "标语",
        value: "本地标语",
        source: "reusable-text",
        textKey: "slogan",
      },
    }
    const out = renderContent(HTML, config, undefined, undefined, undefined, {
      slogan: "共享标语",
    })
    expect(out).toContain("共享标语")
    expect(out).not.toContain("本地标语")
  })

  it("未绑定（source=theme）回退到主题本地值", () => {
    const config: ContentConfig = {
      slogan: { type: "text", label: "标语", value: "本地标语", source: "theme" },
    }
    const out = renderContent(HTML, config, undefined, undefined, undefined, {
      slogan: "共享标语",
    })
    expect(out).toContain("本地标语")
    expect(out).not.toContain("共享标语")
  })
})

describe("renderContent featured-articles 精选区块", () => {
  const CONFIG: ContentConfig = {
    "featured-articles": {
      type: "dynamic-articles",
      label: "精选文章",
      itemTemplate: `<article class="post-card">
        <a data-map="link" href="#"><span data-map="title">样本标题</span></a>
        <p data-map="excerpt">样本摘要</p>
        <span class="date" data-map="date">2026-01-01</span>
      </article>`,
      fieldMapping: { title: "title", link: "link", excerpt: "excerpt", date: "date" },
    },
  }
  const HTML = `<section data-content="featured-articles" data-content-type="dynamic-articles">
    <article class="post-card"><a data-map="link" href="#"><span data-map="title">样本标题</span></a></article>
  </section>`

  it("存在精选数据时用 featuredArticles 填充且不用 articles", () => {
    const dynamicData = {
      articles: [{ id: 9, title: "最新A", excerpt: "", date: "2026-01-01", category: "", slug: "latest-a" }],
      featuredArticles: [
        { id: 1, title: "精选甲", excerpt: "甲摘要", date: "2026-02-01", category: "设计", slug: "feat-a" },
        { id: 2, title: "精选乙", excerpt: "", date: "2026-02-02", category: "", slug: "feat-b" },
      ],
    }
    const out = renderContent(HTML, CONFIG, dynamicData, undefined, { pageSpecific: true })
    expect(out).toContain("精选甲")
    expect(out).toContain("精选乙")
    expect(out).toContain('href="/blog/feat-a"')
    expect(out).not.toContain("最新A")
    expect(out).not.toContain("样本标题")
    const doc = new JSDOM(out).window.document
    const item = doc.querySelector('[data-content="featured-articles"] > a > article')
    expect(item!.textContent).toContain("甲摘要")
  })

  it("未配置精选时回退到文章列表", () => {
    const dynamicData = {
      articles: [{ id: 9, title: "最新A", excerpt: "", date: "2026-01-01", category: "", slug: "latest-a" }],
    }
    const out = renderContent(HTML, CONFIG, dynamicData, undefined, { pageSpecific: true })
    expect(out).toContain("最新A")
    expect(out).toContain('href="/blog/latest-a"')
  })
})

describe("renderContent 静态时间锚点归档列表兜底", () => {
  const ARCHIVE_HTML = `<aside class="sidebar">
    <h3 class="sidebar-title" data-content="sidebar-archive-title" data-content-type="text">时间锚点</h3>
    <ul class="archive-list">
      <li class="archive-item"><span class="archive-date" data-content="archive-date-1" data-content-type="text">2024.05</span><a class="archive-title" data-content="archive-title-1" data-content-type="text" href="#">五月跃迁记录</a></li>
      <li class="archive-item"><span class="archive-date" data-content="archive-date-2" data-content-type="text">2024.04</span><a class="archive-title" data-content="archive-title-2" data-content-type="text" href="#">四月星图更新</a></li>
      <li class="archive-item"><span class="archive-date" data-content="archive-date-3" data-content-type="text">2024.03</span><a class="archive-title" data-content="archive-title-3" data-content-type="text" href="#">三月深空探测</a></li>
    </ul>
  </aside>`

  it("用最新文章重建静态归档列表（日期+标题+链接）", () => {
    const out = renderContent(
      ARCHIVE_HTML,
      {},
      {
        articles: [
          { id: 1, title: "文章甲", excerpt: "", date: "2026-08-01", slug: "a" },
          { id: 2, title: "文章乙", excerpt: "", date: "2026-07-15", slug: "b" },
        ],
      },
      undefined,
      { pageSpecific: true }
    )
    expect(out).toContain(">2026-08-01<")
    expect(out).toContain(">文章甲<")
    expect(out).toContain('href="/blog/a"')
    expect(out).toContain(">2026-07-15<")
    expect(out).toContain(">文章乙<")
    expect(out).not.toContain("五月跃迁记录")
    expect(out).not.toContain("2024.05")
  })

  it("无文章数据时保留样例静态归档", () => {
    const out = renderContent(ARCHIVE_HTML, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain("五月跃迁记录")
    expect(out).toContain("2024.05")
  })
})