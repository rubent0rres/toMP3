import { copyFile, chmod, access, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function prepareBinary({ name, source, destination, installSource, versionArgs = ['-version'] }) {
  const verify = file => execute(file, versionArgs, { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 });
  // A valid local tool survives dependency reinstalls that omit lifecycle scripts.
  try { await verify(destination); return { reused: true }; } catch {}
  if (!source) throw new Error(`${name} no está disponible para este sistema y arquitectura.`);
  try { await access(source); } catch {
    if (!installSource) throw new Error(`Falta ${name}. Vuelve a instalar las dependencias e inténtalo de nuevo.`);
    try { await installSource(); } catch (error) {
      throw new Error(`No se pudo descargar ${name}. Revisa tu conexión y vuelve a ejecutar npm run tools:setup. ${error.message}`, { cause: error });
    }
  }
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await copyFile(source, temporary);
    if (process.platform !== 'win32') await chmod(temporary, 0o755);
    await verify(temporary);
    await rename(temporary, destination);
    return { reused: false };
  } catch (error) {
    throw new Error(`No se pudo preparar ${name} para ${process.platform}/${process.arch}: ${error.message}`, { cause: error });
  } finally { await rm(temporary, { force: true }); }
}
