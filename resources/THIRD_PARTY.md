# Multimedia tools

The local binaries are prepared by `scripts/setup-tools.mjs` for the host OS and architecture.

- yt-dlp: https://github.com/yt-dlp/yt-dlp — the exact release and SHA-256 are recorded in bin/manifest.json.
- FFmpeg: https://github.com/eugeneware/ffmpeg-static — see the installed package README and LICENSE and inspect ffmpeg -version for its build configuration.
- FFprobe: https://github.com/SavageCore/node-ffprobe-installer — see the platform package's README and package.json.

These tools are bundled for local development. Review the actual binary build licenses, associated source and redistribution terms before publicly distributing an installer.
