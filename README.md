# Moonvy UI MCP

面向前端开发的 Moonvy（月维）设计稿读取 MCP。输入项目页或设计文件 URL，可获取页面列表、画框尺寸、图层树、节点样式、设计 Token，以及切图/快照/图片填充资源。

本项目参考了 `lanhu-mcp` 的工具边界，但数据读取针对 Moonvy：通过 Moonvy 的设计数据文件（Genome）提取精确参数，而不是用截图猜测颜色、字号和间距。

## 能做什么

| MCP 工具 | 用途 |
| --- | --- |
| `moonvy_parse_url` | 解析项目、目录、设计文件 ID |
| `moonvy_list_pages` | 从项目/目录列出设计文件；只有文件夹 URL 时先调用它 |
| `moonvy_get_design` | 获取标题、画框 ID、画框宽高、Genome 版本 |
| `moonvy_list_layers` | 扁平化图层索引，用于按名称查找节点 ID |
| `moonvy_get_node_style` | 获取单个节点的尺寸、相对坐标、边距、填充、文字、圆角、描边、阴影和 CSS |
| `moonvy_get_tree` | 获取带 UI 参数的嵌套图层树 |
| `moonvy_extract_tokens` | 提取颜色、渐变、字体、字号、字重、行高、圆角、阴影、推断间距 |
| `moonvy_get_ui_spec` | 一次返回元数据、Token 和带样式图层树，推荐开发时优先使用 |
| `moonvy_download_asset` | 下载切图、快照、图片填充或顶层文件预览 |
| `moonvy_clear_cache` | 设计稿更新后清理内存缓存 |

`moonvy_get_node_style` 和 `moonvy_get_ui_spec` 会给出：

- 绝对位置，以及相对父节点的 `relativeX` / `relativeY`
- 到父节点右边、底边的距离
- 宽高、可见性、透明度、裁剪状态
- 纯色、渐变和图片填充引用
- 字体、字号、字重、行高、字间距、文字颜色和对齐
- 圆角、描边、阴影
- 可直接参考的 CSS 属性对象

样式结果会同时返回源单位和 CSS 换算信息。Genome 的几何与效果数值保留为源 `px`，`units` 会明确给出 `cssUnit`、`scale` 和换算关系；移动端画板默认按 `750rpx` 基准生成整套 CSS。例如宽度为 `375px` 的画板使用 `1px = 2rpx`，阴影源值 `0px 4px 5.8px 0px` 会生成 `0rpx 8rpx 11.6rpx 0rpx`。可通过 `MOONVY_CSS_UNIT=px|rpx|auto`、`MOONVY_RPX_BASE_WIDTH` 和 `MOONVY_RPX_SCALE` 调整。

## 数据链路

```text
Moonvy URL
  -> projectId / dirId / fileId
  -> POST https://global-api.moonvy.com/v2/anynode/get
  -> files.genome.url
  -> 下载并解压 Genome JSON
  -> 解析图层、样式、Token、资源
  -> MCP JSON 响应
```

项目/目录列表使用 `POST /v2/anynode/list`。这些是 Moonvy Web 当前使用的非公开接口，未来若 Moonvy 调整接口或 Genome 结构，需要同步更新适配层。

## 安装

要求 Node.js 20 或更高版本。

```powershell
cd C:\path\to\moonvy-ui-mcp
npm install
Copy-Item .env.example .env
```

### 配置 Moonvy 登录令牌

1. 在浏览器登录 Moonvy，并打开需要读取的 Moonvy 页面。
2. 打开开发者工具的 Console。
3. 执行：

```js
copy(window.app?.api?.$options?.token)
```

4. 把复制到的值写入本项目的 `.env`：

```dotenv
MOONVY_TOKEN=你的本机令牌
```

令牌只保存在本机，不要发到聊天、提交到 Git 或写入前端代码。服务响应会主动隐藏 JWT 和带查询参数的资源 URL。

### 自检

```powershell
npm run check
npm test
npm start
```

`npm start` 是 stdio MCP 服务，正常情况下不会输出普通日志并会等待 MCP 客户端连接。

## 接入 Codex / ChatGPT 桌面应用

在设置中选择 **MCP servers -> Add server**，类型选择 **STDIO**：

- Command：`node`
- Arguments：`C:\path\to\moonvy-ui-mcp\src\server.js`
- Working directory：`C:\path\to\moonvy-ui-mcp`

也可以把以下内容加入 `~/.codex/config.toml` 或可信项目内的 `.codex/config.toml`：

```toml
[mcp_servers.moonvy]
command = "node"
args = ["C:/path/to/moonvy-ui-mcp/src/server.js"]
cwd = "C:/path/to/moonvy-ui-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 180
```

服务默认从 `cwd` 下的 `.env` 读取 `MOONVY_TOKEN`。如希望从本机环境变量转发，也可添加：

```toml
env_vars = ["MOONVY_TOKEN"]
```

保存后重启 Codex/桌面应用，在输入框使用 `/mcp` 检查连接。

## 接入 Cursor / Windsurf / Claude Code

使用标准 stdio MCP 配置：

```json
{
  "mcpServers": {
    "moonvy": {
      "command": "node",
      "args": ["C:/path/to/moonvy-ui-mcp/src/server.js"],
      "cwd": "C:/path/to/moonvy-ui-mcp"
    }
  }
}
```

## 针对当前 Moonvy 链接的使用顺序

当前链接：

```text
https://moonvy.com/project/89f75621-a0e7-4122-b9ee-b6b703e1c826/cf67c54c-8e2b-4809-9e4d-fc6512d0e0be
```

它包含 `projectId + dirId`，指向文件夹而不是具体设计文件，因此建议：

1. 调用 `moonvy_list_pages` 获取文件列表。
2. 选定返回结果里的具体设计 URL。
3. 调用 `moonvy_get_design` 查看画框列表。
4. 对目标画框调用 `moonvy_get_ui_spec`，先使用 `maxDepth=4`、`maxNodes=500`。
5. 若需要精确查看某个元素，先用 `moonvy_list_layers` 找节点 ID，再调用 `moonvy_get_node_style`。
6. 图标、背景图或页面快照用 `moonvy_download_asset` 下载到实际前端项目的资源目录。

示例提示词：

```text
使用 Moonvy MCP 列出这个项目目录里的设计文件。找到“新增学生”页面后，
读取它的 UI spec，保留原始颜色、字号、间距和圆角，并把需要的切图下载到
C:/work/school-web/src/assets/moonvy。
```

## 与 lanhu-mcp 的对应关系

| lanhu-mcp 思路 | 本项目实现 |
| --- | --- |
| 获取设计列表 | `moonvy_list_pages` |
| 分析设计图参数 | `moonvy_get_ui_spec` / `moonvy_get_node_style` |
| 获取切图 | `moonvy_download_asset` |
| 通过 Cookie/JWT 复用登录权限 | `MOONVY_TOKEN` 环境变量 |
| 缓存设计数据 | 进程内 Genome TTL 缓存 |
| 控制模型上下文 | `frameId`、`maxDepth`、`maxNodes` |

当前版本专注“设计稿 -> 前端实现”，没有复制蓝湖项目里的需求文档分析、团队留言板和飞书协作功能。

## 安全与限制

- 仅使用你本来就有权限访问的 Moonvy 项目。
- `.env` 已加入 `.gitignore`；仍需避免手动提交令牌。
- `moonvy_download_asset` 要求绝对输出目录，防止资源被意外写入不明确位置。
- Moonvy 令牌过期后需要重新获取。
- 本项目不绕过登录、项目权限或 Moonvy 服务端访问控制。
- Genome 中不同设计工具版本的字段可能不完全一致；解析器保留了常见兼容字段，但仍建议用实际团队设计稿做一次端到端验收。

## 开发与测试

单元测试使用合成 Genome，不需要 Moonvy 凭据：

```powershell
npm test
```

真实项目端到端测试需要有效的 `MOONVY_TOKEN`：

```text
1. moonvy_list_pages(文件夹 URL)
2. moonvy_get_design(设计文件 URL)
3. moonvy_get_ui_spec(设计文件 URL)
4. moonvy_get_node_style(设计文件 URL, 节点 ID)
```
