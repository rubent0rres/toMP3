const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const { prepareMp4 } = require('../electron/media.cjs');
const compatible = { format: { duration: '1' }, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p' }, { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC' }] };
function fixture(initial, prepared = compatible) {
  const calls = [];
  let probes = 0;
  const spawnProcess = (file, args, options) => {
    assert.equal(options.shell, false);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    calls.push({ file, args, child });
    setImmediate(() => {
      if (path.basename(file).startsWith('ffprobe')) child.stdout.write(JSON.stringify(probes++ ? prepared : initial));
      child.emit('close', 0);
    });
    return child;
  };
  return { calls, options: { input: path.resolve('Video con espacios.mp4'), ffmpegDir: path.resolve('tools'), spawnProcess } };
}
test('rechaza un archivo que no tiene video y audio antes de convertirlo', async () => {
  const { options, calls } = fixture({ ...compatible, streams: compatible.streams.slice(0, 1) });
  await assert.rejects(prepareMp4(options), /pistas de video y audio válidas/);
  assert.equal(calls.length, 1);
});
test('convierte AV1 y Opus y vuelve a verificar las pistas antes de entregar el MP4', async () => {
  const { options, calls } = fixture({ ...compatible, streams: [{ index: 0, codec_type: 'video', codec_name: 'av1', pix_fmt: 'yuv420p' }, { index: 1, codec_type: 'audio', codec_name: 'opus' }] });
  const output = await prepareMp4(options);
  assert.equal(calls.length, 3);
  assert.ok(calls[1].args.includes('libx264'));
  assert.ok(calls[1].args.includes('aac_low'));
  assert.equal(calls[2].args.at(-1), output);
  assert.notEqual(output, options.input);
});
test('conserva las pistas H.264 y AAC compatibles sin volver a comprimirlas', async () => {
  const { options, calls } = fixture(compatible);
  await prepareMp4(options);
  assert.equal(calls[1].args[calls[1].args.indexOf('-c:v') + 1], 'copy');
  assert.equal(calls[1].args[calls[1].args.indexOf('-c:a') + 1], 'copy');
});
test('rechaza una preparación cuyo resultado sigue teniendo un códec incompatible', async () => {
  const invalid = { ...compatible, streams: [{ ...compatible.streams[0], codec_name: 'av1' }, compatible.streams[1]] };
  const { options } = fixture(compatible, invalid);
  await assert.rejects(prepareMp4(options), /no quedó en un formato compatible/);
});
test('una preparación ya cancelada no inicia herramientas', async () => {
  const { options, calls } = fixture(compatible);
  await assert.rejects(prepareMp4({ ...options, isCancelled: () => true }), /cancelada/);
  assert.equal(calls.length, 0);
});
test('cancelar detiene el conversor activo y evita la verificación final', async () => {
  const { options, calls } = fixture(compatible);
  let cancelled = false, killed;
  await assert.rejects(prepareMp4({
    ...options, isCancelled: () => cancelled,
    onProcess: () => { if (calls.length === 2) cancelled = true; },
    killProcess: child => { killed = child; child.emit('close', 137); },
  }), /cancelada/);
  assert.equal(killed, calls[1].child);
  assert.equal(calls.length, 2);
});
