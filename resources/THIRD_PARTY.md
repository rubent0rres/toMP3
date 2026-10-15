# Multimedia tools

The bundled binaries are prepared by `scripts/setup-tools.mjs` for the host OS and architecture. They run as separate programs. Their notices are included alongside them in the application's `Resources/bin` (macOS) or `resources/bin` (Windows) directory.

- yt-dlp: https://github.com/yt-dlp/yt-dlp — the exact release and SHA-256 are recorded in bin/manifest.json.
- FFmpeg: https://github.com/eugeneware/ffmpeg-static — the package README identifies the binary producers, release and source locations. The package license and the binary-specific README/LICENSE, when supplied by the distributor, accompany the executable. Source distributions: https://ffmpeg.org/releases/; Windows builds: https://www.gyan.dev/ffmpeg/builds/; Mac Intel builds: https://evermeet.cx/ffmpeg/; Mac Apple Silicon builds: https://osxexperts.net/.
- FFprobe: https://github.com/SavageCore/node-ffprobe-installer — the installer README and platform package metadata identify its version, source location and license. FFmpeg/FFprobe source: https://ffmpeg.org/releases/.

Run `ffmpeg -version` and `ffprobe -version` to inspect the bundled build configuration. These tools retain their respective licenses; they are not authored by toMP3.
