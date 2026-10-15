const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const suffix = process.platform === 'win32' ? '.exe' : '';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tomp3-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { prepareBinary } = await import('../scripts/prepare-binary.mjs');
  return { root, prepareBinary };
}
test('reutiliza la herramienta local aunque falte el ejecutable de la dependencia', async t => {
  const { root, prepareBinary } = await fixture(t);
  const destination = path.join(root, `local-tool${suffix}`);
  await fs.copyFile(process.execPath, destination);
  const result = await prepareBinary({ name: 'FFmpeg', source: path.join(root, 'missing-package-binary'), destination, versionArgs: ['--version'], installSource: () => assert.fail('No debe descargar una herramienta local válida') });
  assert.equal(result.reused, true);
  assert.match(execFileSync(destination, ['--version'], { encoding: 'utf8' }), /^v\d+/);
});
test('recupera la dependencia cuando faltan ambas copias y valida antes de publicarla', async t => {
  const { root, prepareBinary } = await fixture(t);
  const source = path.join(root, `package-tool${suffix}`), destination = path.join(root, `local-tool${suffix}`);
  let installs = 0;
  await prepareBinary({ name: 'FFmpeg', source, destination, versionArgs: ['--version'], installSource: async () => { installs++; await fs.copyFile(process.execPath, source); } });
  assert.equal(installs, 1);
  assert.match(execFileSync(destination, ['--version'], { encoding: 'utf8' }), /^v\d+/);
  assert.ok(!(await fs.readdir(root)).some(name => name.includes('.tmp')));
});
test('una descarga fallida da un error útil y no deja una herramienta incompleta', async t => {
  const { root, prepareBinary } = await fixture(t);
  const destination = path.join(root, `local-tool${suffix}`);
  await assert.rejects(prepareBinary({ name: 'FFmpeg', source: path.join(root, 'missing-package-binary'), destination, installSource: async () => { throw new Error('Sin conexión'); } }), /No se pudo descargar FFmpeg.*tools:setup/);
  await assert.rejects(fs.access(destination));
});
