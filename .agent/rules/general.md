---
trigger: always_on
---

# 项目通用规则 (General Project Rules)

这里是您希望 Gemini 每次在这个项目中被调用时都遵守的固定参数或规则。本配置根据全栈开发者的身份进行了定制整合。

---

## 1. 语言与沟通风格 (Tone & Language)
- 始终使用中文回复，除代码和专有名词外。
- 解释要简洁明了，直接切入重点。

---

## 2. 代码与开发规范 (Coding Standards)
- **缩进规范**：代码缩进统一使用 **2 个空格**。
- **注释规范**：编写新函数时必须附带对应的 **JSDoc 或 Docstring 注释**。
- **代码结构**：优先编写可测试的模块化代码，遵守 DRY 和单一职责原则。

---

## 3. 全栈技术规范 (Full-Stack Standards)
- **前端开发**：
  - 布局：采用现代 Flexbox 或 CSS Grid 自适应布局，避免硬编码像素值，确保响应式适配。
  - 组件化：保持组件单一职责，提取高频复用的 UI 单元。
- **后端与 API**：
  - 路由设计：遵循 RESTful 规范（名词复数，小写，使用 kebab-case，例如 `/api/v1/user-profiles`）。
  - 返回格式：所有 API 统一采用标准的 JSON 数据格式，并合理分配 HTTP 状态码。
- **数据库操作**：
  - 安全性：禁止直接拼接 SQL，必须使用参数化查询或 ORM 以防御 SQL 注入。
  - 结构变更：数据库结构的变更一律通过版本迁移脚本（Migrations）进行记录。

---

## 4. 系统级桌面多窗口与截图开发宪法 (Tauri 2.0 & WebView2)
* **技术选型决策矩阵规则**：凡涉及系统集成、图像捕获、驱动级模拟等深度交互项目，Agent 在提交技术方案前，必须以表格形式列出至少两种备选选型（例如 Tauri Rust 原生 vs. Electron Node 插件），客观对比开发敏捷度、包体积、内存占用、杀软敏感度，由用户选择后再确定。
* **窗口防卡死死锁规则**：所有透明辅助窗口（如截图选区遮罩、高亮框）必须在 `setup` 期间在主线程静默预加载完毕并置为 `visible(false)`。运行时仅执行 `show()` / `hide()`。
* **主线程调度律**：凡是操纵窗口句柄、位置与尺寸的 API，必须强制使用 `app_handle.run_on_main_thread(move || { ... })` 派发回 GUI 主线程顺序执行。
* **多显示器 DPI 物理像素换算**：多屏截图必须遍历 `available_monitors` 并通过 `initialization_script` 注入各屏幕物理原点和缩放比。前端画框结束后折算出跨屏幕的绝对物理像素坐标 Rect 传回 Rust 直通 GDI，严禁在 Rust 端混淆多屏坐标系。
* **彻底防进程残留**：将关闭 UI 的命令直接实现为 `app_handle.exit(0)`，同时在 `tauri::Builder` 注册主窗口 `Destroyed` 事件监听，一旦主窗口被销毁强制退出整个 App，防止残留进程锁定 WebView2 目录。

---

## 5. Git 提交规范 (Git Commit Standards)
- 用户没有自测通过，没有明确指令，禁止自行提交推送
- 代码提交时的 Commit Message 必须遵循规范前缀：
  - `feat:` 新增功能
  - `fix:` 修复缺陷
  - `docs:` 仅文档/注释更改
  - `style:` 格式化/样式修改
  - `refactor:` 代码重构
  - `test:` 添加或修改测试
