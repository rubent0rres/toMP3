import { mkdir, mkdtemp, readFile, writeFile, chmod, rename, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { extract } from '@electron-internal/extract-zip';
import path from 'node:path';
import tools from '../shared/tools.cjs';

const execute = promisify(execFile);
const digest = data => createHash('sha256').update(data).digest('hex');
const verifyExecutable = file => execute(file, ['--version'], { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });

export async function prepareYtDlp({ bin, platform = process.platform, arch = process.arch, update = false, fetchRelease = fetch, extractArchive = extract, verify = verifyExecutable }) {
  const distribution = tools.ytDlpDistribution(platform, arch);
  const runtime = path.join(bin, 'yt-dlp-runtime');
  const target = path.join(runtime, distribution.executable);
  const manifestPath = path.join(bin, 'manifest.json');
  const validRuntime = async directory => {
    if (distribution.unpacked && !(await stat(path.join(directory, '_internal'))).isDirectory()) throw new Error('Falta el entorno de yt-dlp.');
    await verify(path.join(directory, distribution.executable));
  };
  await mkdir(bin, { recursive: true });
  if (!update) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.layout === 2 && manifest.platform === platform && manifest.arch === arch && manifest.asset === distribution.asset && digest(await readFile(target)) === manifest.sha256) {
        await validRuntime(runtime);
        return { reused: true, executable: target };
      }
    } catch {}
  }
  console.log('Preparando yt-dlp desde su distribución oficial…');
  const headers = { 'User-Agent': 'toMP3-setup' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetchRelease('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`No se pudo consultar yt-dlp (${response.status}).`);
  const release = await response.json();
  const asset = release.assets.find(asset => asset.name === distribution.asset);
  const checksums = release.assets.find(asset => asset.name === 'SHA2-256SUMS');
  if (!asset || !checksums) throw new Error('No se encontró la distribución oficial.');
  const [binaryResponse, hashResponse] = await Promise.all([
    fetchRelease(asset.browser_download_url, { signal: AbortSignal.timeout(180000) }),
    fetchRelease(checksums.browser_download_url, { signal: AbortSignal.timeout(30000) }),
  ]);
  if (!binaryResponse.ok || !hashResponse.ok) throw new Error('No se pudieron descargar las herramientas.');
  const data = Buffer.from(await binaryResponse.arrayBuffer());
  const line = (await hashResponse.text()).split('\n').find(line => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === asset.name);
  const expected = line?.trim().split(/\s+/)[0];
  const archiveSha256 = digest(data);
  if (!expected || archiveSha256 !== expected) throw new Error('La verificación de yt-dlp no coincide.');

  const temporary = await mkdtemp(path.join(bin, '.yt-dlp-'));
  const staged = path.join(temporary, 'runtime');
  const previous = path.join(temporary, 'previous');
  let backedUp = false, installed = false;
  try {
    await mkdir(staged);
    if (distribution.unpacked) {
      const archive = path.join(temporary, 'official.zip');
      await writeFile(archive, data);
      await extractArchive(archive, { dir: staged });
    } else await writeFile(path.join(staged, distribution.executable), data);
    const executable = path.join(staged, distribution.executable);
    if (platform !== 'win32') await chmod(executable, 0o755);
    await validRuntime(staged);
    const manifest = { layout: 2, version: release.tag_name, asset: asset.name, archiveSha256, sha256: digest(await readFile(executable)), platform, arch };
    const pendingManifest = path.join(temporary, 'manifest.json');
    await writeFile(pendingManifest, JSON.stringify(manifest, null, 2));
    try { await rename(runtime, previous); backedUp = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staged, runtime);
    installed = true;
    await rename(pendingManifest, manifestPath);
  } catch (error) {
    if (installed) await rm(runtime, { recursive: true, force: true });
    if (backedUp) await rename(previous, runtime);
    throw error;
  } finally { await rm(temporary, { recursive: true, force: true }); }
  await rm(path.join(bin, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), { force: true });
  return { reused: false, executable: target };
}
