const { spawn } = require('node:child_process');
const path = require('node:path');

function videoCompatible(stream) {
  return stream?.codec_name === 'h264' && stream.pix_fmt === 'yuv420p' && ['Constrained Baseline', 'Baseline', 'Main', 'High'].includes(stream.profile);
}
function audioCompatible(stream) {
  return stream?.codec_name === 'aac' && stream.profile === 'LC';
}
function tracks(info) {
  const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = info.streams?.find(stream => stream.codec_type === 'audio');
  if (!video || !audio || ![video.index, audio.index].every(index => Number.isInteger(index) && index >= 0) || !(Number(info.format?.duration) > 0)) {
    throw new Error('El archivo no contiene pistas de video y audio válidas. Vuelve a descargarlo.');
  }
  return { video, audio };
}
function kill(child) {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); return; } catch {}
  }
  child.kill('SIGKILL');
}

async function prepareMp4({ input, ffmpegDir, spawnProcess = spawn, onProcess = () => {}, isCancelled = () => false, killProcess = kill }) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  function run(name, args, json = false) {
    if (isCancelled()) throw new Error('Preparación cancelada.');
    return new Promise((resolve, reject) => {
      const child = spawnProcess(path.join(ffmpegDir, `${name}${suffix}`), args, { shell: false, windowsHide: true, detached: process.platform !== 'win32' });
      let stdout = '', stderr = '', failure, timer;
      const reset = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { failure = new Error('La preparación del video dejó de responder. Vuelve a intentarlo.'); killProcess(child); }, json ? 30000 : 1800000);
      };
      reset();
      child.stdout.on('data', data => {
        reset();
        if (json) {
          stdout += data;
          if (stdout.length > 2_000_000) { failure = new Error('No se pudo leer la información del archivo de video.'); killProcess(child); }
        }
      });
      child.stderr.on('data', data => { reset(); stderr = (stderr + data).slice(-3000); });
      child.once('error', error => { clearTimeout(timer); reject(new Error(`No se pudo iniciar ${name}: ${error.message}`)); });
      child.once('close', code => {
        clearTimeout(timer);
        if (isCancelled()) return reject(new Error('Preparación cancelada.'));
        if (failure) return reject(failure);
        if (code !== 0) return reject(new Error(`No se pudo preparar el video para reproducirlo. ${stderr.trim()}`));
        try { resolve(json ? JSON.parse(stdout) : undefined); }
        catch { reject(new Error('No se pudo verificar el archivo de video.')); }
      });
      onProcess(child);
      if (isCancelled()) killProcess(child);
    });
  }
  const probe = file => run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,profile,pix_fmt:stream_disposition=attached_pic', '-of', 'json', file], true);
  const { video, audio } = tracks(await probe(input));
  const output = path.join(path.dirname(input), '.compatible.mp4');
  if (path.resolve(input) === path.resolve(output)) throw new Error('El archivo de entrada y salida deben ser distintos.');
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-n', '-i', input, '-map', `0:${video.index}`, '-map', `0:${audio.index}`, '-sn', '-dn'];
  if (videoCompatible(video)) args.push('-c:v', 'copy');
  else args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2');
  if (audioCompatible(audio)) args.push('-c:a', 'copy');
  else args.push('-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ac', '2', '-ar', '48000');
  args.push('-tag:v', 'avc1', '-movflags', '+faststart', output);
  await run('ffmpeg', args);
  const prepared = tracks(await probe(output));
  if (!videoCompatible(prepared.video) || !audioCompatible(prepared.audio)) throw new Error('El video no quedó en un formato compatible. Vuelve a intentarlo.');
  return output;
}

module.exports = { prepareMp4 };
