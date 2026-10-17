const path = require('node:path');
const { existsSync } = require('node:fs');

function ytDlpDistribution(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return { asset: 'yt-dlp_macos.zip', executable: 'yt-dlp_macos', unpacked: true };
  if (platform === 'win32') {
    const suffix = arch === 'arm64' ? '_arm64' : arch === 'ia32' ? '_x86' : '';
    return { asset: `yt-dlp_win${suffix}.zip`, executable: `yt-dlp${suffix}.exe`, unpacked: true };
  }
  if (platform === 'linux') return { asset: arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux', executable: 'yt-dlp', unpacked: false };
  throw new Error('Sistema operativo no compatible.');
}

function ytDlpPath(bin, platform = process.platform, arch = process.arch) {
  const distribution = ytDlpDistribution(platform, arch);
  const runtime = path.join(bin, 'yt-dlp-runtime');
  const executable = path.join(runtime, distribution.executable);
  if (existsSync(executable) && (!distribution.unpacked || existsSync(path.join(runtime, '_internal')))) return executable;
  // Existing development copies keep working until tools:setup migrates them.
  return path.join(bin, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

module.exports = { ytDlpDistribution, ytDlpPath };
