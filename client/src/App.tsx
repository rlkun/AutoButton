import React, { useState, useEffect } from 'react';
import { Camera, LogIn, Plus, Trash2, X, Minus, Pin, Monitor, RotateCw } from 'lucide-react';
import './index.css';
import zh from './locales/zh.json';
import en from './locales/en.json';
import {
  verifyLicense,
  startTask,
  openOverlay,
  getWindowList,
  captureRect,
  minimizeWindow,
  toggleWindowPin,
  closeWindow,
  sendSelectedRect,
  setWindowHover,
  setWindowHoverExit,
  onTaskUpdate,
  onOverlaySelected,
  getWindowLabel,
  getWindowLabelSync,
} from './services/ipc';

interface TaskItem {
  id: string;
  name: string;
  mode: 'percentage' | 'interval';
  triggerKey: string;
  threshold: number;
  intervalMs: number;
  rect: any | null;
  enabled: boolean;
}

interface WindowItem {
  pid: number;
  title: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function App() {
  const [currentLang, setCurrentLang] = useState<'zh' | 'en'>(() => {
    return (localStorage.getItem('lang') as 'zh' | 'en') || 'zh';
  });

  const handleLangChange = (lang: 'zh' | 'en') => {
    const prevLangPack = currentLang === 'en' ? en : zh;
    const nextLangPack = lang === 'en' ? en : zh;

    setTasks(prevTasks => prevTasks.map(task => {
      const isDefaultTask1 = task.name === prevLangPack.rules.defaultTask1;
      const isDefaultTask2 = task.name === prevLangPack.rules.defaultTask2;
      
      const prevNewRulePrefix = prevLangPack.rules.newRuleDefault;
      const isNewRule = task.name.startsWith(prevNewRulePrefix);

      if (isDefaultTask1) {
        return { ...task, name: nextLangPack.rules.defaultTask1 };
      } else if (isDefaultTask2) {
        return { ...task, name: nextLangPack.rules.defaultTask2 };
      } else if (isNewRule) {
        const indexStr = task.name.substring(prevNewRulePrefix.length);
        return { ...task, name: `${nextLangPack.rules.newRuleDefault}${indexStr}` };
      }
      return task;
    }));

    setCurrentLang(lang);
    localStorage.setItem('lang', lang);
  };

  const t = (path: string, defaultValue = ''): string => {
    const langPack = currentLang === 'en' ? en : zh;
    const keys = path.split('.');
    let result: any = langPack;
    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = result[key];
      } else {
        return defaultValue || path;
      }
    }
    return typeof result === 'string' ? result : (defaultValue || path);
  };
  // Overlay Selection State
  const [overlayIsDrawing, setOverlayIsDrawing] = useState(false);
  const [overlayStartPos, setOverlayStartPos] = useState<{ x: number; y: number } | null>(null);
  const [overlayCurPos, setOverlayCurPos] = useState<{ x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState({ x: -9999, y: -9999 });

  const [windowLabel, setWindowLabel] = useState<string | null>(() => getWindowLabelSync());

  useEffect(() => {
    let isOverlay = false;
    let isHighlighter = false;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        sendSelectedRect(null);
      }
    };

    getWindowLabel().then(label => {
      setWindowLabel(label);
      if (label === 'overlay') {
        isOverlay = true;
        document.body.style.background = 'transparent';
        document.body.classList.add('overlay-active');
        window.addEventListener('keydown', handleKeyDown);
      } else if (label === 'highlighter') {
        isHighlighter = true;
        document.body.style.background = 'transparent';
        document.body.classList.add('highlighter-active');
      }
    });

    return () => {
      if (isOverlay) {
        document.body.style.background = '';
        document.body.classList.remove('overlay-active');
        window.removeEventListener('keydown', handleKeyDown);
      }
      if (isHighlighter) {
        document.body.style.background = '';
        document.body.classList.remove('highlighter-active');
      }
    };
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  
  // Target Window State
  const [targetWindow, setTargetWindow] = useState<{ pid: number | null; name: string }>({
    pid: null,
    name: t('modal.defaultOption')
  });
  
  const [windowList, setWindowList] = useState<WindowItem[]>([]);
  const [showWindowModal, setShowWindowModal] = useState(false);
  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);

  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    const saved = localStorage.getItem('tasks');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved tasks", e);
      }
    }
    const initLang = (localStorage.getItem('lang') as 'zh' | 'en') || 'zh';
    const langPack = initLang === 'en' ? en : zh;
    return [
      {
        id: 'task-1',
        name: langPack.rules.defaultTask1,
        mode: 'percentage',
        triggerKey: '1',
        threshold: 80,
        intervalMs: 1000,
        rect: null,
        enabled: false,
      },
      {
        id: 'task-2',
        name: langPack.rules.defaultTask2,
        mode: 'interval',
        triggerKey: 'F5',
        threshold: 80,
        intervalMs: 2000,
        rect: null,
        enabled: false,
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem('tasks', JSON.stringify(tasks));
  }, [tasks]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const logsContainerRef = React.useRef<HTMLDivElement>(null);

  const handleCopyLog = (text: string) => {
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy log:', err);
    });
  };

  const handleCopyAllLogs = () => {
    const filtered = logs.filter(log => showDebugLogs ? true : !(log.includes('[LOG]') || log.includes('[ERROR]') || log.includes('[WARN]') || log.includes('[排查]')));
    const textToCopy = filtered.join('\n');
    navigator.clipboard.writeText(textToCopy).catch(err => {
      console.error('Failed to copy all logs:', err);
    });
  };

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, showDebugLogs]);

  const [activeRectSelectTaskId, setActiveRectSelectTaskId] = useState<string | null>(null);

  const refreshTaskScreenshot = async (taskId: string, rect: any) => {
    if (!rect) return;
    try {
      const dataUrl = await captureRect(rect);
      if (dataUrl) {
        setTaskScreenshots(prev => ({ ...prev, [taskId]: dataUrl }));
      }
    } catch (e) {
      console.error("Manual refresh screenshot failed:", e);
    }
  };

  const formatLogTime = (): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
  };

  const [taskScreenshots, setTaskScreenshots] = useState<{ [taskId: string]: string }>({});
  const activeTaskIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    activeTaskIdRef.current = activeRectSelectTaskId;
  }, [activeRectSelectTaskId]);

  useEffect(() => {
    const unsubscribeTask = onTaskUpdate((data: any) => {
      const timePrefix = formatLogTime();
      setLogs(prev => [...prev.slice(-100), `${timePrefix} ${data.message}`]);
    });

    const unsubscribeOverlay = onOverlaySelected(async (newRect: any) => {
      const currentTaskId = activeTaskIdRef.current;
      if (currentTaskId && newRect) {
        setTasks(prev => prev.map(t => t.id === currentTaskId ? { ...t, rect: newRect } : t));
        try {
          const dataUrl = await captureRect(newRect);
          if (dataUrl) {
            setTaskScreenshots(prev => ({ ...prev, [currentTaskId]: dataUrl }));
          }
        } catch (e) {
          console.error("Failed to capture rect:", e);
        }
        setActiveRectSelectTaskId(null);
      } else {
        setActiveRectSelectTaskId(null);
      }
    });

    return () => {
      unsubscribeTask();
      unsubscribeOverlay();
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      tasks.forEach(async (task) => {
        if (task.mode === 'percentage' && task.rect && !taskScreenshots[task.id]) {
          try {
            const dataUrl = await captureRect(task.rect);
            if (dataUrl) {
              setTaskScreenshots(prev => ({ ...prev, [task.id]: dataUrl }));
            }
          } catch (e) {}
        }
      });
    }
  }, [tasks, isAuthenticated, taskScreenshots]);

  // Auto-refresh preview screenshot aligned with detection intervals
  useEffect(() => {
    const activeTasksSignatures = tasks
      .filter(t => t.enabled && t.mode === 'percentage' && t.rect)
      .map(t => `${t.id}-${JSON.stringify(t.rect)}-${t.intervalMs || 2000}`)
      .join('|');

    if (!globalEnabled || !activeTasksSignatures) return;

    const timers: any[] = [];

    tasks.forEach((task) => {
      if (task.enabled && task.mode === 'percentage' && task.rect) {
        const interval = task.intervalMs || 2000;
        refreshTaskScreenshot(task.id, task.rect);
        const timer = setInterval(() => {
          refreshTaskScreenshot(task.id, task.rect);
        }, interval);
        timers.push(timer);
      }
    });

    return () => {
      timers.forEach(clearInterval);
    };
  }, [tasks, globalEnabled]);

  // Sync scheduler to main process
  useEffect(() => {
    if (isAuthenticated) {
      startTask({ tasks, globalEnabled, targetWindow });
    }
  }, [tasks, globalEnabled, targetWindow, isAuthenticated]);

  // Pre-fetch window list as soon as logged in
  useEffect(() => {
    if (isAuthenticated) {
      fetchWindowList();
    }
  }, [isAuthenticated]);

  const [recordingTaskId, setRecordingTaskId] = useState<string | null>(null);

  const mapWebKeyToRobotJS = (e: KeyboardEvent): string => {
    // 优先区分小键盘数字键 (Numpad0 - Numpad9)
    if (/^Numpad\d$/.test(e.code)) {
      const num = e.code.replace('Numpad', '');
      return `numpad_${num}`;
    }

    const lower = e.key.toLowerCase();
    const mapping: { [key: string]: string } = {
      ' ': 'space',
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
      'escape': 'escape',
      'enter': 'enter',
      'backspace': 'backspace',
      'delete': 'delete',
      'tab': 'tab',
      'control': 'control',
      'alt': 'alt',
      'shift': 'shift',
      'meta': 'command',
    };

    if (mapping[lower]) {
      return mapping[lower];
    }
    if (/^f\d+$/.test(lower)) {
      return lower;
    }
    return lower;
  };

  useEffect(() => {
    if (!recordingTaskId) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const robotKey = mapWebKeyToRobotJS(e);

      setTasks(prev => prev.map(t => {
        if (t.id === recordingTaskId) {
          return { ...t, triggerKey: robotKey };
        }
        return t;
      }));

      setRecordingTaskId(null);
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [recordingTaskId]);

  const handleLogin = async () => {
    const res = await verifyLicense();
    if (res.success) setIsAuthenticated(true);
  };

  const handleAddTask = () => {
    const newId = `task-${Date.now()}`;
    const newTask: TaskItem = {
      id: newId,
      name: `${t('rules.newRuleDefault')}${tasks.length + 1}`,
      mode: 'percentage',
      triggerKey: 'A',
      threshold: 80,
      intervalMs: 1000,
      rect: null,
      enabled: false
    };
    setTasks([...tasks, newTask]);
  };

  const handleDeleteTask = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  const handleUpdateTask = (id: string, updated: Partial<TaskItem>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updated } : t));
  };

  const handleOpenOverlay = (taskId: string) => {
    if (targetWindow.pid === null) {
      alert(t('globalControl.selectWindowAlert'));
      return;
    }
    setActiveRectSelectTaskId(taskId);
    openOverlay();
  };

  // Fetch windows list from IPC adapter
  const fetchWindowList = async () => {
    setIsRefreshingWindows(true);
    try {
      const list = await getWindowList();
      setWindowList(list || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshingWindows(false);
    }
  };

  const handleOpenWindowModal = () => {
    setShowWindowModal(true);
    fetchWindowList();
  };

  const handleSelectWindow = (pid: number | null, name: string) => {
    setTargetWindow({ pid, name });
    setShowWindowModal(false);
    setWindowHoverExit();
  };

  // Title bar controls
  const handleMinimize = () => minimizeWindow();
  const handleTogglePin = async () => {
    const res = await toggleWindowPin();
    if (res.success) {
      setIsPinned(res.pinned);
    }
  };
  const handleClose = () => closeWindow();

  if (windowLabel === null) {
    return <div style={{ background: 'transparent', width: '100vw', height: '100vh' }} />;
  }

  if (windowLabel === 'highlighter') {
    return <div className="border-box" style={{ width: '100vw', height: '100vh' }} />;
  }

  if (windowLabel === 'overlay') {
    const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setMousePos({ x: e.clientX, y: e.clientY });
      setOverlayIsDrawing(true);
      setOverlayStartPos({ x: e.clientX, y: e.clientY });
      setOverlayCurPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      if (!overlayIsDrawing) return;
      setOverlayCurPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      if (!overlayIsDrawing || !overlayStartPos || !overlayCurPos) return;
      setOverlayIsDrawing(false);

      const localX = Math.min(overlayStartPos.x, overlayCurPos.x);
      const localY = Math.min(overlayStartPos.y, overlayCurPos.y);
      const width = Math.abs(overlayStartPos.x - overlayCurPos.x);
      const height = Math.abs(overlayStartPos.y - overlayCurPos.y);

      if (width > 5 && height > 5) {
        // 读取预先由 Rust 注入到各屏幕窗口的物理像素偏移量和缩放因子
        const physXOffset = (window as any).__custom_window_physical_x__ || 0;
        const physYOffset = (window as any).__custom_window_physical_y__ || 0;
        const scaleFactor = (window as any).__custom_window_scale_factor__ || 1.0;

        // 转换为跨多屏幕的系统绝对物理像素坐标
        const physX = physXOffset + Math.round(localX * scaleFactor);
        const physY = physYOffset + Math.round(localY * scaleFactor);
        const physW = Math.round(width * scaleFactor);
        const physH = Math.round(height * scaleFactor);

        sendSelectedRect({ x: physX, y: physY, width: physW, height: physH });
      }

      setOverlayStartPos(null);
      setOverlayCurPos(null);
    };

    let selectionStyle: React.CSSProperties = { display: 'none' };
    let rectWidth = 0;
    let rectHeight = 0;
    if (overlayStartPos && overlayCurPos) {
      const left = Math.min(overlayStartPos.x, overlayCurPos.x);
      const top = Math.min(overlayStartPos.y, overlayCurPos.y);
      rectWidth = Math.round(Math.abs(overlayStartPos.x - overlayCurPos.x));
      rectHeight = Math.round(Math.abs(overlayStartPos.y - overlayCurPos.y));
      selectionStyle = {
        display: 'block',
        left: `${left}px`,
        top: `${top}px`,
        width: `${rectWidth}px`,
        height: `${rectHeight}px`,
      };
    }

    return (
      <div 
        className="overlay-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {!overlayIsDrawing && (
          <div className="overlay-tip-card">
            <span className="overlay-tip-title">{t('overlay.title')}</span>
            <span className="overlay-tip-subtitle">{t('overlay.subtitle')}</span>
          </div>
        )}
        <div className="overlay-selection-box" style={selectionStyle}>
          {rectWidth > 0 && rectHeight > 0 && (
            <div className="overlay-size-label">
              {rectWidth} &times; {rectHeight}
            </div>
          )}
        </div>
        {/* Custom High-visibility Tech Cursor */}
        <div className="custom-overlay-cursor" style={{ left: `${mousePos.x}px`, top: `${mousePos.y}px` }}>
          <div className="cursor-dot" />
          <div className="cursor-circle" />
          <div className="cursor-line-x" />
          <div className="cursor-line-y" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-container app-drag">
        <button onClick={handleClose} className="login-close-btn no-drag" title={t('titleBar.close')}>
          <X size={16} />
        </button>
        <div className="glass-panel login-card app-drag">
          <div className="login-icon">
            <LogIn size={32} color="white" />
          </div>
          <h1>{t('titleBar.title')}</h1>
          <p>{t('login.subtitle')}</p>
          <button onClick={handleLogin} className="btn-primary no-drag">
            {t('login.btnVerify')}
          </button>
          <div className="login-card-lang-selector no-drag">
            <button 
              onClick={() => handleLangChange('zh')} 
              className={`lang-toggle-btn ${currentLang === 'zh' ? 'active' : ''}`}
            >
              中
            </button>
            <button 
              onClick={() => handleLangChange('en')} 
              className={`lang-toggle-btn ${currentLang === 'en' ? 'active' : ''}`}
            >
              EN
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="window-frame">
      {/* Custom Title Bar */}
      <header className="title-bar app-drag">
        <div className="title-logo">
          <span className="logo-indicator" />
          <span className="logo-text">{t('titleBar.title')}</span>
        </div>
        <div className="title-drag-area app-drag" />
        <div className="window-controls no-drag">
          <button onClick={handleMinimize} className="control-btn min-btn" title={t('titleBar.minimize')}>
            <Minus size={14} />
          </button>
          <button onClick={handleTogglePin} className={`control-btn pin-btn ${isPinned ? 'pinned' : ''}`} title={isPinned ? t('titleBar.unpin') : t('titleBar.pin')}>
            <Pin size={13} className={isPinned ? "rotate-pin" : ""} />
          </button>
          <button onClick={handleClose} className="control-btn close-btn" title={t('titleBar.close')}>
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Main UI Body */}
      <div className="app-body inline-mode">
        
        {/* Upper Area: Global Header Switch */}
        <div className="global-header-bar">
          <div className="glass-panel global-control-card">
            
            {/* Global Control: Left Aligned */}
            <div className="global-control-left-section">
              <div className="global-control-details">
                <span className="master-title">{t('globalControl.title')}</span>
                <span className={`master-status ${globalEnabled ? 'active' : ''}`}>
                  {globalEnabled ? t('globalControl.statusRunning') : t('globalControl.statusStandby')}
                </span>
              </div>
              <button 
                onClick={() => setGlobalEnabled(!globalEnabled)}
                className={`master-switch ${globalEnabled ? 'active' : ''}`}
              >
                <div className="switch-dot" />
              </button>
            </div>

            {/* Target Window Selector: Right Aligned */}
            <div className="global-control-right-section">
              <div className="lang-toggle-bar">
                <button 
                  onClick={() => handleLangChange('zh')} 
                  className={`lang-toggle-btn ${currentLang === 'zh' ? 'active' : ''}`}
                >
                  中
                </button>
                <button 
                  onClick={() => handleLangChange('en')} 
                  className={`lang-toggle-btn ${currentLang === 'en' ? 'active' : ''}`}
                >
                  EN
                </button>
              </div>

              <button 
                onClick={handleOpenWindowModal} 
                className={`select-window-btn ${targetWindow.pid ? 'selected' : ''}`}
              >
                <Monitor size={14} />
                <span className="window-select-label">
                  {targetWindow.pid ? `${t('globalControl.target')}${targetWindow.name}` : t('globalControl.targetLabelDefault')}
                </span>
              </button>
            </div>

          </div>
          
          <button onClick={handleAddTask} className="add-rule-btn-top">
            <Plus size={16} /> {t('globalControl.addRuleBtn')}
          </button>
        </div>

        {/* Scrollable Rules Area */}
        <div className="rules-scroll-area">
          {tasks.length === 0 ? (
            <div className="empty-rules-hint glass-panel">
              {t('rules.emptyHint')}
            </div>
          ) : (
            <div className="rules-grid-list">
              {tasks.map(task => (
                <div key={task.id} className={`rule-inline-card glass-panel ${task.enabled ? 'active-state' : ''}`}>
                  
                  {/* Top row of card: Name, Toggle, Delete */}
                  <div className="rule-card-header">
                    <input 
                      type="text" 
                      value={task.name} 
                      onChange={(e) => handleUpdateTask(task.id, { name: e.target.value })}
                      className="rule-name-inline-input"
                      placeholder={t('rules.namePlaceholder')}
                    />
                    
                    <div className="rule-card-header-actions">
                      <button 
                        onClick={() => handleUpdateTask(task.id, { enabled: !task.enabled })}
                        className={`task-toggle ${task.enabled ? 'active' : ''}`}
                      >
                        <div className="toggle-dot" />
                      </button>
                      <button onClick={() => handleDeleteTask(task.id)} className="delete-btn-inline" title={t('rules.deleteTitle')}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Settings row of card */}
                  <div className="rule-card-settings-grid">
                    
                    {/* Mode Selector */}
                    <div className="inline-setting-group mode-selector-col">
                      <label>{t('rules.triggerMode')}</label>
                      <div className="inline-mode-tabs">
                        <button
                          onClick={() => handleUpdateTask(task.id, { mode: 'percentage' })}
                          className={`inline-mode-tab-btn ${task.mode === 'percentage' ? 'active' : ''}`}
                        >
                          {t('rules.modeOcr')}
                        </button>
                        <button
                          onClick={() => handleUpdateTask(task.id, { mode: 'interval' })}
                          className={`inline-mode-tab-btn ${task.mode === 'interval' ? 'active' : ''}`}
                        >
                          {t('rules.modeInterval')}
                        </button>
                      </div>
                    </div>

                    {/* Key Input */}
                    <div className="inline-setting-group key-input-col">
                      <label>{t('rules.keyLabel')}</label>
                      <button 
                        onClick={() => setRecordingTaskId(task.id)}
                        className={`recording-key-btn ${recordingTaskId === task.id ? 'recording' : ''}`}
                      >
                        {recordingTaskId === task.id ? t('rules.keyPressHint') : (task.triggerKey ? task.triggerKey.toUpperCase() : t('rules.keyUnset'))}
                      </button>
                    </div>

                    {/* Condition Config */}
                    {task.mode === 'percentage' ? (
                      <>
                        {/* 3. OCR Capture */}
                        <div className="inline-setting-group capture-col">
                          <label>{t('rules.ocrScope')}</label>
                          <div className="rect-preview-box merged-preview">
                            {/* Float Overlay Select Button */}
                            <button 
                              onClick={() => handleOpenOverlay(task.id)} 
                              className="overlay-absolute-btn select-btn"
                              title={task.rect ? `${t('rules.ocrResetTitle')} [${task.rect.width}x${task.rect.height}]` : t('rules.ocrSelectTitle')}
                            >
                              <Camera size={12} />
                              <span>{task.rect ? `${task.rect.width}x${task.rect.height}` : t('rules.ocrSelectTitle')}</span>
                            </button>
                            
                            {/* Float Overlay Refresh Button */}
                            {task.rect && (
                              <button 
                                onClick={() => refreshTaskScreenshot(task.id, task.rect)} 
                                className="overlay-absolute-btn refresh-btn"
                                title={t('rules.refreshTitle')}
                              >
                                <RotateCw size={11} />
                              </button>
                            )}

                            {/* Captured Screen Image or Placeholder */}
                            {task.rect ? (
                              taskScreenshots[task.id] ? (
                                <div className="screenshot-wrapper">
                                  <img 
                                    src={taskScreenshots[task.id]} 
                                    alt="Screenshot preview" 
                                    className="screenshot-preview-img"
                                  />
                                </div>
                              ) : (
                                <div className="screenshot-placeholder">
                                  <span>{t('rules.capturing')}</span>
                                </div>
                              )
                            ) : (
                              <div className="screenshot-empty-placeholder">
                                <span>{t('rules.noScope')}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* 4. Threshold & Interval Config */}
                        <div className="inline-setting-group threshold-col">
                          <div className="sub-setting-row">
                            <div className="sub-setting-item">
                              <label>{t('rules.thresholdLabel')}</label>
                              <input 
                                type="number"
                                min="0"
                                max="100"
                                value={task.threshold}
                                onChange={(e) => handleUpdateTask(task.id, { threshold: parseInt(e.target.value) || 0 })}
                                className="input-field threshold-input-inline"
                                placeholder="80"
                              />
                            </div>
                            <div className="sub-setting-item">
                              <label>{t('rules.intervalLabel')}</label>
                              <input 
                                type="number"
                                value={task.intervalMs || 2000}
                                onChange={(e) => handleUpdateTask(task.id, { intervalMs: parseInt(e.target.value) || 0 })}
                                className="input-field interval-input-inline"
                                placeholder="2000"
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="inline-setting-group interval-col">
                        <label>{t('rules.intervalTimeLabel')}</label>
                        <input 
                          type="number"
                          value={task.intervalMs}
                          onChange={(e) => handleUpdateTask(task.id, { intervalMs: parseInt(e.target.value) || 0 })}
                          className="input-field interval-input-inline"
                        />
                      </div>
                    )}

                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Area: System Logs */}
        <div className="glass-panel logs-panel-inline">
          <div className="logs-panel-header">
            <h3>{t('logs.title')}</h3>
            <div className="logs-panel-actions">
              <label className="checkbox-container">
                <input 
                  type="checkbox" 
                  checked={showDebugLogs}
                  onChange={(e) => setShowDebugLogs(e.target.checked)}
                />
                <span className="checkbox-label">{t('logs.showDebug')}</span>
              </label>
              <button onClick={handleCopyAllLogs} className="clear-logs-btn" style={{ marginRight: '8px' }}>
                {t('logs.copyAllBtn')}
              </button>
              <button onClick={() => setLogs([])} className="clear-logs-btn">
                {t('logs.clearBtn')}
              </button>
            </div>
          </div>
          <div className="logs-container" ref={logsContainerRef}>
            {logs.filter(log => showDebugLogs ? true : !(log.includes('[LOG]') || log.includes('[ERROR]') || log.includes('[WARN]') || log.includes('[排查]'))).length === 0 && (
              <span className="empty-log">{t('logs.emptyHint')}</span>
            )}
            {logs
              .filter(log => showDebugLogs ? true : !(log.includes('[LOG]') || log.includes('[ERROR]') || log.includes('[WARN]') || log.includes('[排查]')))
              .map((log, i, filteredArray) => {
                const isLatest = i === filteredArray.length - 1;
                return (
                  <div 
                    key={i} 
                    className={`log-entry ${isLatest ? 'latest-log' : ''}`}
                    onDoubleClick={() => handleCopyLog(log)}
                    title={t('logs.doubleClickCopy')}
                    style={{ cursor: 'pointer' }}
                  >
                    &gt; {log}
                  </div>
                );
              })}
          </div>
        </div>

      </div>

      {/* Target Window Selector Modal */}
      {showWindowModal && (
        <div className="modal-overlay">
          <div className="glass-panel modal-card animate-scale-up">
            <div className="modal-header">
              <h3>{t('modal.title')}</h3>
              <div className="modal-header-actions">
                <button onClick={fetchWindowList} className="modal-action-btn" title={t('modal.refreshTitle')}>
                  <RotateCw size={14} className={isRefreshingWindows ? "animate-spin" : ""} />
                </button>
                <button onClick={() => { setShowWindowModal(false); setWindowHoverExit(); }} className="modal-action-btn close">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="window-items-list">
                
                {/* Option 1: Do not select window */}
                <div 
                  onClick={() => handleSelectWindow(null, t('modal.defaultOption'))}
                  onMouseEnter={() => setWindowHoverExit()} // Clear highlight if hovered
                  className={`window-list-item special ${targetWindow.pid === null ? 'selected' : ''}`}
                >
                  <Monitor size={14} className="window-item-icon" />
                  <div className="window-item-info">
                    <span className="window-item-title">{t('modal.defaultOption')}</span>
                    <span className="window-item-pid">{t('modal.systemDefault')}</span>
                  </div>
                </div>

                {/* Loading state */}
                {isRefreshingWindows && windowList.length === 0 && (
                  <div className="modal-loading">{t('modal.loading')}</div>
                )}

                {/* System window list items */}
                {windowList.map(win => (
                  <div 
                    key={win.pid}
                    onClick={() => handleSelectWindow(win.pid, win.title)}
                    onMouseEnter={() => setWindowHover({ x: win.x, y: win.y, width: win.width, height: win.height })}
                    onMouseLeave={() => setWindowHoverExit()}
                    className={`window-list-item ${targetWindow.pid === win.pid ? 'selected' : ''}`}
                  >
                    <Monitor size={14} className="window-item-icon" />
                    <div className="window-item-info">
                      <span className="window-item-title">{win.title}</span>
                      <span className="window-item-pid">PID: {win.pid}</span>
                    </div>
                  </div>
                ))}

                {!isRefreshingWindows && windowList.length === 0 && (
                  <div className="empty-window-list">{t('modal.emptyList')}</div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
