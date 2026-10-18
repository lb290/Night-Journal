import sharp from "sharp";
import convertHeic from "heic-convert";

/**
 * Image post-processing for uploaded photos.
 *
 * Phone cameras produce 3–12 MB files (a OnePlus 13 shot is 3072×4096 / 8.8 MB).
 * Keeping those on disk wastes space, but the bigger cost is downstream: the
 * vision model receives the whole image as base64 (≈+33% size), and the diary
 * list renders 48×48 thumbnails from the full-resolution file.
 *
 * So every upload is normalised into two derived files:
 *
 *   <uid>/<name>.jpg        long edge ≤ 1600 px, EXIF stripped, progressive
 *   <uid>/thumb/<name>.jpg  400 px box, for lists and previews
 *
 * EXIF is stripped deliberately — phone photos carry GPS coordinates, and there
 * is no reason for a personal diary app to retain them.
 */

/** Long edge of the stored image. 1600 px keeps text legible when zoomed. */
export const MAX_IMAGE_DIMENSION = 1600;

/** JPEG quality for the stored image. */
const MAIN_QUALITY = 80;

/** Box size for list/preview thumbnails. */
export const THUMBNAIL_DIMENSION = 400;

/** JPEG quality for thumbnails. */
const THUMB_QUALITY = 75;

/**
 * Formats that browsers decode natively but sharp may not, and that therefore
 * need a decode fallback before sharp can touch them.
 */
const HEIF_EXTENSIONS = new Set([".heic", ".heif"]);

export interface ProcessedImage {
  /** Compressed full-size JPEG bytes. */
  main: Buffer;
  /** Compressed thumbnail JPEG bytes. */
  thumbnail: Buffer;
  /** Pixel size of the stored image, useful for logging/debugging. */
  width: number;
  height: number;
}

export function isHeifFile(fileName: string, mimeType?: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (HEIF_EXTENSIONS.has(ext)) return true;
  const mime = (mimeType ?? "").toLowerCase();
  return mime === "image/heic" || mime === "image/heif";
}

/**
 * Decode HEIC/HEIF to JPEG bytes.
 *
 * sharp's bundled libheif ships the AVIF decoder only, so HEVC-encoded HEIC
 * (what iPhones and modern Android phones produce) fails with a "bad seek"
 * error. heic-convert carries a WASM libheif that handles HEVC, at the cost of
 * being noticeably slower (~1.8 s for a 12 MP image).
 */
async function decodeHeifToJpeg(buffer: Buffer): Promise<Buffer> {
  const jpeg = await convertHeic({
    buffer,
    format: "JPEG",
    quality: 0.92,
  });
  return Buffer.from(jpeg);
}

/**
 * Normalise an uploaded image: rotate by EXIF orientation, downscale to
 * `MAX_IMAGE_DIMENSION`, strip metadata, and produce a thumbnail.
 *
 * Returns null when the input cannot be decoded (corrupt file, unsupported
 * codec). Callers fall back to storing the original bytes so a weird image
 * never blocks a diary entry.
 */
export async function processImage(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ProcessedImage | null> {
  let source = buffer;

  if (isHeifFile(fileName, mimeType)) {
    try {
      source = await decodeHeifToJpeg(buffer);
    } catch (err) {
      console.error("[image] HEIC decode failed:", err);
      return null;
    }
  }

  try {
    // `rotate()` with no argument applies the EXIF orientation, then the
    // re-encode drops the metadata block entirely (sharp strips by default
    // unless `keepMetadata()`/`withMetadata()` is called).
    const pipeline = sharp(source, { failOn: "error" }).rotate();

    const mainBuffer = await pipeline
      .clone()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: MAIN_QUALITY, mozjpeg: true, progressive: true })
      .toBuffer({ resolveWithObject: true });

    const thumbnail = await pipeline
      .clone()
      .resize({
        width: THUMBNAIL_DIMENSION,
        height: THUMBNAIL_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true, progressive: true })
      .toBuffer();

    return {
      main: mainBuffer.data,
      thumbnail,
      width: mainBuffer.info.width,
      height: mainBuffer.info.height,
    };
  } catch (err) {
    console.error("[image] Processing failed:", err);
    return null;
  }
}
