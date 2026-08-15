/** Pinned Windows voice-runtime downloads (embeddable CPython + ffmpeg). */

export const PYTHON_VERSION = "3.11.9";
export const PYTHON_ZIP_URL =
  `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
export const PYTHON_ZIP_MIN_BYTES = 8_000_000;
export const PYTHON_EXE = "python.exe";

/**
 * RVC needs fairseq/hydra which break on CPython 3.11+ dataclasses.
 * Official nuget.org portable build includes Python.h (no MSI).
 */
export const PYTHON_RVC_VERSION = "3.10.11";
export const PYTHON_NUGET_URL =
  `https://globalcdn.nuget.org/packages/python.${PYTHON_RVC_VERSION}.nupkg`;
export const PYTHON_NUGET_MIN_BYTES = 10_000_000;

/** gyan.dev essentials build (static). */
export const FFMPEG_ZIP_URL =
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
export const FFMPEG_ZIP_MIN_BYTES = 50_000_000;
export const FFMPEG_EXE = "ffmpeg.exe";
