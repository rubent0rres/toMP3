const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

function normalizeUrl(input) {
  const invalid = 'Pega un enlace de YouTube o de un Reel de Facebook.';
  if (typeof input !== 'string' || input.length > 2048) throw new Error(invalid);
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error(invalid); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Usa un enlace HTTPS de YouTube o Facebook.');
  if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com'].includes(url.hostname)) {
    const reel = url.pathname.match(/^\/reels?\/(\d+)\/?$/);
    if (reel) return `https://www.facebook.com/reel/${reel[1]}`;
    const shared = url.pathname.match(/^\/share\/r\/([A-Za-z0-9]+)\/?$/);
    if (shared) return `https://www.facebook.com/share/r/${shared[1]}/`;
    const id = url.searchParams.get('v');
    if (/^\/(?:watch\/?|video\.php)$/.test(url.pathname) && /^\d+$/.test(id || '')) return `https://www.facebook.com/reel/${id}`;
    throw new Error('Copia el enlace de un Reel individual de Facebook, directo o desde Compartir.');
  }
  if (['fb.watch', 'www.fb.watch'].includes(url.hostname)) {
    const token = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    if (token) return `https://fb.watch/${token}/`;
    throw new Error(invalid);
  }
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error(invalid);
  return `https://www.youtube.com/watch?v=${id}`;
}
function sourceForUrl(input) {
  const host = new URL(normalizeUrl(input)).hostname;
  return host === 'www.youtube.com' ? 'youtube' : 'facebook';
}
function validateOptions(options, source = 'youtube') {
  if (!options || !['mp3', 'mp4'].includes(options.format)) throw new Error('Selecciona MP3 o MP4.');
  const allowed = options.format === 'mp3' ? ['128', '192', '256', '320'] : source === 'facebook' ? ['original'] : ['720', '1080', '1440', '2160'];
  if (!allowed.includes(options.quality)) throw new Error('La calidad seleccionada no es válida.');
  return { format: options.format, quality: options.quality };
}
function downloadArgs(url, options, folder) {
  const normalized = normalizeUrl(url);
  const source = sourceForUrl(normalized);
  validateOptions(options, source);
  const args = ['--newline', '--no-simulate', '--progress', '--progress-delta', '0.3', '--progress-template', 'download:__PROGRESS__%(progress)j', '--print', 'after_move:__FILE__%(filepath)j', '--no-overwrites', '--no-mtime', '-P', folder, '-o', '%(title).150B [%(id)s].%(ext)s'];
  if (options.format === 'mp3') args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${options.quality}K`);
  else if (source === 'facebook') args.push('-f', 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]', '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  else args.push('-f', `bv*[ext=mp4][height<=${options.quality}]+ba[ext=m4a]/b[ext=mp4][height<=${options.quality}]`, '--merge-output-format', 'mp4', '--remux-video', 'mp4');
  return [...args, '--', normalized];
}
function friendlyError(raw, inputUrl) {
  let source = 'youtube';
  try { source = sourceForUrl(inputUrl); } catch {}
  const platform = source === 'facebook' ? 'Facebook' : 'YouTube';
  if (/requested format.*not available/i.test(raw)) return source === 'facebook' ? 'Este Reel no ofrece un MP4 compatible. Prueba descargando solo el audio.' : 'No hay un MP4 disponible en esa calidad. Prueba con otra resolución o elige MP3.';
  if (source === 'facebook' && /cannot parse data|unable to extract|login|log in|sign in|cookies|private|not available|unavailable|403|404/i.test(raw)) return 'Facebook no permitió acceder a este Reel. Puede ser privado, requerir iniciar sesión o estar restringido. Prueba con un Reel público y su enlace directo.';
  if (/sign in|bot|confirm you/i.test(raw)) return `${platform} pide una verificación para este video. Prueba con otro enlace o vuelve a intentarlo más tarde.`;
  if (/private video|members.only|login required/i.test(raw)) return 'Este video es privado o requiere iniciar sesión.';
  if (/not available|unavailable|removed|copyright/i.test(raw)) return 'El video no está disponible o tiene una restricción de acceso.';
  if (/ENOSPC|no space left/i.test(raw)) return 'No hay espacio suficiente en la carpeta de destino.';
  if (/EACCES|permission denied/i.test(raw)) return 'No se puede escribir en esa carpeta. Elige otra ubicación.';
  if (/timed out|network|resolve|connection|HTTP Error/i.test(raw)) return `No se pudo conectar con ${platform}. Revisa tu conexión y vuelve a intentarlo.`;
  return raw.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 450) || 'No se pudo completar la descarga. Inténtalo de nuevo.';
}

class DownloadManager extends EventEmitter {
  constructor({ executable, ffmpegDir, runtime = process.execPath, destination, jobs = [], spawnProcess = spawn }) {
    super();
    this.executable = executable;
    this.ffmpegDir = ffmpegDir;
    this.runtime = runtime;
    this.destination = destination;
    this.spawnProcess = spawnProcess;
    this.cache = new Map();
    this.jobs = jobs.slice(0, 100).map(job => ['queued', 'downloading', 'converting'].includes(job.status) ? { ...job, status: 'error', error: 'La aplicación se cerró antes de terminar. Puedes reintentar la descarga.' } : job);
    this.active = null;
    this.stopping = false;
    this.inspections = new Set();
  }
  snapshot() { return { destination: this.destination, jobs: this.jobs.map(job => ({ ...job })) }; }
  notify() { this.emit('change', this.snapshot()); }
  baseArgs() { return ['--ignore-config', '--no-playlist', '--no-colors', '--no-warnings', '--socket-timeout', '20', '--retries', '3', '--js-runtimes', `node:${this.runtime}`, '--ffmpeg-location', this.ffmpegDir]; }
  launch(args) { return this.spawnProcess(this.executable, [...this.baseArgs(), ...args], { shell: false, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: process.platform !== 'win32' }); }
  async inspect(input) {
    if (this.stopping) throw new Error('La aplicación se está cerrando.');
    const url = normalizeUrl(input);
    const source = sourceForUrl(url);
    const platform = source === 'facebook' ? 'Facebook' : 'YouTube';
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.video;
    if (this.inspections.size >= 3) throw new Error('Espera a que termine el análisis actual.');
    const child = this.launch(['--dump-single-json', '--skip-download', '--', url]);
    this.inspections.add(child);
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; this.kill(child); }, 90000);
      child.stdout.on('data', data => { stdout += data; if (stdout.length > 15_000_000) this.kill(child); });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-6000); });
      const clean = () => { clearTimeout(timer); this.inspections.delete(child); };
      child.once('error', () => { clean(); reject(new Error('No se pudo iniciar el motor de descarga. Ejecuta npm run tools:setup.')); });
      child.once('close', code => {
        clean();
        if (timedOut) return reject(new Error(`${platform} tardó demasiado en responder. Vuelve a intentarlo.`));
        if (code !== 0) return reject(new Error(friendlyError(stderr, url)));
        try {
          const info = JSON.parse(stdout);
          if (info.is_live || info.live_status === 'is_upcoming') throw new Error('Espera a que termine la transmisión para descargarla.');
          if (source === 'facebook' && !/^facebook/i.test(info.extractor_key || info.extractor || '')) throw new Error('El enlace compartido no corresponde a un Reel de Facebook compatible.');
          let canonicalUrl = url;
          if (source === 'facebook' && info.webpage_url) {
            try { const resolved = normalizeUrl(info.webpage_url); if (sourceForUrl(resolved) === source) canonicalUrl = resolved; } catch {}
          }
          const video = { url: canonicalUrl, source, id: info.id, title: info.title || 'Video sin título', author: info.channel || info.uploader || platform, duration: Number(info.duration) || 0, thumbnail: info.thumbnail?.startsWith('https://') ? info.thumbnail : '', resolutions: [...new Set((info.formats || []).filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.height).map(f => f.height))].sort((a,b) => b-a) };
          this.cache.set(url, { at: Date.now(), video });
          if (canonicalUrl !== url) this.cache.set(canonicalUrl, { at: Date.now(), video });
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
          resolve(video);
        } catch (error) { reject(error instanceof SyntaxError ? new Error('No se pudo leer la información del video.') : error); }
      });
    });
  }
  async enqueue(input, options) {
    if (this.stopping) throw new Error('La aplicación se está cerrando.');
    const selected = validateOptions(options, sourceForUrl(input));
    const video = await this.inspect(input);
    if (this.stopping) throw new Error('La aplicación se está cerrando.');
    const unfinished = this.jobs.filter(job => ['queued', 'downloading', 'converting'].includes(job.status));
    if (unfinished.length >= 20) throw new Error('La cola está llena. Espera a que terminen algunas descargas.');
    if (unfinished.some(job => job.url === video.url && job.format === selected.format && job.quality === selected.quality)) throw new Error('Ese video ya está en la cola con la misma calidad.');
    const job = { ...video, ...selected, destination: this.destination, status: 'queued', progress: 0, createdAt: new Date().toISOString() };
    // The queue ID is distinct from the platform's video ID.
    job.id = randomUUID();
    this.jobs.unshift(job);
    this.jobs = [...this.jobs.filter(j => ['queued', 'downloading', 'converting'].includes(j.status)), ...this.jobs.filter(j => !['queued', 'downloading', 'converting'].includes(j.status))].slice(0, 100);
    this.notify();
    void this.pump();
    return job.id;
  }
  async pump() {
    if (this.active || this.stopping) return;
    const job = [...this.jobs].reverse().find(j => j.status === 'queued');
    if (!job) return;
    const active = { job, child: null, cancelled: false, watchdog: null };
    this.active = active;
    const staging = path.join(job.destination, '.tomp3', job.id);
    try {
      await fs.mkdir(staging, { recursive: true });
      if (active.cancelled || this.stopping) return;
      job.status = 'downloading';
      this.notify();
      const child = this.launch(downloadArgs(job.url, job, staging));
      active.child = child;
      let stderr = '', output = '', pending = '';
      const resetWatchdog = () => { clearTimeout(active.watchdog); active.watchdog = setTimeout(() => { active.stalled = true; this.kill(child); }, job.status === 'converting' ? 1800000 : 180000); };
      resetWatchdog();
      const consume = line => {
        if (line.startsWith('__PROGRESS__')) {
          try {
            const p = JSON.parse(line.slice(12));
            const total = p.total_bytes || p.total_bytes_estimate;
            job.progress = total ? Math.min(100, Math.max(0, (p.downloaded_bytes / total) * 100)) : 0;
            job.speed = typeof p.speed === 'number' ? p.speed : null;
            job.eta = typeof p.eta === 'number' ? p.eta : null;
            this.notify();
          } catch {}
        } else if (line.startsWith('__FILE__')) {
          try { output = JSON.parse(line.slice(8)); } catch {}
        } else if (/\[(?:ExtractAudio|Merger|VideoRemuxer|Fixup)/.test(line)) {
          job.status = 'converting'; job.progress = 100; job.speed = null; job.eta = null; this.notify();
        }
      };
      await new Promise((resolve, reject) => {
        child.stdout.on('data', data => { resetWatchdog(); pending += data.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(consume); if (pending.length > 100000) pending = ''; });
        child.stderr.on('data', data => { resetWatchdog(); stderr = (stderr + data).slice(-6000); });
        child.once('error', reject);
        child.once('close', code => { if (pending) consume(pending); if (active.cancelled) resolve(); else if (active.stalled) reject(new Error('La descarga dejó de responder. Revisa la conexión e inténtalo de nuevo.')); else if (code === 0) resolve(); else reject(new Error(friendlyError(stderr, job.url))); });
      });
      if (active.cancelled || this.stopping) return;
      if (!output || typeof output !== 'string' || path.dirname(path.resolve(output)) !== path.resolve(staging) || path.extname(output) !== `.${job.format}`) throw new Error('No se encontró el archivo final en el formato solicitado.');
      if (!(await fs.stat(output)).size) throw new Error('El archivo descargado está vacío.');
      const base = path.basename(output, path.extname(output));
      let finalPath;
      for (let i = 0; i < 1000; i++) {
        if (active.cancelled || this.stopping) return;
        const candidate = path.join(job.destination, `${base}${i ? ` (${i})` : ''}.${job.format}`);
        try { await fs.copyFile(output, candidate, constants.COPYFILE_EXCL); finalPath = candidate; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!finalPath) throw new Error('No se pudo crear un nombre de archivo disponible.');
      if (active.cancelled || this.stopping) { await fs.rm(finalPath, { force: true }); return; }
      job.filePath = finalPath;
      job.status = 'completed'; job.progress = 100; job.speed = null; job.eta = null; job.completedAt = new Date().toISOString();
    } catch (error) {
      if (!active.cancelled) { job.status = 'error'; job.error = friendlyError(error.message, job.url); }
    } finally {
      clearTimeout(active.watchdog);
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      if (active.cancelled) { job.status = 'cancelled'; job.error = undefined; }
      this.active = null;
      this.notify();
      void this.pump();
    }
  }
  kill(child) {
    if (!child?.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => child.kill());
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
    }
  }
  cancel(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !['queued', 'downloading', 'converting'].includes(job.status)) return;
    if (this.active?.job.id === id) { this.active.cancelled = true; this.kill(this.active.child); }
    job.status = 'cancelled'; this.notify();
  }
  async retry(id) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || !['error', 'cancelled'].includes(job.status)) throw new Error('Esta descarga no se puede reintentar.');
    return this.enqueue(job.url, job);
  }
  clearHistory() { this.jobs = this.jobs.filter(j => ['queued', 'downloading', 'converting'].includes(j.status) || this.active?.job.id === j.id); this.notify(); }
  shutdown() {
    this.stopping = true;
    for (const child of this.inspections) this.kill(child);
    if (this.active) { this.active.cancelled = true; this.kill(this.active.child); }
  }
}
module.exports = { DownloadManager, normalizeUrl, sourceForUrl, validateOptions, downloadArgs, friendlyError };
