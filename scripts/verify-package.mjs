import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const win = process.platform === 'win32';
const suffix = win ? '.exe' : '';
const appRoot = path.join(root, 'release', win ? 'win-unpacked' : process.arch === 'arm64' ? 'mac-arm64' : 'mac');
const executablePath = win ? path.join(appRoot, 'toMP3.exe') : path.join(appRoot, 'toMP3.app/Contents/MacOS/toMP3');
const bin = win ? path.join(appRoot, 'resources/bin') : path.join(appRoot, 'toMP3.app/Contents/Resources/bin');
const work = path.join(root, 'work/package-check');
const profile = path.join(work, 'profile');
const downloads = path.join(work, 'Downloads', 'toMP3');
await mkdir(profile, { recursive: true });
await mkdir(downloads, { recursive: true });
await writeFile(path.join(profile, 'downloads.json'), JSON.stringify({ destination: downloads, jobs: [] }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.TOMP3_DEV_URL;
const versions = {};
for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
  const { stdout } = await execute(path.join(bin, `${name}${suffix}`), [name === 'yt-dlp' ? '--version' : '-version'], { timeout: 30000, windowsHide: true });
  versions[name] = stdout.split(/\r?\n/)[0];
}
const ffmpeg = path.join(bin, `ffmpeg${suffix}`);
const ffprobe = path.join(bin, `ffprobe${suffix}`);
const run = (file, args) => execute(file, args, { timeout: 60000, windowsHide: true });
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(work, 'audio.mp3')]);
await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(work, 'video.mp4')]);
for (const [file, video] of [['audio.mp3', false], ['video.mp4', true]]) {
  const { stdout } = await run(ffprobe, ['-v', 'quiet', '-show_entries', 'stream=codec_type', '-of', 'json', path.join(work, file)]);
  const streams = JSON.parse(stdout).streams;
  assert.ok(streams.some(stream => stream.codec_type === 'audio'));
  assert.equal(streams.some(stream => stream.codec_type === 'video'), video);
}
const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], cwd: root, env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'Tu próximo play.' }).waitFor();
  assert.equal((await page.locator('.brand').innerText()).trim(), 'toMP3');
  const state = await page.evaluate(() => window.tomp3.getState());
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(state.version, version);
  assert.equal(state.platform, process.platform);
  assert.equal(state.toolsReady, true);
  assert.equal(state.destination, downloads);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isClosable()), true);
  await page.screenshot({ path: path.join(work, 'inicio.png') });
  await page.getByRole('button', { name: 'Acerca de', exact: true }).click();
  await page.getByRole('heading', { name: 'toMP3', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'dev@rubentorres.com.mx' }).getAttribute('href'), 'mailto:dev@rubentorres.com.mx');
  assert.deepEqual(errors, []);
  await writeFile(path.join(work, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version, versions, conversions: ['MP3', 'MP4'], errors }, null, 2));
  console.log(`Paquete verificado: ${process.platform}/${process.arch}, apertura, herramientas y conversión MP3/MP4.`);
} finally {
  await app.close();
}
