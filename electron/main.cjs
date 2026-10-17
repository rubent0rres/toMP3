const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { DownloadManager } = require('./downloader.cjs');
const { contactLink } = require('./contact.cjs');
const { ytDlpPath } = require('../shared/tools.cjs');
app.setName('toMP3');
protocol.registerSchemesAsPrivileged([{ scheme: 'tomp3', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window, manager, saveTimer, statePath, origin;
const inspections = new Set();
const devUrl = !app.isPackaged ? process.env.TOMP3_DEV_URL : undefined;
if (devUrl && devUrl !== 'http://127.0.0.1:3210') throw new Error('Invalid development URL');
let saveChain = Promise.resolve();
function persist() {
  const data = JSON.stringify(manager.snapshot(), null, 2);
  saveChain = saveChain.catch(() => {}).then(async () => { await fs.writeFile(`${statePath}.tmp`, data); await fs.rename(`${statePath}.tmp`, statePath); });
  return saveChain;
}
function register(name, handler) {
  ipcMain.handle(`tomp3:${name}`, async (event, ...args) => {
    try {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || `${new URL(event.senderFrame.url).protocol}//${new URL(event.senderFrame.url).host}` !== origin) throw new Error('Solicitud no autorizada.');
      return { ok: true, value: await handler(...args) };
    } catch (error) { return { ok: false, error: error.message || 'No se pudo completar la operación.' }; }
  });
}
async function createWindow() {
  window = new BrowserWindow({ width: 1220, height: 860, minWidth: 980, minHeight: 720, title: 'toMP3', icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'resources/icon.png'), backgroundColor: '#0b0b0d', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 23 } } : { autoHideMenuBar: true }), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== `${origin}/` && url !== origin) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  await window.loadURL(devUrl || 'tomp3://desktop/');
  window.on('closed', () => { window = null; });
}
if (locked) app.whenReady().then(async () => {
  const out = path.join(app.getAppPath(), 'out');
  protocol.handle('tomp3', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'desktop' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
      let file = path.resolve(out, `.${decodeURIComponent(url.pathname)}`);
      if (path.relative(out, file).startsWith('..') || path.isAbsolute(path.relative(out, file))) return new Response('Forbidden', { status: 403 });
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.ytimg.com https://i9.ytimg.com https://*.fbcdn.net https://*.fbsbx.com data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  origin = devUrl || 'tomp3://desktop';
  statePath = path.join(app.getPath('userData'), 'downloads.json');
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'resources/bin');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const destination = typeof saved.destination === 'string' && path.isAbsolute(saved.destination) ? saved.destination : path.join(app.getPath('downloads'), 'toMP3');
  await fs.mkdir(destination, { recursive: true }).catch(() => {});
  const executable = ytDlpPath(bin);
  manager = new DownloadManager({ executable, ffmpegDir: bin, destination, jobs: Array.isArray(saved.jobs) ? saved.jobs.filter(j => j && typeof j.id === 'string' && typeof j.url === 'string') : [] });
  let toolsReady = true;
  for (const file of [executable, ...['ffmpeg', 'ffprobe'].map(name => path.join(bin, `${name}${suffix}`))]) { try { await fs.access(file); } catch { toolsReady = false; } }
  const state = () => ({ ...manager.snapshot(), toolsReady, version: app.getVersion(), platform: process.platform });
  manager.on('change', () => { if (window && !window.isDestroyed()) window.webContents.send('tomp3:state-changed', state()); clearTimeout(saveTimer); saveTimer = setTimeout(() => persist().catch(console.error), 350); });
  register('state', state);
  register('contact', target => shell.openExternal(contactLink(target)));
  register('paste', () => clipboard.readText().slice(0, 2048));
  register('inspect', url => {
    if (!toolsReady) throw new Error('Faltan las herramientas. Ejecuta npm run tools:setup y vuelve a abrir la aplicación.');
    const operation = manager.inspect(url); inspections.add(operation); operation.finally(() => inspections.delete(operation)).catch(() => {}); return operation;
  });
  register('download', (url, options) => { if (!toolsReady) throw new Error('Faltan las herramientas de descarga.'); return manager.enqueue(url, options); });
  register('cancel', id => manager.cancel(id));
  register('retry', id => manager.retry(id));
  register('clear', () => manager.clearHistory());
  register('folder', async () => { const result = await dialog.showOpenDialog(window, { defaultPath: manager.destination, properties: ['openDirectory', 'createDirectory'] }); if (!result.canceled && result.filePaths[0]) { manager.destination = result.filePaths[0]; manager.notify(); } return manager.destination; });
  register('open-folder', async () => { await fs.mkdir(manager.destination, { recursive: true }); const error = await shell.openPath(manager.destination); if (error) throw new Error(error); });
  register('reveal', async id => { const job = manager.jobs.find(j => j.id === id && j.status === 'completed'); if (!job?.filePath || path.dirname(job.filePath) !== job.destination) throw new Error('No se encontró el archivo.'); await fs.access(job.filePath).catch(() => { throw new Error('El archivo se movió o se eliminó.'); }); shell.showItemInFolder(job.filePath); });
  await persist();
  await createWindow();
  if (toolsReady) void manager.warmup();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow(); });
}).catch(error => { dialog.showErrorBox('No se pudo abrir toMP3', error.message); app.quit(); });
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let quitting = false;
app.on('before-quit', event => {
  if (quitting || !manager) return;
  event.preventDefault(); quitting = true;
  manager.shutdown(); clearTimeout(saveTimer);
  persist().catch(console.error).finally(() => app.quit());
});
