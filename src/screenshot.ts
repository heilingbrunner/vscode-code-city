/** Largest screenshot payload (decoded) the extension host accepts from the webview. */
export const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Validate and decode a base64 PNG sent by the webview.
 * Returns undefined for anything that is not a plausible, size-capped PNG.
 */
export function decodeScreenshot(data: unknown, maxBytes = MAX_SCREENSHOT_BYTES): Uint8Array | undefined {
  if (typeof data !== 'string' || data.length === 0) return undefined;
  if (data.length > Math.ceil(maxBytes / 3) * 4) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes || bytes.length < PNG_SIGNATURE.length) return undefined;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b) ? new Uint8Array(bytes) : undefined;
}
