import { createRequire } from 'node:module';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareBinary } from './prepare-binary.mjs';
import { prepareYtDlp } from './prepare-ytdlp.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'resources/bin');
const win = process.platform === 'win32';
const suffix = win ? '.exe' : '';
await mkdir(bin, { recursive: true });
await prepareYtDlp({ bin, update: process.argv.includes('--update') });
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
for (const extension of ['README', 'LICENSE']) {
  try { await copyFile(`${require('ffmpeg-static')}.${extension}`, path.join(bin, `ffmpeg-binary.${extension}`)); } catch {}
}
await copyFile(require.resolve('ffmpeg-static/README.md'), path.join(bin, 'ffmpeg-package-README.md'));
await copyFile(require.resolve(`@ffprobe-installer/${process.platform}-${process.arch}/package.json`), path.join(bin, 'ffprobe-package.json'));
await copyFile(path.join(root, 'resources/THIRD_PARTY.md'), path.join(bin, 'THIRD_PARTY.md'));
await rm(path.join(bin, 'ffprobe-LICENSE'), { force: true });
console.log(`Herramientas listas para ${process.platform}/${process.arch}.`);
