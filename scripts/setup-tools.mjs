import { createRequire } from 'node:module';
import { mkdir, copyFile, chmod, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareBinary } from './prepare-binary.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'resources/bin');
const win = process.platform === 'win32';
const suffix = win ? '.exe' : '';
const assets = { darwin: 'yt-dlp_macos', win32: process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe', linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux' };
if (!assets[process.platform]) throw new Error('Sistema operativo no compatible.');
await mkdir(bin, { recursive: true });
const manifestPath = path.join(bin, 'manifest.json');
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch {}
const target = path.join(bin, `yt-dlp${suffix}`);
let valid = false;
if (manifest?.platform === process.platform && manifest?.arch === process.arch && !process.argv.includes('--update')) {
  try { valid = createHash('sha256').update(await readFile(target)).digest('hex') === manifest.sha256; } catch {}
}
if (!valid) {
  console.log('Preparando yt-dlp desde su distribución oficial…');
  const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': 'toMP3-setup' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`No se pudo consultar yt-dlp (${res.status}).`);
  const release = await res.json();
  const asset = release.assets.find(a => a.name === assets[process.platform]);
  const checksums = release.assets.find(a => a.name === 'SHA2-256SUMS');
  if (!asset || !checksums) throw new Error('No se encontró la distribución oficial.');
  const [binaryRes, hashRes] = await Promise.all([fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180000) }), fetch(checksums.browser_download_url, { signal: AbortSignal.timeout(30000) })]);
  if (!binaryRes.ok || !hashRes.ok) throw new Error('No se pudieron descargar las herramientas.');
  const data = Buffer.from(await binaryRes.arrayBuffer());
  const line = (await hashRes.text()).split('\n').find(line => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === asset.name);
  const expected = line?.trim().split(/\s+/)[0];
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (!expected || sha256 !== expected) throw new Error('La verificación de yt-dlp no coincide.');
  await writeFile(`${target}.tmp`, data);
  await chmod(`${target}.tmp`, 0o755);
  await rename(`${target}.tmp`, target);
  await writeFile(manifestPath, JSON.stringify({ version: release.tag_name, sha256, platform: process.platform, arch: process.arch }, null, 2));
}
const execute = promisify(execFile);
for (const [name, source] of [['ffmpeg', require('ffmpeg-static')], ['ffprobe', require('@ffprobe-installer/ffprobe').path]]) {
  await prepareBinary({
    name: name === 'ffmpeg' ? 'FFmpeg' : 'FFprobe', source,
    destination: path.join(bin, `${name}${suffix}`),
    installSource: name === 'ffmpeg' ? async () => {
      console.log('Descargando FFmpeg para este equipo…');
      await execute(process.execPath, [require.resolve('ffmpeg-static/install.js')], {
        cwd: root, env: process.env, timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024,
      });
    } : undefined,
  });
}
// License notices travel with the packaged tools.
for (const [name, source] of [['ffmpeg', 'ffmpeg-static/LICENSE'], ['ffprobe-NOTICE', '@ffprobe-installer/ffprobe/README.md']]) {
  try { await copyFile(require.resolve(source), path.join(bin, name.endsWith('-NOTICE') ? `${name}.md` : `${name}-LICENSE`)); } catch {}
}
await copyFile(path.join(root, 'resources/THIRD_PARTY.md'), path.join(bin, 'THIRD_PARTY.md'));
await rm(path.join(bin, 'ffprobe-LICENSE'), { force: true });
await rm(`${target}.tmp`, { force: true });
console.log(`Herramientas listas para ${process.platform}/${process.arch}.`);
