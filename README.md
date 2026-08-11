# 🗂️ ChatGPT历史记录导出器 (ChatGPT Universal Exporter Enhanced)

> 一键导出 ChatGPT 聊天记录，支持 JSON / Markdown / HTML，并自动打包为 ZIP 保存到本地。

---

## 🚀 功能简介

- ✅ 自动批量导出对话（包括归档记录）
- ✅ 支持 JSON、Markdown、HTML 多种格式
- ✅ 自动生成可阅读的 HTML 页面
- ✅ 支持 ChatGPT Team / Enterprise Workspace
- ✅ 支持 Projects / Gizmos 项目会话
- ✅ ZIP 本地打包，不向第三方服务器上传导出内容

---

## 🧩 安装方法

### 1. 安装 Userscript 管理器

常见选择：
- Chrome / Edge：Tampermonkey
- Firefox：Tampermonkey
- Safari：需要可运行 Userscript 的 Safari 扩展；不同扩展和 Safari 版本的兼容情况可能不同

### 2. 选择脚本版本

#### ✅ 稳定版

适合只需要稳定、可靠全量导出的用户。

**[安装稳定版](https://raw.githubusercontent.com/zjt666666zjt/ChatGPT_Exporter/main/chatgpt-exporter.user.js)**

文件：[`chatgpt-exporter.user.js`](https://github.com/zjt666666zjt/ChatGPT_Exporter/blob/main/chatgpt-exporter.user.js)

稳定版继续保持原有逻辑；2026 年 8 月这一轮维护 **没有修改稳定版代码**。

---

#### 🧪 Beta 版 — v1.1.0-beta.2

适合需要 Projects、最近 N 条、团队空间增强、HTML 优化和大批量导出容错的用户。

**[安装 Beta 测试版](https://raw.githubusercontent.com/zjt666666zjt/ChatGPT_Exporter/main/chatgpt-exporter-beta.user.js)**

文件：[`chatgpt-exporter-beta.user.js`](https://github.com/zjt666666zjt/ChatGPT_Exporter/blob/main/chatgpt-exporter-beta.user.js)

### Beta 版主要增强

- 🧮 **最近 N 条**
  - 可导出全部根目录对话，或只导出最近 N 条
  - Active 与 Archived 会话会一起参与“最近 N 条”排序
  - Projects 不受最近 N 条限制，勾选后按项目扫描

- 🗂️ **Projects / Gizmos 完整性增强**
  - 支持项目会话分页扫描
  - 兼容 `cursor` / `next_cursor`
  - 兼容 `has_more` / `hasMore`
  - 带重复 cursor 防死循环
  - 对仍要求首个 `cursor=0` 的接口提供回退

- 🛡️ **429 / 服务器错误容错**
  - 全局请求节流
  - 识别 `Retry-After`
  - HTTP 429 / 5xx 指数退避重试
  - 触发 429 后动态降低请求速度
  - 单条对话失败不会让整个 ZIP 直接报废

- 📋 **导出失败报告**
  - ZIP 内自动生成 `_export-report.txt`
  - 同时生成 `_export-report.json`
  - 记录请求总数、成功数、失败数以及失败会话 ID / 原因

- 🌐 **HTML 导出升级**
  - 标题
  - 有序 / 无序列表
  - 引用
  - Markdown 表格
  - 链接与图片
  - fenced code block / 行内代码
  - 加粗、斜体、删除线
  - 数学公式记号保留为更清晰的可读样式
  - 支持浅色 / 深色系统主题

- 🧵 **对话线程解析增强**
  - 有 `current_node` 时沿父节点还原当前可见线程
  - 减少分支对话按时间简单排序导致的错序

- 🏢 **团队空间**
  - 支持 Workspace ID
  - 尝试从页面请求 / 页面数据中自动检测 Workspace ID

- 🍎 **Safari 侧兼容改进**
  - 下载后延迟释放 Blob URL，降低 Safari 尚未消费文件时过早失效的概率
  - 脚本本身使用标准 Web API；实际能否运行仍取决于 Safari 版本和 Userscript 扩展

---

## 💬 使用说明

1. 登录 [chatgpt.com](https://chatgpt.com)
2. 等待页面出现右下角 `Export` 按钮
3. Beta 版点击按钮后选择：
   - 个人空间 / 团队空间
   - 全部 / 最近 N 条
   - 是否导出 Projects
   - JSON / Markdown / HTML
4. 点击“开始导出”
5. 等待脚本扫描、下载会话详情并打包 ZIP
6. 如果部分对话最终失败，请查看 ZIP 中的 `_export-report.txt` 或 `_export-report.json`

---

## 📦 Beta 导出结构示例

```text
chatgpt_personal_backup_2026-08-11_full_with_projects.zip
├── 对话A_xxx.json
├── 对话A_xxx.md
├── 对话A_xxx.html
├── Project_工作项目1/
│   ├── 对话1_xxx.md
│   └── 对话2_xxx.html
├── _export-report.txt
└── _export-report.json
```

| 文件类型 | 说明 |
|---|---|
| `.json` | ChatGPT 原始会话数据 |
| `.md` | Markdown 文本 |
| `.html` | 经过格式化的可阅读网页 |
| `_export-report.*` | Beta 导出结果与失败明细 |
| 项目文件夹 | 对应 ChatGPT Project / Gizmo 名称 |

---

## ⚠️ 注意事项

- 必须先登录 ChatGPT
- 如果 Access Token 暂时无法获取，可刷新页面并先打开一个对话再试
- 大量历史记录导出会主动降低速度，以减少 HTTP 429
- ChatGPT 内部接口可能随产品更新发生变化；若出现新兼容问题，请提交 Issue
- 所有导出内容在浏览器本地处理；脚本不会主动上传到第三方服务器
- Team / Enterprise 用户需确保 Workspace ID 与账号权限有效

---

## 📑 更新记录

详见 [`CHANGELOG.md`](https://github.com/zjt666666zjt/ChatGPT_Exporter/blob/main/CHANGELOG.md)。

---

## 📜 许可协议

本项目遵循 **MIT License**，可自由使用、修改和分发。

> Copyright © 2025  
> 原始脚本作者：Alex Mercer, Hanashiro, WenDavid

---

## 💡 建议与支持

如果项目对你有帮助，欢迎：
- 🌟 Star
- 🐛 提交 Issue
- 🔄 Fork 并贡献改进
