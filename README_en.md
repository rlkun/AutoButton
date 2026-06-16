# AutoButton Automatic Hotkey Assistant Tool (README)

[简体中文](./README.md) | [English](./README_en.md)

AutoButton is a minimalist, portable, multi-language (one-click seamless transition), locally persisted desktop utility featuring offline local WebAssembly OCR number-recognition triggering.

> **🤖 Statement: This application's front-end panel, Electron main process, multi-language engine, and packaging/building optimization schemes are assisted and co-developed by Google Gemini (Antigravity AI Coding Assistant) with the developer.**

---

## Table of Contents
- [1. Project Architecture & Components](#1-project-architecture--components)
- [2. Multi-Language Internationalization (i18n) Design](#2-multi-language-internationalization-i18n-design)
- [3. Configuration Persistence & Safety Guard](#3-configuration-persistence--safety-guard)
- [4. Local Development & Compilation/Packaging](#4-local-development--compilationpackaging)

---

## 1. Project Architecture & Components

The project consists of the client application (desktop app) and a pre-configured server skeleton:

```text
AutoButton/
├── client/          # Client App (Electron + React + TS)
└── server/          # Server (Node.js pre-configured logic)
```

### 1. Client (client)
* The core processing engine built using Electron, React, TypeScript, Vite, and CSS.
* Real-time foreground active window tracking utilizing PowerShell streams (buffered line-by-line reading to prevent chunk truncation).
* OS-level physical input simulation (`robotjs`) and offline WebAssembly-based OCR (`tesseract.js`).

### 2. Server (server)
* **Status**: Network verification server skeleton.
* **Verification Mechanism**: **The current version only reserves network verification APIs and does not perform online server checks**. The client falls back automatically to local offline simulation mode for authentication, allowing absolute single-machine offline operation with maximum privacy.

---

## 2. Multi-Language Internationalization (i18n) Design

We implemented a zero-latency, reactive local i18n engine with persistent state storage:

### 1. Static Configuration Separation
To ensure clean code logic, all static text assets are stored inside dedicated JSON translation dictionaries, strictly avoiding dynamic string composition or injection templates:
* Chinese Dictionary: [zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json)
* English Dictionary: [en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json)

### 2. Reactive Translation Wrapper `t()`
A reactive local helper `t(key)` handles key lookup. When the language state updates, React executes a seamless zero-refresh redraw. User language choice is automatically saved to `localStorage` and restored on startup.

### 3. Smart Default Rule and Template Translation
To deliver premium interaction, the application tracks rule names on transition. If rule names remain unchanged (retaining system defaults such as "百分比触发样例", "固定间隔触发样例", or "新增规则 1"), the engine **automatically translates them to the matching target language** (e.g., "Percentage Trigger Example" / "New Rule 1"). Once edited by the user, rules are bypassed to preserve custom names.

### 4. UI Layout Alignment
* **Authentication View**: The `中 / EN` selector sits neatly at the bottom of the card with `no-drag` attributes to avoid Electron frameless drag interference and prevent space conflicts with the top-right close button.
* **Dashboard View**: A glassmorphic `中 / EN` selector is placed adjacent to the "Window Selection" button for seamless, tactile control.

---

## 3. Configuration Persistence & Safety Guard

* **Auto-Save**: Any changes made to rules (including screenshot bounds, thresholds, intervals, and individual task toggles) are written directly to `localStorage` and automatically restored.
* **Safety Guard**: The global control switch is **intentionally excluded from auto-save and defaults to off (false)** on cold-start. This prevents unintended keyboard simulation conflicts upon opening the program.

---

## 4. Local Development & Compilation/Packaging

### 1. Local Development
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

### 2. Optimized Portable EXE Build
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
