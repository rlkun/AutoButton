import { app, BrowserWindow, ipcMain, screen, desktopCapturer } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically load native robotjs to enable real OS-level inputs, fallback to mock if build fails
let robot: any;
try {
  robot = require('robotjs');
} catch (err) {
  console.warn('Native robotjs module load failed. Mock mode activated.', err);
  robot = {
    keyTap: (key: string) => console.log('Mocked physical key press:', key),
    screen: { capture: (x: any, y: any, w: any, h: any) => ({}) }
  };
}

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let highlighterWindow: BrowserWindow | null = null; // Highlighting hovered window physical outline
let psScriptPath = '';
let watchScriptPath = '';
let watchProcess: ChildProcess | null = null;
let activeForegroundPid: number | null = null;
let activeForegroundTitle: string = '';

const pendingDebugLogs: string[] = [];
let isMainWindowReady = false;

function sendDebugLog(msg: string) {
  if (isMainWindowReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-update', { message: msg });
  } else {
    pendingDebugLogs.push(msg);
  }
}

function flushPendingLogs() {
  isMainWindowReady = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    while (pendingDebugLogs.length > 0) {
      const msg = pendingDebugLogs.shift();
      if (msg) {
        mainWindow.webContents.send('task-update', { message: msg });
      }
    }
  }
}

// Redirect console outputs to UI log panel for diagnostic transparency, blocking terminal output
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  sendDebugLog(`[LOG] ${args.join(' ')}`);
};

console.error = (...args) => {
  sendDebugLog(`[ERROR] ${args.join(' ')}`);
};

console.warn = (...args) => {
  sendDebugLog(`[WARN] ${args.join(' ')}`);
};

// PowerShell script to monitor foreground active process & window title in real time with autoflush (avoiding pipe buffers)
const watchScriptContent = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

$lastPid = 0
$lastTitle = ""
while ($true) {
    $hwnd = [Win32]::GetForegroundWindow()
    if ($hwnd -ne 0) {
        $curPid = [uint32]0
        [Win32]::GetWindowThreadProcessId($hwnd, [ref]$curPid)
        
        $sb = New-Object System.Text.StringBuilder 512
        [Win32]::GetWindowText($hwnd, $sb, 512) | Out-Null
        $title = $sb.ToString().Trim()

        if ($curPid -ne $lastPid -or $title -ne $lastTitle) {
            $lastPid = $curPid
            $lastTitle = $title
            [Console]::Out.WriteLine("ACTIVE_PID:$curPid")
            [Console]::Out.WriteLine("ACTIVE_TITLE:$title")
            [Console]::Out.Flush()
        }
    } else {
        if ($lastPid -ne 0) {
            $lastPid = 0
            $lastTitle = ""
            [Console]::Out.WriteLine("ACTIVE_PID:0")
            [Console]::Out.WriteLine("ACTIVE_TITLE:")
            [Console]::Out.Flush()
        }
    }
    Start-Sleep -Milliseconds 250
}
`;

// PowerShell script content for fetching windows bounds using GetWindowRect (no COM hangs)
const psScriptContent = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@

[System.Diagnostics.Process]::GetProcesses() | Where-Object {\$_.MainWindowHandle -ne 0 -and \$_.MainWindowTitle} | ForEach-Object {
    \$rect = New-Object RECT
    if ([Win32]::GetWindowRect(\$_.MainWindowHandle, [ref]\$rect)) {
        [PSCustomObject]@{
            pid = \$_.Id
            title = \$_.MainWindowTitle
            x = \$rect.Left
            y = \$rect.Top
            width = (\$rect.Right - \$rect.Left)
            height = (\$rect.Bottom - \$rect.Top)
        }
    }
} | ConvertTo-Json -Compress
`;

// Helper to get window list & coordinates via C# Win32 query (~150ms)
function getSystemWindowList(): Promise<any[]> {
  return new Promise((resolve) => {
    if (!psScriptPath) {
      resolve([]);
      return;
    }
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`;
    exec(cmd, { encoding: 'utf8' }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const currentPid = process.pid;

        const res = list
          .map((item: any) => {
            const x = Number(item.x);
            const y = Number(item.y);
            const w = Number(item.width);
            const h = Number(item.height);
            // Ignore minimized bounds (-32000 coordinate states)
            const isValid = isFinite(x) && isFinite(y) && isFinite(w) && isFinite(h) && w > 0 && h > 0 && x !== -32000;
            return {
              pid: item.pid,
              title: item.title.trim(),
              x: isValid ? x : null,
              y: isValid ? y : null,
              width: isValid ? w : null,
              height: isValid ? h : null,
            };
          })
          .filter(item => item.title.length > 0 && item.pid !== currentPid);

        // Sort alphabetically
        res.sort((a, b) => a.title.localeCompare(b.title));
        resolve(res);
      } catch (e) {
        resolve([]);
      }
    });
  });
}

let stdoutBuffer = '';

// Start the persistent PowerShell background process watcher
function startWatchForegroundProcess() {
  if (watchProcess) {
    try {
      watchProcess.kill();
    } catch (e) {}
  }

  console.log(`[Watch Focus] Spawning powershell watcher script: ${watchScriptPath}`);
  watchProcess = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', watchScriptPath]);

  watchProcess.stdout?.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || ''; // Keep unfinished last chunk

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ACTIVE_PID:')) {
        const pidStr = trimmed.replace('ACTIVE_PID:', '');
        const pid = parseInt(pidStr);
        activeForegroundPid = pid === 0 ? null : pid;
        console.log(`[Watch Focus] Active PID set to: ${activeForegroundPid}`);
      } else if (trimmed.startsWith('ACTIVE_TITLE:')) {
        activeForegroundTitle = trimmed.replace('ACTIVE_TITLE:', '').trim();
        console.log(`[Watch Focus] Active Title set to: "${activeForegroundTitle}"`);
      }
    }
  });

  watchProcess.stderr?.on('data', (data) => {
    const errStr = data.toString();
    console.error('[Watch Focus PowerShell Error]:', errStr);
  });

  watchProcess.on('error', (err) => {
    console.error('[Watch Focus] Spawn watcher process error:', err);
  });

  watchProcess.on('exit', (code) => {
    console.warn(`[Watch Focus] PowerShell watcher exited with code ${code}. Restarting in 1s...`);
    setTimeout(() => {
      startWatchForegroundProcess();
    }, 1000);
  });
}

// Task scheduler state with active focus check
class TaskScheduler {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private globalEnabled: boolean = false;
  private targetWindow: { pid: number | null; name: string } | null = null;

  async updateTasks(tasks: any[], globalEnabled: boolean, targetWindow: any) {
    this.globalEnabled = globalEnabled;
    this.targetWindow = targetWindow;
    
    // Clear all existing intervals
    for (const [id, interval] of this.intervals.entries()) {
      clearInterval(interval);
    }
    this.intervals.clear();

    if (!this.globalEnabled) return;

    for (const task of tasks) {
      if (!task.enabled) continue;

      const { id, name, mode, triggerKey, threshold, intervalMs, rect } = task;

      if (mode === 'interval') {
        const interval = setInterval(() => {
          // Double-check focus with PID or Window Title (fuzzy matching to handle mod flags like unsaved '*')
          if (this.targetWindow && this.targetWindow.pid !== null) {
            const pidMatched = activeForegroundPid === this.targetWindow.pid;
            
            const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '');
            const activeTitleNorm = activeForegroundTitle ? normalize(activeForegroundTitle) : '';
            const targetNameNorm = this.targetWindow.name ? normalize(this.targetWindow.name) : '';
            
            const titleMatched = activeTitleNorm && targetNameNorm && 
              (activeTitleNorm.includes(targetNameNorm) || targetNameNorm.includes(activeTitleNorm));

            if (!pidMatched && !titleMatched) {
              if (mainWindow) {
                mainWindow.webContents.send('task-update', { 
                  message: `[跳过] 目标 "${this.targetWindow.name}" 处于非焦点状态，不触发 [${name}]` 
                });
              }
              return;
            }
          }

          robot.keyTap(triggerKey.toLowerCase());
          if (mainWindow) {
            mainWindow.webContents.send('task-update', { 
              message: `[${name}] 定时间隔触发, 按下: ${triggerKey}` 
            });
          }
        }, intervalMs || 1000);
        this.intervals.set(id, interval);
      } else if (mode === 'percentage' && rect) {
        const interval = setInterval(() => {
          // Double-check focus with PID or Window Title (fuzzy matching to handle mod flags like unsaved '*')
          if (this.targetWindow && this.targetWindow.pid !== null) {
            const pidMatched = activeForegroundPid === this.targetWindow.pid;
            
            const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, '');
            const activeTitleNorm = activeForegroundTitle ? normalize(activeForegroundTitle) : '';
            const targetNameNorm = this.targetWindow.name ? normalize(this.targetWindow.name) : '';
            
            const titleMatched = activeTitleNorm && targetNameNorm && 
              (activeTitleNorm.includes(targetNameNorm) || targetNameNorm.includes(activeTitleNorm));

            if (!pidMatched && !titleMatched) {
              if (mainWindow) {
                mainWindow.webContents.send('task-update', { 
                  message: `[跳过] 目标 "${this.targetWindow.name}" 处于非焦点状态，不执行 [${name}] 识图` 
                });
              }
              return;
            }
          }

          // Mock OCR check
          const num = 85; 
          if (num < threshold) {
            robot.keyTap(triggerKey.toLowerCase());
            if (mainWindow) {
              mainWindow.webContents.send('task-update', { 
                message: `[${name}] 数值 ${num}% < 阈值 ${threshold}%, 按下: ${triggerKey}` 
              });
            }
          }
        }, intervalMs || 2000);
        this.intervals.set(id, interval);
      }
    }
  }

  stopAll() {
    for (const [id, interval] of this.intervals.entries()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    this.globalEnabled = false;
  }
}

const scheduler = new TaskScheduler();

// Mock verify
async function verifyLicense() {
  return { success: true, message: 'Fallback valid' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    frame: false, // Frameless window
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    flushPendingLogs();
  });
}

// Highlighter window for physical target window boundary outline
function createHighlighterWindow() {
  highlighterWindow = new BrowserWindow({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    enableLargerThanScreen: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  highlighterWindow.setIgnoreMouseEvents(true); // Ignore mouse clicks
  highlighterWindow.setBounds({ x: -99999, y: -99999, width: 1, height: 1 });
  highlighterWindow.showInactive();

  highlighterWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body, html {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }
        .border-box {
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          border: 4px solid #3b82f6;
          border-radius: 8px;
          box-shadow: inset 0 0 12px rgba(59, 130, 246, 0.4), 0 0 20px rgba(59, 130, 246, 0.6);
          animation: pulse 1.2s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
      </style>
    </head>
    <body>
      <div class="border-box"></div>
    </body>
    </html>
  `));
}

app.whenReady().then(() => {
  // Use unique watch script name based on current PID to completely avoid Windows file lock collision
  psScriptPath = path.join(app.getPath('temp'), `get-windows-${process.pid}.ps1`);
  watchScriptPath = path.join(app.getPath('temp'), `watch-foreground-${process.pid}.ps1`);
  try {
    fs.writeFileSync(psScriptPath, psScriptContent, 'utf8');
    fs.writeFileSync(watchScriptPath, watchScriptContent, 'utf8');
  } catch (err) {
    console.error('Failed to write helper PS scripts:', err);
  }

  // Start background window focus listener
  startWatchForegroundProcess();

  createWindow();
  createHighlighterWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (watchProcess) {
    try {
      watchProcess.kill();
    } catch (e) {}
  }
  // Clean up unique temp scripts on exit
  try {
    if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath);
    if (fs.existsSync(watchScriptPath)) fs.unlinkSync(watchScriptPath);
  } catch (e) {}
});

// IPC Handlers
ipcMain.handle('verify-license', async () => {
  return await verifyLicense();
});

ipcMain.handle('capture-rect', async (event, rect) => {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    });
    const primarySource = sources[0];
    if (primarySource) {
      const image = primarySource.thumbnail;
      const cropped = image.crop({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.min(image.getSize().width, Math.round(rect.width)),
        height: Math.min(image.getSize().height, Math.round(rect.height))
      });
      return cropped.toDataURL();
    }
  } catch (e) {
    console.error('Failed to capture rect:', e);
  }
  return null;
});

ipcMain.handle('start-task', (event, { tasks, globalEnabled, targetWindow }) => {
  scheduler.updateTasks(tasks, globalEnabled, targetWindow);
  return { success: true };
});

ipcMain.handle('stop-task', () => {
  scheduler.stopAll();
  return { success: true };
});

// Window list fetching API
ipcMain.handle('get-window-list', async () => {
  return await getSystemWindowList();
});

// Window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-pin', () => {
  if (mainWindow) {
    const isPinned = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(isPinned);
    return { success: true, pinned: isPinned };
  }
  return { success: false, pinned: false };
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Window Highlight IPC handlers (reads cached coordinates directly, 0ms latency)
ipcMain.on('window-hover', (event, rect) => {
  if (!highlighterWindow || !rect || rect.x === null || rect.y === null || rect.width === null || rect.height === null) {
    if (highlighterWindow) {
      highlighterWindow.setBounds({ x: -99999, y: -99999, width: 1, height: 1 });
    }
    return;
  }
  highlighterWindow.setBounds({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  });
});

ipcMain.on('window-hover-exit', () => {
  if (highlighterWindow) {
    highlighterWindow.setBounds({ x: -99999, y: -99999, width: 1, height: 1 });
  }
});

ipcMain.handle('open-overlay', () => {
  if (overlayWindow) return;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    overlayWindow.loadURL(process.env.VITE_DEV_SERVER_URL + '#/overlay');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'overlay' });
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
});

ipcMain.on('overlay-rect-selected', (event, rect) => {
  if (mainWindow) {
    mainWindow.webContents.send('overlay-selected', rect);
  }
  if (overlayWindow) {
    overlayWindow.close();
  }
});
