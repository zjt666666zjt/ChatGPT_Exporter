# 🗂️ ChatGPT历史记录导出器 (ChatGPT Universal Exporter Enhanced)

> 一键导出 ChatGPT 全部聊天记录（支持 JSON / Markdown / HTML 格式），并自动打包为 ZIP 文件保存到本地。

---

## 🚀 功能简介

- ✅ 自动批量导出所有对话（包括归档记录）  
- ✅ 支持多种格式（JSON、Markdown、HTML）  
- ✅ 自动生成美观的 HTML 页面（含代码高亮）  
- ✅ 支持团队空间 (ChatGPT Team / Enterprise)  
- ✅ 导出过程带有重试与断点机制，防止导出失败  
- ✅ 一键打包成 ZIP 文件下载  

---

## 🧩 安装方法

### 1️⃣ 安装 Tampermonkey（油猴插件）

根据浏览器选择安装：  
- Chrome / Edge 👉 [https://tampermonkey.net/?ext=dhdg&browser=chrome](https://tampermonkey.net/?ext=dhdg&browser=chrome)  
- Firefox 👉 [https://tampermonkey.net/?ext=dhdg&browser=firefox](https://tampermonkey.net/?ext=dhdg&browser=firefox)  

安装完成后，浏览器右上角会出现 🐒 图标。

---

### 2️⃣ 选择脚本版本安装（稳定版 / Beta 版）

#### ✅ 稳定版（推荐，大多数用户适用）

适合：只需要稳定、可靠的「全量导出」功能的用户。  

👉 一键安装链接：  
**[点此一键安装稳定版脚本](https://raw.githubusercontent.com/zjt666666zjt/ChatGPT_Exporter/main/chatgpt-exporter.user.js)**  

或手动安装：

1. 打开仓库中的  
   [`chatgpt-exporter.user.js`](https://github.com/zjt666666zjt/ChatGPT_Exporter/blob/main/chatgpt-exporter.user.js)  
2. 点击页面右上角的「Raw」或「原始文件」按钮  
3. 浏览器会自动触发 Tampermonkey 安装提示 → 点击「安装」即可  

**稳定版特点：**

- 提供完整的 ChatGPT 对话批量导出能力  
- 支持 JSON / Markdown / HTML 多种格式  
- 自动打包为 ZIP 文件下载  
- 已较长时间使用验证，适合作为日常备份工具  

---

#### 🧪 Beta 版本（新 UI + 最近 N 条 + 项目可选导出）

适合：想体验新功能 / 新 UI，对偶发小问题可以接受的用户。  

👉 一键安装链接：  
👉 **[点此一键安装 Beta 测试版脚本](https://github.com/zjt666666zjt/ChatGPT_Exporter/raw/main/chatgpt-exporter.user_beta.js)**

或手动安装：

1. 打开仓库中的  
   [`chatgpt-exporter.user_beta.js`](https://github.com/zjt666666zjt/ChatGPT_Exporter/blob/main/chatgpt-exporter.user_beta.js)  
2. 点击页面右上角的「Raw」或「原始文件」按钮  
3. 浏览器会自动触发 Tampermonkey 安装提示 → 点击「安装」即可  

**Beta 版在稳定版基础上的增强：**

- 🧮 **支持「最近 N 条」导出（只作用于根目录会话）**  
  - 可选择「全部对话」或「只导出最近 N 条」  
  - 仅限制根目录（个人 / 团队主列表）会话数量  
  - 项目（Project / Gizmos）如果勾选导出，则始终为 **全量导出**  
  - 适合：日常只备份最近一段时间的对话，而非所有历史

- 🗂️ **支持开关「项目 (Project / Gizmos) 文件导出」**  
  - 你可以勾选「是否导出项目文件」  
  - 若勾选，脚本会扫描所有项目，将项目内对话一并导出  
  - 导出 ZIP 中会按项目名称自动分文件夹，例如：  
    - `Project_工作项目1/`  
    - `Project_学习笔记/`  

- 🧊 **全新弹窗配置 UI（Modern UI）**  
  - 点击右下角绿色 `Export` 按钮，会弹出设置面板  
  - 在弹窗中可以完成所有配置：  
    - 选择导出空间：个人空间 / 团队空间  
    - 选择范围：全部 / 最近 N 条  
    - 是否导出项目内会话  
    - 勾选导出格式：JSON / Markdown / HTML  
  - 各选项有提示文本，交互更直观，适合频繁调整导出策略的用户  

- 📊 **按钮内嵌进度条 + 动态状态显示**  
  - 右下角 `Export` 按钮本身就是一个实时进度条：  
    - 按钮文本会显示 `当前导出数量 / 总数量`，例如 `23/120`  
    - 按钮背景从左到右逐渐填充，直观展示进度  
  - 按钮图标动态切换：  
    - ⬇️ 正常状态  
    - ⏳ 旋转表示扫描 / 导出中  
    - 📦 打包 ZIP 中  
    - ✅ 导出完成  
    - ⚠️ 出错提示  
  - 导出完成或失败时，都会有弹窗提示当前状态  

- 🏢 **更完善的团队空间 (ChatGPT Team / Enterprise) 支持**  
  - 在弹窗内可切换为「团队空间」模式  
  - 支持输入 Workspace ID（例如 `ws-xxxx`）  
  - 脚本会尝试从页面中自动识别已有 Workspace ID，并在界面中展示，方便复制与粘贴  

> 建议：  
> - 更看重 **稳定性**、只是偶尔导出 → 使用 **稳定版** 即可  
> - 需要 **最近 N 条、项目单独控制、新 UI、详细进度指示、团队空间增强** → 推荐试用 **Beta 版**  
> - 两个脚本可在 Tampermonkey 中自由启用 / 禁用：如果 Beta 有问题，可以关掉 Beta，重新启用稳定版完成「回退」  

---

## 💬 使用说明

1. 登录 [ChatGPT](https://chat.openai.com) 或 [chatgpt.com](https://chatgpt.com)  
2. 等待页面加载后，右下角会出现绿色按钮「Export」 / 「Export Conversations」  
3. 点击按钮：  
   - **稳定版**：直接开始导出流程  
   - **Beta 版**：先弹出配置窗口，选择导出范围 / 格式 / 空间等，然后点击「开始导出」  
4. 选择导出格式（JSON / Markdown / HTML）  
5. 选择导出空间：  
   - 个人空间 → 适用于普通账号  
   - 团队空间 → 适用于 ChatGPT Team / Enterprise  
6. 等待脚本自动遍历所有会话，生成 ZIP 文件并自动下载到本地。  

---

## 📦 导出文件结构示例

<pre>
ChatGPT_backup_2025-11-05.zip
├── 对话A_xxx.json
├── 对话A_xxx.md
├── 对话A_xxx.html
├── 对话B_xxx.md
├── Project_工作项目1/
│   ├── 对话1_项目相关.md
│   ├── 对话2_调试记录.html
│
└── Project_学习笔记/
    ├── AI原理研究.md
    └── AI原理研究.html
</pre>

### 💬 文件说明
| 文件类型 | 说明 |
|-----------|------|
| `.json` | ChatGPT 原始对话数据（完整结构） |
| `.md` | Markdown 格式，适合笔记或导入 Obsidian |
| `.html` | 网页格式，带样式与代码高亮 |
| 文件夹名 | 对应 ChatGPT 的“项目 (Project)”名称 |

---

## 🖼️ 导出效果预览

下图展示了导出后的 Markdown（左）与 HTML（右）效果：

![导出效果预览](https://github.com/zjt666666zjt/ChatGPT_Exporter/raw/main/preview.png)

---

## ⚠️ 注意事项

- 请确保已登录 ChatGPT，否则脚本无法获取会话数据  
- 导出前建议先打开任意一个聊天页面，确保 Access Token 有效  
- 若导出失败，可刷新页面后重试  
- 所有数据均保存于本地，不会上传到任何服务器  
- 若你的账户是团队版，请确认 Workspace ID 权限正常  

---

## 📜 许可协议

本项目遵循 **MIT License** ，可自由使用、修改、分发。  
> Copyright © 2025  
> 原始脚本作者：Alex Mercer, Hanashiro, WenDavid  
---

## 💡 建议与支持

如果此项目对你有帮助，欢迎：
- 🌟 Star 支持  
- 🐛 提交 Issue 反馈问题  
- 🔄 Fork 本项目制作你的自定义版本
