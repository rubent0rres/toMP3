import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function run(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env });
  children.add(child);
  child.on('exit', code => { children.delete(child); stop(code ?? 0); });
  child.on('error', error => { console.error(error.message); stop(1); });
  return child;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const setup = spawn(process.execPath, ['scripts/setup-tools.mjs'], { cwd: root, stdio: 'inherit' });
children.add(setup);
const code = await new Promise(resolve => { setup.on('exit', resolve); setup.on('error', () => resolve(1)); });
children.delete(setup);
if (closing) process.exit(0);
if (code !== 0) process.exit(1);
const url = 'http://127.0.0.1:3210';
// Refuse an occupied port instead of attaching Electron to an unrelated server.
const { createServer } = await import('node:net');
await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(3210, '127.0.0.1', () => probe.close(resolve)); });
run(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3210']);
let ready = false;
for (let i = 0; i < 120 && !closing; i++) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (res.ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) stop(1);
else {
  const env = { ...process.env, TOMP3_DEV_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  run(require('electron'), ['.'], env);
}
