const { createClient } = require("@libsql/client")
const path = require("path")
const c = createClient({ url: "file:" + path.join(process.cwd(), "data", "theme-sessions.db") })
;(async () => {
  const arts = await c.execute({ sql: "SELECT slug, title FROM articles WHERE published = 1 LIMIT 3", args: [] })
  console.log("slugs:", arts.rows.map((r) => `${r.slug}(${r.title})`).join(" | "))
})()