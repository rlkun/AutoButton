# AutoButton 自动按键辅助工具 / Automatic Hotkey Assistant Tool

> **🤖 声明：本应用前端面板、Electron 主进程、多语言引擎及打包构建方案等核心架构，均由 Google Gemini (Antigravity AI 编码助手) 辅助并与开发者共同合作开发完成。**

---

> 请选择您的阅读语言 / Please select your language:

<details open>
<summary><b>🇨🇳 简体中文说明书 (点击展开/折叠 | Click to toggle)</b></summary>

## AutoButton 自动按键辅助工具 (README)

AutoButton 是一款极简、免安装、支持多语言一键无缝切换、具备本地存储持久化与纯本地离线 OCR 数字识别触发的绿色桌面辅助工具。

### 目录
- [一、项目架构与组件](#一项目架构与组件)
- [二、中英文多语言国际化 (i18n) 设计](#二中英文多语言国际化-i18n-设计)
- [三、规则持久化与总控防错](#三规则持久化与总控防错)
- [四、本地开发与编译打包](#四本地开发与编译打包)

---

### 一、 项目架构与组件

整个项目分为客户端（桌面应用）和服务端（预留服务）两部分：

```text
AutoButton/
├── client/          # 客户端 (Electron + React + TS)
└── server/          # 服务端 (Node.js 预留服务)
```

#### 1. 客户端 (client)
* 核心引擎，使用 Electron + React + TypeScript + Vite 构建。
* 具备 OS 级别前台激活窗口追踪（基于高频 PowerShell 管道行缓冲区，防数据截断）。
* 具备 C++ Native 物理按键模拟（`robotjs`）与本地离线 WebAssembly OCR（`tesseract.js`）。

#### 2. 服务端 (server)
* **状态声明**：预留的网络端授权验证服务。
* **验证逻辑机制**：**当前版本仅做服务端网络验证接口的骨架预留，不执行实质性的在线联网验证**。客户端默认启用内置的安全 Local Fallback 机制直接完成登录验证，支持用户在完全脱机、无网环境下单机绿色安全运行。

---

### 二、 中英文多语言国际化 (i18n) 设计

程序设计了极简、高性能且体验平滑的本地化多语言框架：

#### 1. 静态翻译对照
为了防止翻译文案在业务逻辑中高度耦合，所有界面静态文本完全独立在两个 JSON 语言包中：
* 中文对照包：[zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json)
* 英文对照包：[en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json)

#### 2. 闭包响应式翻译 `t()`
在 React 中通过顶级闭包 `t(key)` 快速查询，当切换语言选项时触发全站零刷新响应式重绘。用户语言偏好会自动同步至 `localStorage`，下次启动程序时自动记忆加载。

#### 3. 内置规则样例联动翻译
在语言切换时，系统会智能扫描当前的规则名。如果规则名称保持系统默认模板（例如“百分比触发样例”、“固定间隔触发样例”或“新增规则 1”），系统会**自动将其转译为目标语言的文案**（如 "Percentage Trigger Example" / "New Rule 1"）。如果用户已经对其进行过自定义编辑，则予以安全保留，防止覆盖用户的心血。

#### 4. 界面切换器 UI 规避冲突
* **登录界面**：语言切换 Tab 位于登录验证卡片最底端，指定 `no-drag` 类以规避 Electron 窗口拖拽拦截，且与右上角的独立关闭按钮空间错开，杜绝点击冲突。
* **主操作区**：全局总控开关卡片右侧内置有融入玻璃微拟态风格的胶囊状 `中 / EN` 切换器。

---

### 三、 规则持久化与总控防错

* **规则自动保存**：用户对任务列表（包括坐标、阈值、间隔、单个规则开关等）所做的任何增删改均实时写入 `localStorage` 本地数据库，启动时自动物理恢复。
* **总控安全防错**：全局运行总开关不作本地保存，每次冷拉起程序时**强制默认为关闭 (false)**，必须由用户进入软件后手动开启，彻底防止因开机静默轮询按键引发的意外物理按键冲突。

---

### 四、 本地开发与编译打包

#### 1. 本地开发与调试
1. 进入客户端目录：
   ```bash
   cd client
   ```
2. 安装依赖并启动本地热更新服务器：
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```

#### 2. 极速免安装 Portable 包编译
我们对打包体积和自解压启动速度进行了极致优化：
* **依赖体积剥离**：纯前端组件包已移至 `devDependencies`，打包时自动剔除出 `.asar` 归档。最终打包单文件大小仅为 **93.6MB**（包含 88MB 纯本地 WebAssembly 离线 OCR 引擎的核心硬性代价）。
* **精准文件解包 (`asarUnpack`)**：`electron-builder` 在打包时仅物理抽取 `robotjs.node` 与 `worker-script/node/index.js` 这 2 个文件，避免解压数千个零碎碎小文件。**免安装便携版双击后实现秒开（毫秒级瞬时冷启动）**。

在 `client` 目录下执行以下打包命令：
```bash
npm run dist
```
打包成功后，可在 `client/dist-package/` 下找到：
* **`AutoButton 0.0.0.exe`**：多尺寸精致高科技图标 Windows 便携免安装单文件版。
* **`AutoButton-0.0.0-win.zip`**：解压即用压缩包。
* **诊断日志**：程序启动后会在系统 `%APPDATA%\client\diagnostic.log` 中生成自检记录，若有报错可以直接打开该物理路径进行查看排查。

</details>

<details>
<summary><b>🇺🇸 English Manual (点击展开/折叠 | Click to toggle)</b></summary>

## AutoButton Automatic Hotkey Assistant Tool (README)

AutoButton is a minimalist, portable, multi-language (one-click seamless transition), locally persisted desktop utility featuring offline local WebAssembly OCR number-recognition triggering.

### Table of Contents
- [1. Project Architecture & Components](#1-project-architecture--components)
- [2. Multi-Language Internationalization (i18n) Design](#2-multi-language-internationalization-i18n-design)
- [3. Configuration Persistence & Safety Guard](#3-configuration-persistence--safety-guard)
- [4. Local Development & Compilation/Packaging](#4-local-development--compilationpackaging)

---

### 1. Project Architecture & Components

The project consists of the client application (desktop app) and a pre-configured server skeleton:

```text
AutoButton/
├── client/          # Client App (Electron + React + TS)
└── server/          # Server (Node.js pre-configured logic)
```

#### 1. Client (client)
* The core processing engine built using Electron, React, TypeScript, Vite, and CSS.
* Real-time foreground active window tracking utilizing PowerShell streams (buffered line-by-line reading to prevent chunk truncation).
* OS-level physical input simulation (`robotjs`) and offline WebAssembly-based OCR (`tesseract.js`).

#### 2. Server (server)
* **Status**: Network verification server skeleton.
* **Verification Mechanism**: **The current version only reserves network verification APIs and does not perform online server checks**. The client falls back automatically to local offline simulation mode for authentication, allowing absolute single-machine offline operation with maximum privacy.

---

### 2. Multi-Language Internationalization (i18n) Design

We implemented a zero-latency, reactive local i18n engine with persistent state storage:

#### 1. Static Configuration Separation
To ensure clean code logic, all static text assets are stored inside dedicated JSON translation dictionaries, strictly avoiding dynamic string composition or injection templates:
* Chinese Dictionary: [zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json)
* English Dictionary: [en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json)

#### 2. Reactive Translation Wrapper `t()`
A reactive local helper `t(key)` handles key lookup. When the language state updates, React executes a seamless zero-refresh redraw. User language choice is automatically saved to `localStorage` and restored on startup.

#### 3. Smart Default Rule and Template Translation
To deliver premium interaction, the application tracks rule names on transition. If rule names remain unchanged (retaining system defaults such as "百分比触发样例", "固定间隔触发样例", or "新增规则 1"), the engine **automatically translates them to the matching target language** (e.g., "Percentage Trigger Example" / "New Rule 1"). Once edited by the user, rules are bypassed to preserve custom names.

#### 4. UI Layout Alignment
* **Authentication View**: The `中 / EN` selector sits neatly at the bottom of the card with `no-drag` attributes to avoid Electron frameless drag interference and prevent space conflicts with the top-right close button.
* **Dashboard View**: A glassmorphic `中 / EN` selector is placed adjacent to the "Window Selection" button for seamless, tactile control.

---

### 3. Configuration Persistence & Safety Guard

* **Auto-Save**: Any changes made to rules (including screenshot bounds, thresholds, intervals, and individual task toggles) are written directly to `localStorage` and automatically restored.
* **Safety Guard**: The global control switch is **intentionally excluded from auto-save and defaults to off (false)** on cold-start. This prevents unintended keyboard simulation conflicts upon opening the program.

---

### 4. Local Development & Compilation/Packaging

#### 1. Local Development
1. Enter the client directory:
   ```bash
   cd client
   ```
2. Install dependencies and start the Vite dev server:
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```

#### 2. Optimized Portable EXE Build
We have strictly optimized both packaging size and startup time:
* **Dependency Pruning**: Web front-end UI libraries are moved to `devDependencies` to prevent redundant bundling in `.asar`. The final package size is **93.6MB** (incorporating the inevitable 88MB runtime footprint of local WebAssembly OCR).
* **Precise Extraction (`asarUnpack`)**: The packager is instructed to extract *only* `robotjs.node` and `worker-script/node/index.js` (exactly 2 files) rather than thousands of directories. This yields **instant millisecond-level cold start/extraction speed** for the Portable executable.

Run the builder inside the `client` directory:
```bash
npm run dist
```
After completion, target builds can be fetched from `client/dist-package/`:
* **`AutoButton 0.0.0.exe`**: Portable Windows executable containing the multi-resolution cybernetic hotkey icon.
* **`AutoButton-0.0.0-win.zip`**: Compressed archive.
* **Diagnostics**: The program writes to `%APPDATA%\client\diagnostic.log` on startup. If any issues occur, check this file for details.

</details>
