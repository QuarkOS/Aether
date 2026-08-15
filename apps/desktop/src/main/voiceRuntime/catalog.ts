/** Pinned Windows voice-runtime downloads (embeddable CPython + ffmpeg). */

export const PYTHON_VERSION = "3.11.9";
export const PYTHON_ZIP_URL =
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
export const PYTHON_ZIP_MIN_BYTES = 8_000_000;
export const PYTHON_EXE = "python.exe";

/** gyan.dev essentials build (static). */
export const FFMPEG_ZIP_URL =
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
export const FFMPEG_ZIP_MIN_BYTES = 50_000_000;
export const FFMPEG_EXE = "ffmpeg.exe";
