const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { ytDlpDistribution, ytDlpPath } = require('../shared/tools.cjs');

async function fixture(t) {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'tomp3-ytdlp-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  const { prepareYtDlp } = await import('../scripts/prepare-ytdlp.mjs');
  const platform = process.platform === 'linux' ? 'darwin' : process.platform;
  const distribution = ytDlpDistribution(platform);
  const data = Buffer.from('verified archive fixture');
  const hash = createHash('sha256').update(data).digest('hex');
  const fetchRelease = async (url, options) => {
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify({ tag_name: 'test-version', assets: [
      { name: distribution.asset, browser_download_url: 'https://github.com/official.zip' },
      { name: 'SHA2-256SUMS', browser_download_url: 'https://github.com/checksums' },
    ] }));
    assert.equal(options.headers, undefined, 'Las descargas no reciben las credenciales de la API');
    return new Response(url.endsWith('official.zip') ? data : `${hash}  ${distribution.asset}\n`);
  };
  const extractArchive = async (_archive, { dir }) => {
    await fs.mkdir(path.join(dir, '_internal'));
    await fs.copyFile(process.execPath, path.join(dir, distribution.executable));
  };
  return { bin, platform, prepareYtDlp, fetchRelease, extractArchive, distribution };
}

test('las distribuciones de Mac y Windows incluyen su entorno junto al ejecutable', () => {
  assert.equal(ytDlpDistribution('darwin', 'arm64').asset, 'yt-dlp_macos.zip');
  assert.equal(ytDlpDistribution('win32', 'x64').asset, 'yt-dlp_win.zip');
  assert.equal(ytDlpDistribution('win32', 'arm64').executable, 'yt-dlp_arm64.exe');
  assert.equal(ytDlpDistribution('win32', 'ia32').asset, 'yt-dlp_win_x86.zip');
});
test('prepara un entorno verificado y lo reutiliza sin conexión', async t => {
  const options = await fixture(t);
  const { bin, platform, prepareYtDlp } = options;
  const legacy = path.join(bin, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  await fs.writeFile(legacy, 'legacy');
  assert.equal(ytDlpPath(bin, platform), legacy);
  const result = await prepareYtDlp(options);
  assert.equal(result.reused, false);
  assert.equal(ytDlpPath(bin, platform), result.executable);
  await assert.rejects(fs.access(legacy));
  const reused = await prepareYtDlp({ ...options, fetchRelease: () => assert.fail('Un entorno válido no se descarga otra vez') });
  assert.equal(reused.reused, true);
  assert.ok(!(await fs.readdir(bin)).some(name => name.startsWith('.yt-dlp-')));
});
test('rechaza una descarga alterada antes de extraerla o ejecutarla', async t => {
  const options = await fixture(t);
  const fetchRelease = async (url, config) => url.endsWith('official.zip') ? new Response('altered') : options.fetchRelease(url, config);
  await assert.rejects(options.prepareYtDlp({ ...options, fetchRelease,
    extractArchive: () => assert.fail('No se debe extraer una descarga sin verificar'),
    verify: () => assert.fail('No se debe ejecutar una descarga sin verificar'),
  }), /verificación/);
  assert.deepEqual(await fs.readdir(options.bin), []);
});
test('una actualización incompleta conserva el motor anterior y limpia sus temporales', async t => {
  const options = await fixture(t);
  const { bin, platform, prepareYtDlp } = options;
  const result = await prepareYtDlp(options);
  const manifest = await fs.readFile(path.join(bin, 'manifest.json'), 'utf8');
  await assert.rejects(prepareYtDlp({ ...options, update: true, extractArchive: async () => {} }), /ENOENT/);
  assert.equal(await fs.readFile(path.join(bin, 'manifest.json'), 'utf8'), manifest);
  assert.equal(ytDlpPath(bin, platform), result.executable);
  assert.equal((await prepareYtDlp({ ...options, fetchRelease: () => assert.fail('El motor anterior sigue siendo válido') })).reused, true);
  assert.ok(!(await fs.readdir(bin)).some(name => name.startsWith('.yt-dlp-')));
});
