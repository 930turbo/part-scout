const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  session,
  Tray,
  Menu,
  nativeTheme,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
let runtime, window, tray;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on('second-instance', () => {
  if (window) {
    window.show();
    window.focus();
  }
});
app
  .whenReady()
  .then(async () => {
    const directory = process.env.SCOUT_DESKTOP_DATA_DIR || app.getPath('userData');
    fs.mkdirSync(directory, { recursive: true });
    process.env.DATABASE_PATH = path.join(directory, 'part-scout.db');
    process.env.SCOUT_PUBLIC_DIR = path.join(__dirname, '..', 'public');
    process.env.HOST = '127.0.0.1';
    process.env.PORT = '0';
    const token = randomBytes(32).toString('hex');
    process.env.ADMIN_TOKEN = token;
    const { start, Connections } = require('./server.cjs');
    runtime = start({
      connections: (store) =>
        new Connections(
          store,
          directory,
          safeStorage.isEncryptionAvailable()
            ? {
                encrypt: (s) => safeStorage.encryptString(s),
                decrypt: (b) => safeStorage.decryptString(b),
              }
            : undefined,
        ),
    });
    await new Promise((resolve, reject) => {
      runtime.server.once('listening', resolve);
      runtime.server.once('error', reject);
    });
    const port = runtime.server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    const appSession = session.fromPartition('persist:scout-app');
    appSession.webRequest.onBeforeSendHeaders(
      { urls: [`${origin}/api/*`] },
      (details, callback) => {
        details.requestHeaders.Authorization = `Bearer ${token}`;
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window = new BrowserWindow({
      width: 1450,
      height: 980,
      minWidth: 880,
      minHeight: 640,
      title: 'Part Scout',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#101416', symbolColor: '#d9e4e5', height: 35 },
      backgroundColor: '#101416',
      icon: path.join(__dirname, '..', 'build', 'icon.ico'),
      show: !process.env.SCOUT_SMOKE_TEST,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: appSession,
      },
    });
    window.setMenuBarVisibility(false);
    if (!process.env.SCOUT_SMOKE_TEST) {
      tray = new Tray(path.join(__dirname, '..', 'build', 'icon.ico'));
      tray.setToolTip('Part Scout · Monitoring your garage');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Open Part Scout',
            click: () => {
              window.show();
              window.focus();
            },
          },
          { label: 'Open data folder', click: () => shell.openPath(directory) },
          { type: 'separator' },
          { label: 'Quit Part Scout', click: () => app.quit() },
        ]),
      );
      tray.on('double-click', () => {
        window.show();
        window.focus();
      });
    }
    window.on('close', (event) => {
      if (!closing && runtime.store.settings().backgroundMonitoring) {
        event.preventDefault();
        window.hide();
      }
    });
    const trusted = (event) => {
      if (event.sender !== window.webContents || new URL(event.sender.getURL()).origin !== origin)
        throw new Error('Untrusted renderer');
    };
    ipcMain.handle('scout:open-seller', async (event, url) => {
      trusted(event);
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        throw new Error('Only secure seller pages can be opened.');
      const seller = new BrowserWindow({
        parent: window,
        width: 1200,
        height: 850,
        title: `Seller · ${parsed.hostname}`,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: 'persist:scout-sellers',
        },
      });
      seller.setMenuBarVisibility(false);
      let sellerAddress = parsed;
      seller.webContents.on('page-title-updated', (event) => {
        event.preventDefault();
        seller.setTitle(`${sellerAddress.hostname} · Seller checkout`);
      });
      seller.webContents.on('did-navigate', (_event, address) => {
        sellerAddress = new URL(address);
        seller.setTitle(`${sellerAddress.hostname} · Seller checkout`);
      });
      seller.webContents.session.setPermissionRequestHandler((_web, _permission, callback) =>
        callback(false),
      );
      const allowedNavigation = (raw) => {
        try {
          return new URL(raw).protocol === 'https:';
        } catch {
          return false;
        }
      };
      seller.webContents.on('will-navigate', (event, next) => {
        if (!allowedNavigation(next)) event.preventDefault();
      });
      seller.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedNavigation(url)) void seller.loadURL(url).catch(() => {});
        return { action: 'deny' };
      });
      await seller.loadURL(parsed.toString());
      return { ok: true };
    });
    ipcMain.handle('scout:open-external', async (event, url) => {
      trusted(event);
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('Invalid external link');
      await shell.openExternal(parsed.toString());
    });
    ipcMain.handle('scout:data-folder', async (event) => {
      trusted(event);
      await shell.openPath(directory);
    });
    ipcMain.handle('scout:appearance', (event, value) => {
      trusted(event);
      if (!['dark', 'light', 'system'].includes(value)) throw new Error('Invalid theme');
      nativeTheme.themeSource = value;
      const light = value === 'light' || (value === 'system' && !nativeTheme.shouldUseDarkColors);
      window.setTitleBarOverlay({
        color: light ? '#edf1f2' : '#101416',
        symbolColor: light ? '#203136' : '#d9e4e5',
        height: 35,
      });
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) {
        event.preventDefault();
        if (url.startsWith('https://')) void shell.openExternal(url);
      }
    });
    appSession.on('will-download', async (_event, item) => {
      item.pause();
      const result = await dialog.showSaveDialog(window, { defaultPath: item.getFilename() });
      if (result.canceled) item.cancel();
      else {
        item.setSavePath(result.filePath);
        item.resume();
      }
    });
    await window.loadURL(origin);
    if (process.env.SCOUT_SMOKE_TEST) {
      const result = await window.webContents.executeJavaScript(
        "fetch('/api/status').then(r=>r.json()).then(s=>({version:s.version,demo:s.demo,cars:s.cars.length,total:s.total}))",
      );
      const monitor = runtime.store.putMonitor({
        name: 'Smoke fixture',
        model: 'Mazda RX7',
        part: 'Transmission',
        yearStart: 1986,
        yearEnd: 1988,
        zip: '01545',
        region: '',
        variant: '',
        provider: 'import',
        carId: null,
        referencePhoto: '',
        keywords: '',
        feedUrl: '',
        intervalMinutes: 60,
        pageLimit: 5,
        enabled: true,
        maxPrice: null,
        maxMiles: null,
        maxDistance: null,
        include: '',
        exclude: '',
        states: '',
        grades: '',
        allowUnknownPrice: true,
        allowUnknownMiles: true,
        allowUnknownDistance: true,
        notifyInitial: false,
        notifyNew: true,
        notifyDrops: true,
        destination: 'default',
      });
      const response = await fetch(
        `${origin}/api/monitors/${monitor.id}/export?from=2020-01-01&to=2030-01-01`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const workbook = Buffer.from(await response.arrayBuffer());
      result.excel = response.ok && workbook[0] === 80 && workbook[1] === 75;
      fs.writeFileSync(path.join(directory, 'smoke-result.json'), JSON.stringify(result));
      await runtime.close();
      app.exit(0);
    }
  })
  .catch((error) => {
    if (process.env.SCOUT_SMOKE_TEST) {
      fs.writeFileSync(
        path.join(process.env.SCOUT_DESKTOP_DATA_DIR, 'smoke-error.json'),
        JSON.stringify({ error: error.message }),
      );
      app.exit(1);
      return;
    }
    dialog.showErrorBox('Part Scout could not start', error.message);
    app.exit(1);
  });
app.on('window-all-closed', () => app.quit());
let closing = false;
app.on('before-quit', (event) => {
  if (runtime && !closing) {
    event.preventDefault();
    closing = true;
    runtime
      .close()
      .then(() => app.quit())
      .catch(() => app.exit(1));
  }
});
