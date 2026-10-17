const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DownloadManager, normalizeUrl, downloadArgs, friendlyError } = require('../electron/downloader.cjs');
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const video = { id: 'jNQXAC9IVRw', url, title: 'Video de prueba', author: 'Pruebas', duration: 19, thumbnail: '', resolutions: [720] };
async function fixture(t, behavior, prepareVideo = async ({ input }) => input) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'tomp3-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const manager = new DownloadManager({ executable: '/test/yt-dlp', ffmpegDir: '/test', destination: folder, prepareVideo, spawnProcess: (_cmd, args, options) => {
    assert.equal(options.shell, false);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 0;
    child.kill = () => child.emit('close', null);
    setImmediate(async () => { try { await behavior(child, args); } catch (e) { child.stderr.write(e.message); child.emit('close', 1); } });
    return child;
  } });
  manager.cache.set(url, { at: Date.now(), video });
  manager.kill = child => child?.kill();
  return { manager, folder };
}
function waitFor(manager, condition) {
  return new Promise((resolve, reject) => {
    if (condition()) return resolve();
    const timeout = setTimeout(() => { manager.off('change', onChange); reject(new Error('Timeout')); }, 5000);
    const onChange = () => { if (condition()) { clearTimeout(timeout); manager.off('change', onChange); resolve(); } };
    manager.on('change', onChange);
  });
}
async function complete(child, args, contents = 'media fixture') {
  const staging = args[args.indexOf('-P') + 1];
  const extension = args.includes('--audio-format') ? 'mp3' : 'mp4';
  const file = path.join(staging, `Prueba.${extension}`);
  await fs.writeFile(file, contents);
  child.stdout.write('__PROGRESS__{"downloaded_bytes":50,"total_bytes":100,"speed":1024,"eta":1}\n');
  child.stdout.write(`[${extension === 'mp3' ? 'ExtractAudio' : 'Merger'}] Finalizando\n`);
  child.stdout.write(`__FILE__${JSON.stringify(file)}\n`);
  child.emit('close', 0);
}
test('normaliza enlaces de YouTube y elimina parámetros ajenos', () => {
  assert.equal(normalizeUrl('https://youtu.be/jNQXAC9IVRw?si=abc'), url);
  assert.equal(normalizeUrl('https://www.youtube.com/shorts/jNQXAC9IVRw'), url);
  assert.equal(normalizeUrl(`${url}&list=hello`), url);
  for (const bad of ['file:///etc/passwd', 'https://youtube.com.evil.com/watch?v=jNQXAC9IVRw', 'https://user:pass@youtube.com/watch?v=jNQXAC9IVRw', 'https://youtube.com:4430/watch?v=jNQXAC9IVRw', '--exec=evil', 'https://youtu.be/;touch xyz', 'https://youtube.com/playlist?list=123']) assert.throws(() => normalizeUrl(bad));
});
test('construye argumentos de conversión sin un intérprete de comandos', () => {
  const audio = downloadArgs(url, { format: 'mp3', quality: '320' }, '/tmp/music');
  assert.equal(audio[audio.indexOf('--audio-quality') + 1], '320K');
  assert.equal(audio.at(-2), '--'); assert.equal(audio.at(-1), url);
  const mp4 = downloadArgs(url, { format: 'mp4', quality: '720' }, '/tmp/video');
  assert.match(mp4[mp4.indexOf('-f') + 1], /height<=720/);
  assert.throws(() => downloadArgs(url, { format: 'mp3', quality: ';bad' }, '/tmp'));
  assert.throws(() => downloadArgs(url, { format: 'exe', quality: '320' }, '/tmp'));
});
test('procesa la cola de forma serial, guarda archivos únicos y conserva los existentes', async t => {
  let running = 0, maxRunning = 0;
  const { manager, folder } = await fixture(t, async (child, args) => {
    running++; maxRunning = Math.max(maxRunning, running);
    await new Promise(resolve => setTimeout(resolve, 30));
    running--; await complete(child, args);
  });
  await fs.writeFile(path.join(folder, 'Prueba.mp3'), 'original');
  await manager.enqueue(url, { format: 'mp3', quality: '320' });
  await manager.enqueue(url, { format: 'mp3', quality: '192' });
  await waitFor(manager, () => manager.jobs.length === 2 && manager.jobs.every(j => j.status === 'completed') && !manager.active);
  assert.equal(maxRunning, 1);
  assert.equal(await fs.readFile(path.join(folder, 'Prueba.mp3'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(folder, 'Prueba (1).mp3'), 'utf8'), 'media fixture');
  assert.equal(await fs.readFile(path.join(folder, 'Prueba (2).mp3'), 'utf8'), 'media fixture');
  assert.equal(manager.jobs[0].progress, 100);
  assert.deepEqual(await fs.readdir(path.join(folder, '.tomp3')), []);
});
test('cancelar detiene el proceso, limpia temporales y deja avanzar la cola', async t => {
  const { manager, folder } = await fixture(t, async (child, args) => {
    if (args.includes('320K')) { child.stdout.write('__PROGRESS__{"downloaded_bytes":1,"total_bytes":10}\n'); return; }
    await complete(child, args);
  });
  const first = await manager.enqueue(url, { format: 'mp3', quality: '320' });
  await waitFor(manager, () => !!manager.active?.child);
  await manager.enqueue(url, { format: 'mp4', quality: '720' });
  manager.cancel(first);
  await waitFor(manager, () => !manager.active && manager.jobs.some(j => j.status === 'completed'));
  assert.equal(manager.jobs.find(j => j.id === first).status, 'cancelled');
  assert.deepEqual(await fs.readdir(path.join(folder, '.tomp3')), []);
});
test('rechaza duplicados pendientes y permite reintentar un fallo', async t => {
  let failed = false;
  const { manager } = await fixture(t, async (child, args) => {
    if (!failed) { failed = true; await new Promise(resolve => setTimeout(resolve, 40)); child.stderr.write('Network connection failed'); child.emit('close', 1); }
    else await complete(child, args);
  });
  const id = await manager.enqueue(url, { format: 'mp3', quality: '320' });
  await assert.rejects(manager.enqueue(url, { format: 'mp3', quality: '320' }), /ya está en la cola/);
  await waitFor(manager, () => manager.jobs[0].status === 'error' && !manager.active);
  await manager.retry(id);
  await waitFor(manager, () => manager.jobs[0].status === 'completed' && !manager.active);
  assert.equal(manager.jobs.length, 2);
});
test('no acepta archivos fuera de la carpeta de trabajo', async t => {
  const { manager } = await fixture(t, async child => { child.stdout.write('__FILE__"/tmp/untrusted.mp3"\n'); child.emit('close', 0); });
  await manager.enqueue(url, { format: 'mp3', quality: '320' });
  await waitFor(manager, () => manager.jobs[0].status === 'error' && !manager.active);
  assert.match(manager.jobs[0].error, /archivo final/);
});
test('rechaza archivos vacíos y limpia el trabajo fallido', async t => {
  const { manager, folder } = await fixture(t, (child, args) => complete(child, args, ''));
  await manager.enqueue(url, { format: 'mp3', quality: '320' });
  await waitFor(manager, () => manager.jobs[0].status === 'error' && !manager.active);
  assert.match(manager.jobs[0].error, /vacío/);
  assert.deepEqual(await fs.readdir(path.join(folder, '.tomp3')), []);
});
test('no publica un MP4 si falla la preparación para reproducirlo', async t => {
  const { manager, folder } = await fixture(t, (child, args) => complete(child, args), async () => { throw new Error('Pistas de video inválidas'); });
  await manager.enqueue(url, { format: 'mp4', quality: '720' });
  await waitFor(manager, () => manager.jobs[0].status === 'error' && !manager.active);
  assert.match(manager.jobs[0].error, /Pistas de video inválidas/);
  assert.equal(manager.jobs[0].filePath, undefined);
  assert.deepEqual(await fs.readdir(folder), ['.tomp3']);
  assert.deepEqual(await fs.readdir(path.join(folder, '.tomp3')), []);
});
test('cancelar durante la preparación no publica el video y deja avanzar la cola', async t => {
  let releasePreparation;
  let started;
  const preparationStarted = new Promise(resolve => { started = resolve; });
  const { manager, folder } = await fixture(t, (child, args) => complete(child, args), () => new Promise(resolve => { releasePreparation = resolve; started(); }));
  const id = await manager.enqueue(url, { format: 'mp4', quality: '720' });
  await preparationStarted;
  await manager.enqueue(url, { format: 'mp3', quality: '192' });
  manager.cancel(id);
  releasePreparation(path.join(folder, 'unused.mp4'));
  await waitFor(manager, () => !manager.active && manager.jobs.some(job => job.status === 'completed'));
  assert.equal(manager.jobs.find(job => job.id === id).status, 'cancelled');
  assert.equal((await fs.readdir(folder)).some(name => name.endsWith('.mp4')), false);
  assert.deepEqual(await fs.readdir(path.join(folder, '.tomp3')), []);
});
test('recupera historial interrumpido sin reanudar procesos automáticamente', () => {
  const manager = new DownloadManager({ jobs: [{ id: 'one', status: 'converting' }, { id: 'two', status: 'completed' }], destination: '/tmp' });
  assert.equal(manager.jobs[0].status, 'error'); assert.equal(manager.jobs[1].status, 'completed');
  assert.match(manager.jobs[0].error, /cerró antes/);
});
test('traduce errores de YouTube y red', () => {
  assert.match(friendlyError('Sign in to confirm you are not a bot'), /verificación/);
  assert.match(friendlyError('Private video'), /privado/);
  assert.match(friendlyError('HTTP Error 503'), /conectar/);
});

test('acepta Reels directos, compartidos y enlaces cortos de Facebook', () => {
  const reel = 'https://www.facebook.com/reel/1815304716326461';
  assert.equal(normalizeUrl(`${reel}/?mibextid=abc&rdid=xyz`), reel);
  assert.equal(normalizeUrl('https://m.facebook.com/reel/1815304716326461/'), reel);
  assert.equal(normalizeUrl('https://web.facebook.com/reels/1815304716326461/'), reel);
  assert.equal(normalizeUrl('https://m.facebook.com/watch/?v=1815304716326461&_rdr'), reel);
  assert.equal(normalizeUrl('https://www.facebook.com/share/r/1ABcd123/?mibextid=abc'), 'https://www.facebook.com/share/r/1ABcd123/');
  assert.equal(normalizeUrl('https://fb.watch/abc_DE-123/?u=https://evil.com'), 'https://fb.watch/abc_DE-123/');
  for (const bad of ['https://facebook.com.evil.com/reel/1815304716326461', 'https://facebook.com@evil.com/reel/1815304716326461', 'https://evil.facebook.com/reel/1815304716326461', 'http://facebook.com/reel/1815304716326461', 'https://facebook.com/reel/not-numeric', 'https://facebook.com/share/r/abc/extra', 'https://facebook.com/flx/warn/?u=https://evil.com', 'https://facebook.com/reels/', 'https://fb.watch/a/b']) assert.throws(() => normalizeUrl(bad));
});
test('prepara MP3 y MP4 originales de Facebook sin excluir formatos sin resolución conocida', () => {
  const reel = 'https://www.facebook.com/reel/1815304716326461';
  const audio = downloadArgs(reel, { format: 'mp3', quality: '320' }, '/tmp/fb');
  assert.equal(audio.at(-1), reel);
  assert.ok(audio.includes('320K'));
  const videoArgs = downloadArgs(reel, { format: 'mp4', quality: 'original' }, '/tmp/fb');
  assert.doesNotMatch(videoArgs[videoArgs.indexOf('-f') + 1], /height/);
  assert.ok(videoArgs.includes('--remux-video'));
  assert.throws(() => downloadArgs(url, { format: 'mp4', quality: 'original' }, '/tmp'));
  assert.throws(() => downloadArgs(reel, { format: 'mp4', quality: '1080' }, '/tmp'));
});
test('analiza enlaces compartidos y reutiliza la URL canónica para evitar duplicados', async t => {
  const shared = 'https://www.facebook.com/share/r/1ABcd123/';
  const reel = 'https://www.facebook.com/reel/1815304716326461';
  let inspections = 0;
  const { manager } = await fixture(t, async (child, args) => {
    assert.equal(args.at(-1), shared);
    inspections++;
    child.stdout.write(JSON.stringify({ id: '1815304716326461', title: 'Reel público de prueba', extractor_key: 'Facebook', webpage_url: 'https://m.facebook.com/watch/?v=1815304716326461&_rdr', duration: 35.5, thumbnail: 'https://scontent.example.fbcdn.net/thumb.jpg', formats: [{ext:'mp4',height:1920,vcodec:'avc1'}] }));
    child.emit('close', 0);
  });
  const info = await manager.inspect(shared);
  assert.equal(info.source, 'facebook');
  assert.equal(info.url, reel);
  assert.equal(info.author, 'Facebook');
  assert.deepEqual(await manager.inspect(reel), info);
  assert.equal(inspections, 1);
  manager.stopping = true;
});
test('la cola descarga Reels y conserva su plataforma en el historial', async t => {
  const reel = 'https://www.facebook.com/reel/1815304716326461';
  const { manager } = await fixture(t, (child, args) => complete(child, args));
  manager.cache.set(reel, {at:Date.now(),video:{...video,url:reel,source:'facebook'}});
  await manager.enqueue(reel, {format:'mp4',quality:'original'});
  await waitFor(manager, () => manager.jobs[0].status === 'completed' && !manager.active);
  assert.equal(manager.jobs[0].source, 'facebook');
  assert.equal(manager.jobs[0].quality, 'original');
});
test('muestra errores de acceso y conexión con la plataforma correcta', () => {
  const reel = 'https://www.facebook.com/reel/1815304716326461';
  assert.match(friendlyError('Cannot parse data', reel), /Facebook no permitió/);
  assert.match(friendlyError('Requested format is not available', reel), /MP4 compatible/);
  assert.match(friendlyError('Login required', reel), /iniciar sesión/);
  assert.match(friendlyError('Network connection failed', reel), /conectar con Facebook/);
  assert.doesNotMatch(friendlyError('HTTP Error 503', reel), /YouTube/);
});
