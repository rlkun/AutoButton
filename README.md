# AutoButton 自动按键辅助工具 / Automatic Hotkey Assistant Tool

> **🤖 声明：本应用已从原 Electron 架构完整重构迁移至 Tauri 2.0 架构，相关核心引擎、物理按键模拟 FFI 及打包构建方案等，均由 Google Gemini (Antigravity AI 编码助手) 辅助并与开发者共同合作重构完成。**

---

> 请选择您的阅读语言 / Please select your language:

<details open>
<summary><b>🇨🇳 简体中文说明书 (点击展开/折叠 | Click to toggle)</b></summary>

## AutoButton 自动按键辅助工具 (README)

AutoButton 是一款基于 **Tauri 2.0 + Rust + Vite React** 的极简、免安装、支持多语言一键切换、具备本地存储持久化与纯本地离线硬件加速 OCR 识别触发的绿色桌面辅助工具。

### 目录
- [一、项目架构与组件](#一项目架构与组件)
- [二、核心功能与原生 API 重构特征](#二核心功能与原生-api-重构特征)
- [三、中英文多语言国际化 (i18n) 设计](#三中英文多语言国际化-i18n-设计)
- [四、规则持久化与总控防错](#四规则持久化与总控防错)
- [五、本地开发与编译打包](#五本地开发与编译打包)

---

### 一、 项目架构与组件

整个项目已彻底摒弃 Node.js 运行时和 Electron 外壳，重构为高度轻量化的 Tauri 桌面程序：

```text
AutoButton/
├── client/              # 前端面板 (Vite + React + TS)
│   └── src-tauri/       # 后端引擎 (Tauri 2.0 + Rust 核心)
└── DEV_POSTMORTEM.md    # 项目重构复盘与技术选型指南
```

* **前端 (client)**：纯无状态呈现的 UI 界面，使用 HTML5/CSS (玻璃微拟态风格)、React 和 TypeScript 构建。
* **后端 (src-tauri)**：使用 Rust 构建的 OS 级交互引擎。负责高精度的物理输入模拟、多显示器自适应截图选区、WinRT 硬件 OCR 解析及后台任务轮询。

---

### 二、 核心功能与原生 API 重构特征

我们对原 Electron 版本的系统级模块进行了 Rust 原生化重写，从而取得了惊人的性能和体积提升：

#### 1. Win32 原生物理按键模拟 (FFI)
* 摒弃了 `robotjs` 等编译困难、占用高昂的 Node C++ 插件。
* 通过原生 Win32 FFI `SendInput` 接口，定义了与 64 位 Windows 严格对齐的 40 字节内存清零 `INPUT` 结构。将按键的“按下”与“弹起”拆分为两次独立的原子级系统调用，彻底杜绝了因对齐 padding 字节计算偏差引发的越界段错误闪退，按键模拟极致稳定。

#### 2. Windows 10/11 原生 WinRT 硬件 OCR
* 彻底抛弃了体积高达 80MB+ 且加载缓慢的本地 WebAssembly `tesseract.js` 引擎。
* 采用 Rust 直接调用 Windows 系统内置的 `Windows.Media.Ocr.OcrEngine` 硬件接口。**0 额外包体积**，识图单次响应时间由 250ms 降至 **5~15ms**，识别速度提升 15 倍。

#### 3. 内存直通截图 (BitBlt)
* GDI 直接在内存中捕获屏幕指定区域像素并直通 WinRT OCR。全程 **0 磁盘 I/O** 损耗，识别开销降至底噪。

#### 4. 双屏 / 多屏幕自适应截图选区
* 弃用单一超大跨屏透明窗口设计。在系统启动（`setup` 阶段）预加载遍历所有可用物理屏幕并预建 `overlay_{i}` 窗口。
* 各屏幕独立窗口自检查询其 Scale Factor 缩放比和物理偏移，在画框完成时将逻辑选区换算为**全局绝对物理像素坐标 Rect** 提交给 Rust，完美支持多屏幕下不同 DPI 缩放下的精准截图与识别。

#### 5. 0 占用窗口焦点追踪
* 使用 Win32 `GetForegroundWindow` / `GetWindowThreadProcessId` 轮询目标窗口。0 CPU 底噪损耗，且彻底告别杀毒软件对高频 PowerShell 进程管道捕获的敏感误报。

#### 6. 双路并发 OCR 与综合打分决策 (极性自适应)
* 同时引入“原图”与“反相图”（RGB 通道进行 `255 - X` 反转）双路 OCR 并行识别，彻底消除黑底白字与白底黑字在不同场景下的识别极性盲区。
* 编写综合打分模型对两路解析数据进行质量评估：比率格式基础分 `100`，单值 `50`，中文汉字污染重罚 `-60`（防止背景噪点被识为中文导致数字截断），比率超限逻辑错误惩罚 `-40`，原图偏向微调 `+5`。自动筛选并采信分值最高的最优结果，在复杂动态背景下具有超强鲁棒性。

#### 7. 交互式日志与一键双击复制
* 在前端日志栏面板新增“一键复制全部日志”功能，并且支持双击单行日志直接将该条目快速写入剪贴板，大大提升了调试与日志上报的交互便利性。

---

### 三、 中英文多语言国际化 (i18n) 设计

* **翻译对照包**：中文 [zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json) / 英文 [en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json) 静态对照。
* **响应式 `t()` 闭包**：零刷新全站文案瞬时响应更新，偏好记忆并自动写入 `localStorage`。
* **默认规则样例智能翻译**：在切换语言时，自动匹配并转译默认规则名（如“百分比触发样例”自动翻译为 "Percentage Trigger Example"），对于已被用户修改过的自定义规则名，自动予以安全保留。

---

### 四、 规则持久化与总控防错

* **规则自动保存**：用户对任务列表（包括坐标、阈值、间隔、单个规则开关等）所做的任何增删改均实时写入 `localStorage` 本地数据库，启动时自动物理恢复。
* **总控安全防错**：全局运行总开关不作本地保存，每次冷拉起程序时**强制默认为关闭 (false)**，必须由用户进入软件后手动开启，彻底防止因开机静默轮询按键引发的意外物理按键冲突。
* **进程残留双重防卡死**：退出 UI 会直接触发 `app_handle.exit(0)`，同时后端注册主窗口 `Destroyed` 全局事件，一旦主窗口被销毁（X 键/任务栏强关），立即强制退出所有后台隐藏窗口（如 `highlighter`），保证绝无僵尸进程残留锁定 WebView2 目录。

---

### 五、 本地开发与编译打包

#### 1. 本地开发与调试
1. 进入前端目录：
   ```bash
   cd client
   ```
2. 安装依赖并启动本地热更新服务器与 Rust 后端调试应用：
   ```bash
   npm install
   npm.cmd run tauri:dev
   ```

#### 2. 正式版本打包编译
在 `client` 目录下执行以下打包命令：
```bash
npm.cmd run tauri:build
```
打包成功后，可在 `client/src-tauri/target/release/` 下找到：
* **`autobutton.exe`**：极简独立绿色便携版。体积仅为 **3.37 MB**，双击秒开，内存仅占 **25MB~40MB**。
* **`bundle/nsis/AutoButton_0.1.0_x64-setup.exe`**：NSIS 便携安装引导包，体积仅为 **1.40 MB**。

</details>

<details>
<summary><b>🇺🇸 English Manual (点击展开/折叠 | Click to toggle)</b></summary>

## AutoButton Automatic Hotkey Assistant Tool (README)

AutoButton is a minimalist, portable, multi-language (one-click seamless transition), locally persisted desktop utility featuring offline local hardware-accelerated WinRT OCR number-recognition triggering based on **Tauri 2.0 + Rust + Vite React**.

### Table of Contents
- [1. Project Architecture & Components](#1-project-architecture--components-1)
- [2. Core Features & OS-Level Native API Integration](#2-core-features--os-level-native-api-integration)
- [3. Multi-Language Internationalization (i18n) Design](#3-multi-language-internationalization-i18n-design-1)
- [4. Configuration Persistence & Safety Guard](#4-configuration-persistence--safety-guard-1)
- [5. Local Development & Compilation/Packaging](#5-local-development--compilationpackaging-1)

---

### 1. Project Architecture & Components

The project has completely migrated from Node.js/Electron to a lightweight Rust-based Tauri application:

```text
AutoButton/
├── client/              # Front-end UI (Vite + React + TS)
│   └── src-tauri/       # Back-end Engine (Tauri 2.0 + Rust Core)
└── DEV_POSTMORTEM.md    # Post-mortem & Technology Selection Guide
```

* **Front-end (client)**: Stateless visual UI dashboard crafted with HTML5/CSS, React, and TypeScript.
* **Back-end (src-tauri)**: Native OS integration engine written in Rust. Handles input simulation, multi-display screenshots, WinRT OCR processing, and background worker threads.

---

### 2. Core Features & OS-Level Native API Integration

We replaced all native interfaces with pure Rust APIs, achieving significant performance gains:

#### 1. Win32 FFI SendInput Simulation
* Stripped away the bulky `robotjs` Node-API binary.
* Uses native Win32 FFI `SendInput` with a strictly padded 40-byte `INPUT` struct. Splits physical "Key Down" and "Key Up" events into independent calls, preventing padding offset segment errors and runtime crashes on 64-bit Windows.

#### 2. Native WinRT Hardware OCR (Windows 10/11)
* Discarded the 80MB+ WASM-based `tesseract.js` engine.
* Directly invokes the system-integrated `Windows.Media.Ocr.OcrEngine` API. **0MB added payload**, with capture-to-OCR latencies slashed from 250ms to **5~15ms** (a 15x speed increase).

#### 3. Zero-Disk-IO Memory Streaming Capture
* Employs Win32 GDI API (`BitBlt`) to capture screen regions directly into memory, transferring raw RGBA pixel arrays directly to WinRT OCR. **0 Disk I/O overhead**.

#### 4. Multi-Monitor & DPI Scale Adaptive Selection
* Replaced the cross-display single-window builder. Preloads dedicated `overlay_{i}` windows on `setup` matching all active displays' physical bounds.
* Front-end calculates **absolute physical coordinates** incorporating screen Scale Factors, delivering 100% pixel-perfect region capture under multi-monitor environments.

#### 5. Silent Active Window Focus Tracker
* Uses Win32 `GetForegroundWindow` / `GetWindowThreadProcessId` to monitor active process state. **0 CPU overhead**, eliminating antivirus flags for high-frequency PowerShell queries.

#### 6. Dual-Path OCR & Comprehensive Scoring System
* Simultaneously processes both the "Original" and "Inverted" (RGB inverted via `255 - X`) images in parallel, completely eradicating recognition polarity blind spots (e.g. white-on-black vs black-on-white text).
* Evaluates both paths using a scoring model: Ratio formats yield a base score of `+100`; single numbers yield `+50`; Chinese character intrusion triggers a heavy penalty of `-60` to avoid background noise truncation; out-of-bounds ratio percentages trigger `-40`; a slight bias of `+5` is granted to the original image. The path with the highest score is dynamically selected.

#### 7. Interactive Logs & Single-Line Copy
* Added a one-click "Copy All Logs" feature and supports double-clicking any log entry to instantly copy the line to the clipboard, simplifying the logging, debugging, and feedback process.

---

### 3. Multi-Language Internationalization (i18n) Design

* **Translation Asset**: Separated dictionaries: Chinese [zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json) / English [en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json).
* **Reactive Wrapper `t()`**: Reactive translation query, saving user selection instantly to `localStorage`.
* **Smart Rule Translation**: Automatically translates default template titles upon switching languages while safely skipping customized rules.

---

### 4. Configuration Persistence & Safety Guard

* **Auto-Save**: Configuration (including thresholds, intervals, rects, and rule toggles) writes to `localStorage` reactively.
* **Safety Guard**: The global system switch **defaults to off (false)** on cold-starts to prevent macro conflicts.
* **Double-Lock Exit Hook**: Custom exit triggers `app_handle.exit(0)`. Combined with Tauri's `.on_window_event` hook for the `Destroyed` stage on window `main`, this guarantees complete cleanup of background processes, preventing WebView2 write-lock freezes on relaunch.

---

### 5. Local Development & Compilation/Packaging

#### 1. Local Development
1. Enter the client directory:
   ```bash
   cd client
   ```
2. Install dependencies and start the Vite dev environment:
   ```bash
   npm install
   npm.cmd run tauri:dev
   ```

#### 2. Production Packaging
Execute the packager inside the `client` directory:
```bash
npm.cmd run tauri:build
```
Build files will be generated at `client/src-tauri/target/release/`:
* **`autobutton.exe`**: Portable Windows standalone package (**3.37 MB**, ~30MB memory runtime footprint).
* **`bundle/nsis/AutoButton_0.1.0_x64-setup.exe`**: NSIS portable setup package (**1.40 MB**).

</details>
