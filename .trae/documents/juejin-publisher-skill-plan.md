# 掘金自动发布 Skill 实施计划（juejin-publisher）

## 一、目标

实现「自动把 Markdown 文章发布到掘金（juejin.cn）」的功能，底层用 **Playwright** 驱动真实浏览器完成登录态复用、标题/正文/分类/标签填写与发布确认。同时按 skill-creator 规范封装成 **自包含、可移植** 的 skill，既可被本项目 agent 调用，也可整体拷贝到其他 agent / 项目中使用。

## 二、用户已确认的决策

| 决策点 | 选择 |
|---|---|
| Skill 安装位置 | 放在 `src/agents/` 目录下（自包含文件夹，便于本项目与跨项目使用） |
| 项目集成 | **Skill + 后台按钮**：后台文章编辑弹窗增加「发布到掘金」按钮 + API 路由 |
| 脚本输入方式 | **Markdown 文件 + CLI 参数**（首行 `# 标题` 作为标题，`--title/--tags/--category` 可覆盖/补充） |

## 三、现状分析

### 3.1 项目相关结构（已确认）
- 文章以 **Markdown** 存在数据库 `Article.content`，见 [articles.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/lib/articles.ts)（`ArticleListItem.content` 与 `ArticleRow.content`）。
- 管理后台文章编辑弹窗在 [article-editor-dialog.tsx](file:///d:/frontProjects/agent/smart-blog-agent/src/components/admin/article-editor-dialog.tsx)，底部操作栏在约 L722-L746（发布勾选 / 取消 / 保存）。
- 文章相关 API 路由位于 `src/app/api/articles/`（POST/PATCH/DELETE 模式清晰，见 [route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/articles/route.ts) 与 [\[id\]/route.ts](file:///d:/frontProjects/agent/smart-blog-agent/src/app/api/articles/[id]/route.ts)）。
- 根 [package.json](file:///d:/frontProjects/agent/smart-blog-agent/package.json) 目前 **没有** playwright 依赖；`@types/node` 已存在（可用 `child_process`）。
- 项目无 `.trae/skills/`；skill-creator 说明自定义 skill 目录应为 `.trae/skills/<name>/`，但用户明确要求放在 `src/agents/` 下。

### 3.2 掘金发布流程要点（已通过检索确认）
- 编辑器入口：`https://juejin.cn/editor/drafts/new?v=2`；标题输入框：`//input[@placeholder="输入文章标题..."]`。
- 正文使用 **CodeMirror** 富文本编辑器，**不能用 `fill()`**，必须**复制到剪贴板 + Ctrl+V 粘贴**，粘贴后掘金自动解析 Markdown 并上传其中图片。
- 登录态：用 Playwright `storage_state` 保存 cookie+localStorage 到本地 JSON，一次扫码登录后长期复用。
- 发布弹窗需：选择 **1 个分类**（`.form-item-content.category-list` 下按文字匹配）；添加**至少 1 个、建议 3 个标签**（点击 `请搜索添加标签` 下拉，输入并选中下拉项）；点击「发布」→「确定并发布」。
- 发布成功跳转 `https://juejin.cn/post/<id>` 或审核中的 `https://juejin.cn/spost/<id>`。
- 可能遇到验证码/滑块，需暂停等待人工处理。

## 四、变更内容

### 4.1 新建 Skill 目录 `src/agents/juejin-publisher/`（自包含、可整体拷贝）

```
src/agents/juejin-publisher/
├── SKILL.md                 # skill 定义（frontmatter + 使用说明），供任意 agent 读取执行
├── package.json             # 自包含依赖清单（playwright），拷贝后可独立 npm install
├── .gitignore               # 忽略 .auth/、node_modules/、.tmp/
└── scripts/
    ├── login.mjs            # 一次性登录：打开浏览器 → 扫码登录 → 保存 storage state
    └── publish.mjs          # 主 CLI：解析 md + 参数 → 驱动浏览器发布 → 输出 JSON 结果
```

#### 4.1.1 `SKILL.md`
frontmatter：
```yaml
---
name: "juejin-publisher"
description: "自动将本地 Markdown 文章发布到掘金（juejin.cn）：登录态复用、填标题/正文/分类/标签并确认发布。当用户要求把 Markdown 或博客文章发布到掘金、或需要自动化掘金发文时调用。"
---
```
正文包含：功能说明、前置条件（Node ≥ 20、安装 playwright 与 chromium）、两条命令（login / publish）的完整用法与参数、自然语言触发示例、CodeMirror 粘贴注意点、验证码/滑块需人工处理的提示、失败截图与排查指引。语言用中文（面向掘金中文场景，贴合用户偏好）。

#### 4.1.2 `package.json`（skill 内自包含）
```json
{
  "name": "juejin-publisher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.49.0"
  },
  "scripts": {
    "login": "node scripts/login.mjs",
    "publish": "node scripts/publish.mjs",
    "install-browser": "playwright install chromium"
  }
}
```

#### 4.1.3 `scripts/login.mjs`
- 启动 **headed** chromium。
- 打开 `https://juejin.cn/`，提示用户在打开的浏览器中扫码/密码登录。
- 轮询检测登录态（如出现用户头像/昵称元素，或访问编辑器页标题框出现）。
- 成功后 `context.storage_state()` 写入 `src/agents/juejin-publisher/.auth/juejin.json`（首次自动创建 `.auth/`）。
- 支持 `--force` 强制重新登录；输出登录结果与存储路径。

#### 4.1.4 `scripts/publish.mjs`
CLI：
```
node scripts/publish.mjs --file ./article.md [--title 标题] [--tags 前端,后端,工具] [--category 前端] [--headless] [--timeout 180000]
```
流程：
1. 读取 `.md`：首行 `# 标题` 提取标题（`--title` 优先）；正文移除标题行；`--tags` 逗号分隔；`--category` 分类名。
2. 校验 `.auth/juejin.json` 存在，否则报「请先运行 login」。
3. `browser.newContext({ storageState, viewport })`；默认 headed（便于观察与人工处理验证码），`--headless` 可选。
4. 打开 `https://juejin.cn/editor/drafts/new?v=2`，等待标题框 `//input[@placeholder="输入文章标题..."]`。
5. `fill` 标题。
6. 正文：`context.grantPermissions(['clipboard-read','clipboard-write'], { origin: 'https://juejin.cn' })` → `page.evaluate(navigator.clipboard.writeText(正文))` → 点击 `.CodeMirror-code //span[@role="presentation"]` → `Control+V`。
7. 等待内容渲染/图片上传完成（轮询发布按钮可用或固定等待，`--timeout` 控制）。
8. 点击「发布」→ 弹窗内：
   - 分类：`.form-item-content.category-list` 下按 `--category` 文字匹配点击；未提供则提示并选第一项。
   - 标签：点击 `请搜索添加标签` 下拉，逐个输入 `--tags` 中标签，选中下拉项（确保落入已选区域，≥1 个）。
   - 封面/摘要：可选，若 md front matter 或参数提供则填。
9. 点击「确定并发布」；等待 URL 变为 `/post/<id>` 或 `/spost/<id>`。
10. 输出 JSON：`{ ok, title, url, status: "published"|"auditing", message }`。
11. 异常：捕获验证码/滑块提示与超时，保存截图到 `.tmp/failure-<ts>.png`，输出 `{ ok:false, message }` 并给出人工处理指引。

### 4.2 根 `package.json` 调整（让本项目可运行脚本）
- `devDependencies` 增加 `"playwright": "^1.49.0"`（与 skill 内版本一致）。
- `scripts` 增加：
  - `"juejin:login": "node src/agents/juejin-publisher/scripts/login.mjs"`
  - `"juejin:publish": "node src/agents/juejin-publisher/scripts/publish.mjs"`

### 4.3 后台 API 路由 `src/app/api/juejin/publish/route.ts`
- `POST`，请求体 `{ articleId, category?, tags? }`（`runtime = "nodejs"`）。
- 用 `getArticleById(articleId)` 从数据库取文章（标题/正文/标签/分类）。
- 把正文写入系统临时文件 `.md`（`os.tmpdir()`），再 `spawn("node", [publish.mjs, --file, ...])`，`cwd` 指向 skill 目录，注入 `--title/--tags/--category`。
- 收集 stdout/stderr，解析最后一行 JSON；超时兜底（如 5 分钟）。
- 返回 `{ url, status, message }` 或明确错误（未登录、脚本异常等），状态码对应 400/500。
- 不修改数据库 schema，不在文章上落库掘金 URL（避免 schema 变更，保持最小改动）。

### 4.4 后台「发布到掘金」按钮（`article-editor-dialog.tsx`）
- 底部操作栏（L722-L746，保存按钮前）新增「发布到掘金」按钮（`variant="outline"`，带加载态 Loader2）。
- 仅当 `article?.id` 存在（已保存过）时可用；新建未保存文章时禁用并提示「请先保存文章」。
- 点击 → `POST /api/juejin/publish`（携带 articleId + 当前分类名 + 标签名列表）→ 展示结果：成功显示掘金 URL（可点击新窗口打开）+ 状态；失败显示错误信息。
- 复用现有 `error`/新增 `publishResult` state 展示。

## 五、假设与决策

1. **agents 目录 = `src/agents/`**（用户原话「就放在agents目录下就行」），skill 作为自包含子文件夹放在其中，可整体拷贝到其他项目/agent。
2. **登录一次、长期复用**：storage state 存入 `.auth/juejin.json`（已加入 `.gitignore`，不上传）。
3. **正文粘贴方式**：剪贴板 + Ctrl+V（CodeMirror 限制），不尝试 `fill()`。
4. **输入方式**：Markdown 文件 + CLI 参数；后台按钮场景由 API 把数据库文章落成临时 md 再调用脚本。
5. **范围克制**：不做掘金 URL 落库、不做多平台、不做草稿更新/下载；仅在需要时保留扩展点（CLI 结构已便于后续加子命令）。
6. **验证码/滑块**：默认 headed 模式，脚本检测到人工步骤时暂停并提示；`--headless` 为可选高级用法。
7. **根依赖与 skill 依赖重复声明 playwright**：根依赖保证本项目 API 能 `spawn` 脚本；skill 内 package.json 保证拷贝到别处可独立 `npm install`。

## 六、验证步骤

1. `npm install`（安装根 playwright），再 `npx playwright install chromium` 安装浏览器内核。
2. `npm run juejin:login`：打开浏览器完成一次扫码登录，确认 `.auth/juejin.json` 生成。
3. 准备示例 `test.md`（首行 `# 测试发布标题`，含 markdown 正文），运行 `npm run juejin:publish -- --file ./test.md --tags 前端,工具 --category 前端`，确认输出 `{ ok:true, url }` 且浏览器中文章已发布（或进入审核）。
4. 浏览器验证：复制 URL 打开，确认标题/正文一致。
5. 后台按钮验证：`npm run dev` → 后台「文章管理」→ 编辑一篇已保存文章 → 点「发布到掘金」→ 看到结果 URL。
6. 回归：`npm test` 确认现有测试不受影响；`npx tsc --noEmit` 无类型错误。
7. 可移植性抽查：确认 `src/agents/juejin-publisher/` 目录独立（仅依赖 Node + playwright），SKILL.md 可在其他 agent 中指导调用。
