# AutoButton Client Dashboard Documentation (README)

[简体中文](./README.md) | [English](./README_en.md)

Welcome to the **AutoButton** automatic hotkey assistant client workspace. The primary goal of the workspace is to offer a portable, offline, multi-language (seamless one-click swap), locally-persisted UI dashboard with local WebAssembly-based OCR trigger rules.

This document describes the design and configuration of the **Multi-Language (i18n) Engine** to help you customize or integrate further.

---

## 1. Multi-Language i18n Architecture

The client utilizes a lightweight, reactive, zero-latency multi-language engine with persistent local storage:

```mermaid
graph TD
    A[User clicks i18n capsule Tab] --> B(handleLangChange logic)
    B --> C{Has the rule name been edited?}
    C -- No --> D[Link and translate default templates]
    C -- Yes --> E[Retain custom user name]
    B --> F[Update currentLang state and write to localStorage]
    F --> G[React redraw triggered across workspace]
    G --> H[Closure t() lookup inside target locales dictionary]
```

### 1. Static Translation Dictionaries
To prevent strings from mingling with business logic, all UI texts are decoupled into dedicated static JSON dictionary files (strictly avoiding inline dynamic concatenation/interpolations):
* Chinese Dictionary: [zh.json](file:///c:/antigravity/AutoButton/client/src/locales/zh.json)
* English Dictionary: [en.json](file:///c:/antigravity/AutoButton/client/src/locales/en.json)

### 2. Reactive Translation Wrapper `t()`
A local utility `t(key)` is scoped inside the parent `App` component in [App.tsx](file:///c:/antigravity/AutoButton/client/src/App.tsx). State updates to `currentLang` trigger a reactive redraw, converting all UI keys to the target language instantly.

### 3. Smart Default Rule Name Translation
To deliver premium interaction, the application tracks rule names on transition:
* **Detection**: On language changes, the `handleLangChange` function scans current task names.
* **Auto-Translation**: If rule names remain unchanged (matching defaults such as `"百分比触发样例"`, `"固定间隔触发样例"`, or `"新增规则 X"`), they are **automatically translated to their target language counterparts** (e.g., `"Percentage Trigger Example"` / `"New Rule X"`).
* **Bypass**: Any manually edited rule name is bypassed to preserve user customizations.

### 4. Selector UI Layout & Placement
To bypass Electron's frameless window drag capture and avoid space conflicts, selectors are placed strategically:
* **Login View**: The `中 / EN` selector sits neatly at the bottom of the card with `no-drag` attributes, avoiding click interception and remaining clear of the top-right close button.
* **Dashboard View**: A glassmorphic `中 / EN` capsule selector is placed adjacent to the "Window Selection" button for seamless control.

### 5. localStorage State Persistence
The language choice is written directly to the browser's `localStorage`. This choice is restored on boot to prevent flash/flicker.

---

## 2. Task Persistence & Safety Guard

* **Auto-Save**: Rule configurations (bounds, thresholds, intervals, key bindings, and task states) write immediately to `localStorage` on any modification and restore on application boot.
* **Safety Guard**: The global running control toggle is **never persisted and defaults to off (false)** on cold-start. This prevents loops or key press conflicts upon opening the program.

---

## 3. Local Build, Packaging & Execution

### 1. Install Dependencies
Ensure you install Node dependencies for native addon setup:
```bash
npm install
```

### 2. Dev server
```bash
npm run dev
```

### 3. Build Portable EXE
The builder performs dependency pruning to exclude dev dependencies from the ASAR archive, yielding an optimized **93.6MB** file. It extracts *only* `robotjs.node` and `worker-script/node/index.js` (exactly 2 files) via `asarUnpack`, enabling **instant millisecond-level cold start speed**:
```bash
npm run dist
```
Builds are saved in `dist-package/`:
* **`AutoButton 0.0.0.exe`**: Portable executable.
* **`AutoButton-0.0.0-win.zip`**: Compressed archive.
* **Diagnostics**: Logs write to `%APPDATA%\client\diagnostic.log` on startup. If any issues occur, check this file for details.
