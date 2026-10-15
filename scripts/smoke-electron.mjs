import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlIndex = process.argv.indexOf('--url');
const testUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const facebook = /facebook\.com|fb\.watch/.test(new URL(testUrl).hostname);
const work = path.join(root, 'work/smoke');
await rm(work, { recursive: true, force: true });
await mkdir(path.join(work, 'profile'), { recursive: true });
await mkdir(path.join(work, 'downloads'), { recursive: true });
await writeFile(path.join(work, 'profile/downloads.json'), JSON.stringify({ destination: path.join(work, 'downloads'), jobs: [] }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.TOMP3_DEV_URL;
const packaged = process.argv.includes('--packaged');
const executablePath = packaged ? path.join(root, 'release/mac-arm64/toMP3.app/Contents/MacOS/toMP3') : require('electron');
const launchOptions = { executablePath, args: [...(packaged ? [] : [root]), `--user-data-dir=${path.join(work, 'profile')}`], cwd: root, env };
let app = await electron.launch(launchOptions);
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', { name: 'Tu próximo play.' }).waitFor();
  await page.waitForFunction(() => !!window.tomp3);
  const state = await page.evaluate(() => window.tomp3.getState());
  assert.equal(state.toolsReady, true);
  assert.equal(state.destination, path.join(work, 'downloads'));
  await page.screenshot({ path: path.join(work, 'inicio.png') });
  await page.getByLabel('Enlace del video').fill(testUrl);
  await page.getByRole('button', { name: 'Analizar enlace' }).click();
  await page.locator('.video-preview h3').waitFor({ timeout: 100000 });
  if (facebook) assert.equal((await page.locator('.source-badge').textContent()).trim(), 'fFacebook Reels');
  await page.screenshot({ path: path.join(work, 'vista-previa.png') });
  await page.getByRole('button', { name: 'Descargar MP3' }).click();
  async function waitForJobs(predicate) {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      const current = await page.evaluate(() => window.tomp3.getState());
      if (predicate(current.jobs)) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('La descarga no terminó en el tiempo esperado.');
  }
  await waitForJobs(jobs => jobs.some(j => ['completed', 'error'].includes(j.status)));
  let finished = await page.evaluate(() => window.tomp3.getState());
  assert.equal(finished.jobs[0].status, 'completed', finished.jobs[0].error);
  assert.match(finished.jobs[0].filePath, /\.mp3$/);
  assert.ok((await readFile(finished.jobs[0].filePath)).length > 1000);
  await page.getByRole('button', { name: /Video \+ audio/ }).click();
  await page.getByLabel('Enlace del video').fill(testUrl);
  await page.getByRole('button', { name: 'Analizar enlace' }).click();
  await page.locator('.video-preview').waitFor({ timeout: 100000 });
  if (facebook) assert.equal(await page.getByLabel('Calidad de video').inputValue(), 'original');
  await page.getByRole('button', { name: 'Descargar MP4' }).click();
  await waitForJobs(jobs => jobs.length === 2 && jobs.every(j => ['completed', 'error'].includes(j.status)));
  finished = await page.evaluate(() => window.tomp3.getState());
  assert.equal(finished.jobs[0].status, 'completed', finished.jobs[0].error);
  assert.match(finished.jobs[0].filePath, /\.mp4$/);
  if (facebook) assert.equal(finished.jobs[0].source, 'facebook');
  assert.ok((await readFile(finished.jobs[0].filePath)).length > 1000);
  await page.getByRole('button', { name: 'Historial', exact: false }).first().click();
  await page.getByRole('heading', { name: 'Tus descargas.' }).waitFor();
  await page.screenshot({ path: path.join(work, 'historial.png') });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('heading', { name: 'Un lugar para tus archivos' }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  for (const job of finished.jobs) {
    const probe = JSON.parse(execFileSync(path.join(root, 'resources/bin/ffprobe'), ['-v', 'quiet', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', job.filePath], { encoding: 'utf8' }));
    assert.ok(Number(probe.format.duration) > 1);
    assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(probe.streams.some(stream => stream.codec_type === 'video'), job.format === 'mp4');
  }
  await app.close();
  app = await electron.launch(launchOptions);
  const reopened = await app.firstWindow();
  await reopened.getByRole('heading', { name: 'Tu próximo play.' }).waitFor();
  const recovered = await reopened.evaluate(() => window.tomp3.getState());
  assert.equal(recovered.jobs.filter(j => j.status === 'completed').length, 2);
  assert.equal(recovered.destination, path.join(work, 'downloads'));
  await reopened.screenshot({ path: path.join(work, 'resultado.png') });
  await writeFile(path.join(work, 'result.json'), JSON.stringify({ testedAt: new Date().toISOString(), source: facebook ? 'facebook' : 'youtube', testUrl, jobs: finished.jobs.map(j => ({ format: j.format, status: j.status, filePath: j.filePath })), errors }, null, 2));
  console.log(`Electron${packaged ? ' empaquetado' : ''}: MP3 y MP4 reales, pistas multimedia, historial, preferencias y recuperación tras reinicio verificados.`);
} finally { await app.close(); }
