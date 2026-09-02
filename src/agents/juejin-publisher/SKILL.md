---
name: "juejin-publisher"
description: "自动将本地 Markdown 文章发布到掘金（juejin.cn）：登录态复用、填标题/正文/分类/标签并确认发布。当用户要求把 Markdown 或博客文章发布到掘金、或需要自动化掘金发文时调用。"
---

# juejin-publisher：掘金自动发布

通过 Playwright 驱动真实浏览器，把本地 Markdown 文章自动发布到掘金（juejin.cn）。登录态通过「复制掘金 Cookie 字符串」维护，无需反复扫码。

## 前置条件

- Node.js ≥ 20
- 已安装 playwright 与 chromium：
  ```bash
  npm install
  npm run install-browser   # 等价于 npx playwright install chromium
  ```
- 需要一份掘金登录后的 Cookie 字符串（见下）。

> 浏览器安装位置：默认安装到系统用户目录。若运行环境不允许写入系统目录（如沙箱/CI），可安装到项目内的 `.browsers` 目录（脚本会自动检测并优先使用）：
> ```bash
> PLAYWRIGHT_BROWSERS_PATH=./.browsers npx playwright install chromium
> ```

## 命令

> 在本项目（smart-blog-agent）内可通过根目录 npm scripts 调用：
> `npm run juejin:publish -- <参数...>`、`npm run juejin:test-cookie -- <参数...>`。

### 1. 准备掘金 Cookie（推荐方式）

在浏览器中登录掘金，复制登录后的 Cookie 字符串，把它交给脚本（任选其一）：

- **后台维护（本项目推荐）**：在后台「个人管理 → 掘金发布配置」粘贴并保存 Cookie，之后后台的「发布到掘金」按钮会自动使用它。
- **命令行传入**：发布时加 `--cookie "sessionid=xxx; passport_csrf_token=yyy; ..."`。
- **环境变量**：设置 `JUEJIN_COOKIE` 环境变量。

> 如何复制 Cookie：浏览器登录掘金 → F12 打开开发者工具 → Network（网络）标签 → 刷新页面并点击任意请求 → 在 Request Headers（请求头）中找到 `Cookie` 字段，复制其完整值。Cookie 失效后重新复制更新即可。

### 1.5 测试 Cookie 是否有效

无需启动浏览器，直接请求掘金 API 校验登录态：

```bash
node scripts/test.mjs [--cookie "sessionid=xxx; ..."]
```

不传 `--cookie` 时依次回退到 `JUEJIN_COOKIE` 环境变量、`.auth/juejin.json`。有效时输出 `{"ok":true,"message":"Cookie 有效，登录态正常"}`；失效时输出 `ok:false` 并提示重新复制。后台「个人管理 → 掘金发布配置 → 测试连接」按钮即为该功能的界面封装。

### 2. 发布文章

```bash
node scripts/publish.mjs --file ./article.md [--title 标题] [--tags 前端,后端,工具] [--category 前端] [--article-id <掘金postID>] [--force-new] [--cookie "sessionid=..."] [--headless] [--timeout 180000]
```

参数：

| 参数 | 说明 |
|------|------|
| `--file` | 必填。Markdown 文件路径（相对或绝对）。首行 `# 标题` 会作为文章标题。 |
| `--title` | 可选。覆盖标题（不传则取文件首行 `# 标题`）。 |
| `--tags` | 可选。逗号分隔的标签列表，例如 `前端,后端`。不传则尝试从文件 front matter 读取 `tags`。 |
| `--category` | 可选。掘金分类名，例如 `前端`。不传则默认选第一个分类。 |
| `--article-id` | 可选。本地维护的掘金文章 post id。提供后脚本先探测该文章在掘金是否仍存在：存在 → 走**更新流程**（打开草稿编辑器，清空旧正文后重新填写并发布）；不存在 → 自动回退**新增流程**并提示。 |
| `--force-new` | 可选。即使提供了 `--article-id` 也强制走新增流程（发布成功后得到的新 post id 会覆盖旧绑定）。 |
| `--cookie` | 可选。掘金登录 Cookie 字符串；不传时回退到 `.auth/juejin.json` 或 `JUEJIN_COOKIE` 环境变量。 |
| `--headless` | 可选。无头模式运行（不推荐：遇到验证码/滑块无法人工处理）。 |
| `--dry-run` | 可选。试跑模式：填充标题/正文/分类/标签并在发布弹窗就绪后停住，不执行最终发布，用于验证流程。 |
| `--timeout` | 可选。整体超时毫秒数，默认 180000（3 分钟）。 |

> **发布模式判定**：提供 `--article-id` 且未传 `--force-new` 时，脚本先调用掘金 `content_api/v1/article/detail` 接口（`article_id` 传数字、带 `aid=2608` 等参数，仅本人文章才返回 `draft_id`）快速探测；接口无果时再通过**浏览器**打开 `https://juejin.cn/post/<id>` 判定存在性，并从本人文章的「编辑」入口提取 `draft_id`。文章不存在 → 自动新增；存在但找不到草稿编辑入口 → 中止并报错（避免误新增重复文章）；如需无视绑定强制新增请加 `--force-new`。

输出为一行 JSON：

```json
{ "ok": true, "title": "...", "url": "https://juejin.cn/post/<id>", "postId": "<id>", "status": "published", "message": "..." }
```

`postId` 为发布/更新成功后的掘金文章 id，建议回写维护，下次再带 `--article-id` 即可自动更新。`dry-run` 时结果含 `mode: "update" | "new"` 标明命中的流程。

或失败：

```json
{ "ok": false, "message": "错误说明，含截图路径" }
```

### Markdown 文件格式约定

- 第一行是 `# 标题`（作为掘金标题；已通过 `--title` 指定时可不写）。
- 正文用标准 Markdown（`##` 小标题、列表、代码块等）。
- 可选 front matter 元数据：
  ```markdown
  ---
  title: 文章标题
  tags: 前端, 后端
  category: 前端
  ---
  ```

## 自然语言触发示例

- 「把 ./article.md 发布到掘金，标签 前端、工具，分类 前端」→
  `node scripts/publish.mjs --file ./article.md --tags 前端,工具 --category 前端`
- 「把 ./docs/xxx.md 发布到掘金」→ `node scripts/publish.mjs --file ./docs/xxx.md`

## 注意事项

- **正文输入方式**：掘金编辑器基于 CodeMirror，不能直接 `fill()` 正文，脚本使用「复制到剪贴板 + Ctrl+V 粘贴」的方式，粘贴后掘金会自动解析 Markdown 并重新上传其中的图片。
- **验证码 / 滑块**：默认非无头模式。若发布途中出现验证码或滑块，脚本会暂停并提示，等待人工处理完成后按回车继续。
- **分类与标签**：发布弹窗中分类必须选 1 个；标签建议至少 1 个、3 个更佳。脚本会逐个输入并选中标签。
- **更新已有文章**：带 `--article-id` 且掘金上该文章仍存在时走更新流程（进入草稿编辑器，清空旧正文后重新填写并发布）；更新后掘金会再次审核，属平台机制。文章不存在时自动回退新增；文章存在但未能定位「编辑」入口时中止并报错（避免误新增重复文章），可改用 `--force-new` 强制新增。
- **失败排查**：脚本异常时会保存现场截图到 `.tmp/failure-<时间戳>.png`，可据此排查选择器是否因平台改版失效。
- **登录失效**：若发布时报「未登录」或重定向到登录页，重新复制最新的掘金 Cookie 并更新后台配置（或 `--cookie`）即可。
