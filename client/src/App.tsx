import React, { useState, useEffect } from 'react';
import { Camera, Play, Square, Settings, Clock, Activity, LogIn, Plus, Trash2, X, Minus, Pin, Monitor, RotateCw } from 'lucide-react';
import './index.css';

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
}

function App() {
  // Overlay Selection State
  const [overlayIsDrawing, setOverlayIsDrawing] = useState(false);
  const [overlayStartPos, setOverlayStartPos] = useState<{ x: number; y: number } | null>(null);
  const [overlayCurPos, setOverlayCurPos] = useState<{ x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState({ x: -9999, y: -9999 });

  useEffect(() => {
    if (window.location.hash !== '#/overlay') return;
    
    document.body.classList.add('overlay-active');
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if ((window as any).electronAPI) {
          (window as any).electronAPI.sendSelectedRect(null);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('overlay-active');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  
  // Target Window State
  const [targetWindow, setTargetWindow] = useState<{ pid: number | null; name: string }>({
    pid: null,
    name: '不选择 (前台激活模式)'
  });
  
  const [windowList, setWindowList] = useState<WindowItem[]>([]);
  const [showWindowModal, setShowWindowModal] = useState(false);
  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);

  const [tasks, setTasks] = useState<TaskItem[]>([
    {
      id: 'task-1',
      name: '游戏HP低自动喝药',
      mode: 'percentage',
      triggerKey: '1',
      threshold: 80,
      intervalMs: 1000,
      rect: null,
      enabled: false,
    },
    {
      id: 'task-2',
      name: '定时按键触发器',
      mode: 'interval',
      triggerKey: 'F5',
      threshold: 80,
      intervalMs: 2000,
      rect: null,
      enabled: false,
    }
  ]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const logsContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, showDebugLogs]);

  const [taskScreenshots, setTaskScreenshots] = useState<{ [taskId: string]: string }>({});
  const [activeRectSelectTaskId, setActiveRectSelectTaskId] = useState<string | null>(null);

  const refreshTaskScreenshot = async (taskId: string, rect: any) => {
    if (!rect || !(window as any).electronAPI) return;
    try {
      const dataUrl = await (window as any).electronAPI.captureRect(rect);
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

  useEffect(() => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.onTaskUpdate((data: any) => {
        const timePrefix = formatLogTime();
        setLogs(prev => [...prev.slice(-15), `${timePrefix} ${data.message}`]);
      });
      (window as any).electronAPI.onOverlaySelected(async (newRect: any) => {
        if (activeRectSelectTaskId && newRect) {
          setTasks(prev => prev.map(t => t.id === activeRectSelectTaskId ? { ...t, rect: newRect } : t));
          try {
            const dataUrl = await (window as any).electronAPI.captureRect(newRect);
            if (dataUrl) {
              setTaskScreenshots(prev => ({ ...prev, [activeRectSelectTaskId]: dataUrl }));
            }
          } catch (e) {
            console.error("Failed to capture rect:", e);
          }
          setActiveRectSelectTaskId(null);
        } else {
          setActiveRectSelectTaskId(null);
        }
      });
    }
  }, [activeRectSelectTaskId]);

  useEffect(() => {
    if (isAuthenticated && (window as any).electronAPI) {
      tasks.forEach(async (task) => {
        if (task.mode === 'percentage' && task.rect && !taskScreenshots[task.id]) {
          try {
            const dataUrl = await (window as any).electronAPI.captureRect(task.rect);
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

    const timers: NodeJS.Timeout[] = [];

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
    if ((window as any).electronAPI && isAuthenticated) {
      (window as any).electronAPI.startTask({ tasks, globalEnabled, targetWindow });
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
    if ((window as any).electronAPI) {
      const res = await (window as any).electronAPI.verifyLicense();
      if (res.success) setIsAuthenticated(true);
    } else {
      setIsAuthenticated(true);
    }
  };

  const handleAddTask = () => {
    const newId = `task-${Date.now()}`;
    const newTask: TaskItem = {
      id: newId,
      name: `新增规则 ${tasks.length + 1}`,
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
      alert("请先选择目标窗口，再选取识图范围！");
      return;
    }
    setActiveRectSelectTaskId(taskId);
    if ((window as any).electronAPI) {
      (window as any).electronAPI.openOverlay();
    } else {
      alert("Overlay is only available in Desktop App");
    }
  };

  // Fetch windows list from Electron
  const fetchWindowList = async () => {
    if (!(window as any).electronAPI) return;
    setIsRefreshingWindows(true);
    try {
      const list = await (window as any).electronAPI.getWindowList();
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
    (window as any).electronAPI?.hoverWindowExit(); // Hide highlighters on close
  };

  // Title bar controls
  const handleMinimize = () => (window as any).electronAPI?.minimize();
  const handleTogglePin = async () => {
    if ((window as any).electronAPI) {
      const res = await (window as any).electronAPI.pin();
      if (res.success) {
        setIsPinned(res.pinned);
      }
    } else {
      setIsPinned(!isPinned);
    }
  };
  const handleClose = () => (window as any).electronAPI?.close();

  if (window.location.hash === '#/overlay') {
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

      const x = Math.min(overlayStartPos.x, overlayCurPos.x);
      const y = Math.min(overlayStartPos.y, overlayCurPos.y);
      const width = Math.abs(overlayStartPos.x - overlayCurPos.x);
      const height = Math.abs(overlayStartPos.y - overlayCurPos.y);

      if (width > 5 && height > 5) {
        if ((window as any).electronAPI) {
          (window as any).electronAPI.sendSelectedRect({ x, y, width, height });
        }
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
            <span className="overlay-tip-title">识图范围选取</span>
            <span className="overlay-tip-subtitle">在屏幕上拖拽框选所需识图范围 (按 ESC 键取消)</span>
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
        <button onClick={handleClose} className="login-close-btn no-drag" title="关闭">
          <X size={16} />
        </button>
        <div className="glass-panel login-card app-drag">
          <div className="login-icon">
            <LogIn size={32} color="white" />
          </div>
          <h1>AutoButton</h1>
          <p>Please log in or verify your license to continue.</p>
          <button onClick={handleLogin} className="btn-primary no-drag">
            Verify License
          </button>
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
          <span className="logo-text">AutoButton</span>
        </div>
        <div className="title-drag-area app-drag" />
        <div className="window-controls no-drag">
          <button onClick={handleMinimize} className="control-btn min-btn" title="最小化">
            <Minus size={14} />
          </button>
          <button onClick={handleTogglePin} className={`control-btn pin-btn ${isPinned ? 'pinned' : ''}`} title={isPinned ? "取消置顶" : "窗口置顶"}>
            <Pin size={13} className={isPinned ? "rotate-pin" : ""} />
          </button>
          <button onClick={handleClose} className="control-btn close-btn" title="关闭">
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
                <span className="master-title">全局引擎总控</span>
                <span className={`master-status ${globalEnabled ? 'active' : ''}`}>
                  {globalEnabled ? "● 运行中 (RUNNING)" : "○ 已暂停 (STANDBY)"}
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
              <button 
                onClick={handleOpenWindowModal} 
                className={`select-window-btn ${targetWindow.pid ? 'selected' : ''}`}
              >
                <Monitor size={14} />
                <span className="window-select-label">
                  {targetWindow.pid ? `目标: ${targetWindow.name}` : '目标: 不选择 (前台激活)'}
                </span>
              </button>
            </div>

          </div>
          
          <button onClick={handleAddTask} className="add-rule-btn-top">
            <Plus size={16} /> 新增按键规则
          </button>
        </div>

        {/* Scrollable Rules Area */}
        <div className="rules-scroll-area">
          {tasks.length === 0 ? (
            <div className="empty-rules-hint glass-panel">
              当前暂无规则，请点击右上角按钮新增规则
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
                      placeholder="规则名称"
                    />
                    
                    <div className="rule-card-header-actions">
                      <button 
                        onClick={(e) => handleUpdateTask(task.id, { enabled: !task.enabled })}
                        className={`task-toggle ${task.enabled ? 'active' : ''}`}
                      >
                        <div className="toggle-dot" />
                      </button>
                      <button onClick={() => handleDeleteTask(task.id)} className="delete-btn-inline" title="删除规则">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Settings row of card */}
                  <div className="rule-card-settings-grid">
                    
                    {/* Mode Selector */}
                    <div className="inline-setting-group mode-selector-col">
                      <label>触发模式</label>
                      <div className="inline-mode-tabs">
                        <button
                          onClick={() => handleUpdateTask(task.id, { mode: 'percentage' })}
                          className={`inline-mode-tab-btn ${task.mode === 'percentage' ? 'active' : ''}`}
                        >
                          OCR百分比
                        </button>
                        <button
                          onClick={() => handleUpdateTask(task.id, { mode: 'interval' })}
                          className={`inline-mode-tab-btn ${task.mode === 'interval' ? 'active' : ''}`}
                        >
                          固定间隔
                        </button>
                      </div>
                    </div>

                    {/* Key Input */}
                    <div className="inline-setting-group key-input-col">
                      <label>模拟按键</label>
                      <button 
                        onClick={() => setRecordingTaskId(task.id)}
                        className={`recording-key-btn ${recordingTaskId === task.id ? 'recording' : ''}`}
                      >
                        {recordingTaskId === task.id ? '请按键...' : (task.triggerKey ? task.triggerKey.toUpperCase() : '未设置')}
                      </button>
                    </div>

                    {/* Condition Config */}
                    {task.mode === 'percentage' ? (
                      <>
                        {/* 3. OCR Capture */}
                        <div className="inline-setting-group capture-col">
                          <label>识图范围 (OCR Bounding)</label>
                          <div className="rect-preview-box merged-preview">
                            {/* Float Overlay Select Button */}
                            <button 
                              onClick={() => handleOpenOverlay(task.id)} 
                              className="overlay-absolute-btn select-btn"
                              title={task.rect ? `重新选取范围 [${task.rect.width}x${task.rect.height}]` : "选取范围"}
                            >
                              <Camera size={12} />
                              <span>{task.rect ? `${task.rect.width}x${task.rect.height}` : "选取范围"}</span>
                            </button>
                            
                            {/* Float Overlay Refresh Button */}
                            {task.rect && (
                              <button 
                                onClick={() => refreshTaskScreenshot(task.id, task.rect)} 
                                className="overlay-absolute-btn refresh-btn"
                                title="刷新当前画面"
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
                                  <span>正在截取画面...</span>
                                </div>
                              )
                            ) : (
                              <div className="screenshot-empty-placeholder">
                                <span>未设定识别范围</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* 4. Threshold & Interval Config */}
                        <div className="inline-setting-group threshold-col">
                          <div className="sub-setting-row">
                            <div className="sub-setting-item">
                              <label>触发阈值 (低于 %)</label>
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
                              <label>检测间隔 (毫秒)</label>
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
                        <label>时间间隔 (毫秒)</label>
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
            <h3>引擎系统日志</h3>
            <div className="logs-panel-actions">
              <label className="checkbox-container">
                <input 
                  type="checkbox" 
                  checked={showDebugLogs}
                  onChange={(e) => setShowDebugLogs(e.target.checked)}
                />
                <span className="checkbox-label">显示调试日志</span>
              </label>
              <button onClick={() => setLogs([])} className="clear-logs-btn">
                清空日志
              </button>
            </div>
          </div>
          <div className="logs-container" ref={logsContainerRef}>
            {logs.filter(log => showDebugLogs ? true : !(log.includes('[LOG]') || log.includes('[ERROR]') || log.includes('[WARN]') || log.includes('[排查]'))).length === 0 && (
              <span className="empty-log">控制中心就绪，开启总控及相应规则后可产生日志...</span>
            )}
            {logs
              .filter(log => showDebugLogs ? true : !(log.includes('[LOG]') || log.includes('[ERROR]') || log.includes('[WARN]') || log.includes('[排查]')))
              .map((log, i, filteredArray) => {
                const isLatest = i === filteredArray.length - 1;
                return (
                  <div key={i} className={`log-entry ${isLatest ? 'latest-log' : ''}`}>
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
              <h3>选择目标窗口</h3>
              <div className="modal-header-actions">
                <button onClick={fetchWindowList} className="modal-action-btn" title="刷新窗口">
                  <RotateCw size={14} className={isRefreshingWindows ? "animate-spin" : ""} />
                </button>
                <button onClick={() => { setShowWindowModal(false); (window as any).electronAPI?.hoverWindowExit(); }} className="modal-action-btn close">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="window-items-list">
                
                {/* Option 1: Do not select window */}
                <div 
                  onClick={() => handleSelectWindow(null, '不选择 (前台激活模式)')}
                  onMouseEnter={() => (window as any).electronAPI?.hoverWindowExit()} // Clear highlight if hovered
                  className={`window-list-item special ${targetWindow.pid === null ? 'selected' : ''}`}
                >
                  <Monitor size={14} className="window-item-icon" />
                  <div className="window-item-info">
                    <span className="window-item-title">不选择任何窗口 (仅在前台焦点状态下触发)</span>
                    <span className="window-item-pid">System Default</span>
                  </div>
                </div>

                {/* Loading state */}
                {isRefreshingWindows && windowList.length === 0 && (
                  <div className="modal-loading">正在搜索活动窗口...</div>
                )}

                {/* System window list items */}
                {windowList.map(win => (
                  <div 
                    key={win.pid}
                    onClick={() => handleSelectWindow(win.pid, win.title)}
                    onMouseEnter={() => (window as any).electronAPI?.hoverWindow({ x: win.x, y: win.y, width: win.width, height: win.height })}
                    onMouseLeave={() => (window as any).electronAPI?.hoverWindowExit()}
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
                  <div className="empty-window-list">未检测到任何包含标题的活跃应用窗口</div>
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
