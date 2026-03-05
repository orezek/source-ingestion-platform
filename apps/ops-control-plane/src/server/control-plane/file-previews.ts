import { readFile } from 'node:fs/promises';

export type ControlPlaneFilePreview = {
  path: string;
  contents: string | null;
  exists: boolean;
  truncated: boolean;
  sizeBytes: number | null;
};

export async function readTextPreview(
  filePath: string,
  maxChars = 16_000,
): Promise<ControlPlaneFilePreview> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const truncated = raw.length > maxChars;
    return {
      path: filePath,
      contents: truncated ? `${raw.slice(0, maxChars)}\n...truncated...` : raw,
      exists: true,
      truncated,
      sizeBytes: Buffer.byteLength(raw, 'utf8'),
    };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {
        path: filePath,
        contents: null,
        exists: false,
        truncated: false,
        sizeBytes: null,
      };
    }

    throw error;
  }
}

export async function readOptionalTextPreview(
  filePath: string | undefined,
  maxChars?: number,
): Promise<ControlPlaneFilePreview | null> {
  if (!filePath) {
    return null;
  }

  return readTextPreview(filePath, maxChars);
}
