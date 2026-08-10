import { app, BrowserWindow, session } from 'electron';
import * as path from 'path';
import { ProxyEngine } from './proxy/engine';
import { CertificateManager } from './proxy/certificate';
import { registerIpcHandlers } from './ipc/handlers';
import { initDatabase, closeDatabase, persistDatabase } from './storage/database';
import { runRetentionPolicy, getGrpcHosts } from './storage/queries';
import { clearSystemProxy } from './utils/windows-proxy';
import { DEFAULT_PROXY_PORT, DEFAULT_PROXY_HOST } from '../shared/constants';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Crash resilience: log unexpected errors instead of taking down the entire
// proxy process (and losing all captured traffic). User scripts, upstream
// quirks, and library bugs should never kill the app silently.
process.on('unhandledRejection', (reason) => {
  console.error('[proxyboy] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[proxyboy] Uncaught exception:', err);
});

let mainWindow: BrowserWindow | null = null;
let proxyEngine: ProxyEngine | null = null;

const createWindow = (): void => {
  // Enforce a strict Content Security Policy to mitigate XSS risk in the renderer.
  // 'unsafe-inline' for styles is needed because Vite injects style tags during HMR.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          MAIN_WINDOW_VITE_DEV_SERVER_URL
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:",
        ],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1b26',
      symbolColor: '#c0caf5',
      height: 36,
    },
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  });

  // In development, Vite serves from localhost
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Block window.open and navigation away from the app
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL && url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
  });

  // Initialize proxy engine
  const certManager = new CertificateManager();
  proxyEngine = new ProxyEngine(
    {
      port: DEFAULT_PROXY_PORT,
      host: DEFAULT_PROXY_HOST,
      enableSsl: true,
      grpcHosts: getGrpcHosts(),
    },
    certManager,
  );

  // Register IPC handlers
  registerIpcHandlers(mainWindow, proxyEngine, certManager);

  // Uncomment to open DevTools: mainWindow.webContents.openDevTools({ mode: 'detach' });
};

// Vite dev server URL declarations
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

app.whenReady().then(async () => {
  try {
    await initDatabase();
    // Enforce the flow retention policy on startup so the DB never grows unbounded
    try { runRetentionPolicy(); } catch (error) { console.error('Failed to apply retention policy:', error); }
    createWindow();
  } catch (error) {
    console.error('Failed to initialize application:', error);
    app.quit();
  }
}).catch((error) => {
  console.error('app.whenReady() failed:', error);
  app.quit();
});

app.on('before-quit', () => {
  try {
    persistDatabase();
  } catch (error) {
    console.error('Failed to persist database before quit:', error);
  }
});

app.on('window-all-closed', async () => {
  try { persistDatabase(); } catch {}
  try { await clearSystemProxy(); } catch {}
  if (proxyEngine?.isRunning()) {
    await proxyEngine.stop();
  }
  closeDatabase();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
