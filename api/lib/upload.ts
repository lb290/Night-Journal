import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { processImage } from "./image";

const UPLOAD_DIR = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || "data/uploads",
);

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

/** Subdirectory (inside each user's folder) that holds thumbnails. */
export const THUMB_DIR_NAME = "thumb";

export function getUploadDir(): string {
  return UPLOAD_DIR;
}

export function ensureUploadDir(userId: number): string {
  const userDir = path.join(UPLOAD_DIR, String(userId));
  fs.mkdirSync(userDir, { recursive: true });
  return userDir;
}

function ensureThumbDir(userId: number): string {
  const dir = path.join(UPLOAD_DIR, String(userId), THUMB_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateFileName(name: string): void {
  if (!name || name.length > 255) {
    throw new Error("Invalid file name");
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("File name contains path traversal characters");
  }
}

export function validateUploadedFile(file: File): {
  ext: string;
  type: string;
} {
  if (!file || !(file instanceof File)) {
    throw new Error("No file provided");
  }
  if (file.size <= 0) {
    throw new Error("File is empty");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error(`File too large. Max allowed size is ${MAX_UPLOAD_SIZE / 1024 / 1024} MB`);
  }

  const fileName = file.name || "";
  const fileExt = path.extname(fileName).toLowerCase();
  const detectedType = file.type ? file.type.toLowerCase() : "";

  // Prefer the declared MIME type when it is in the allow list
  if (ALLOWED_MIME_TYPES.has(detectedType)) {
    return { ext: MIME_TO_EXT[detectedType], type: detectedType };
  }

  // Fallback: allow files whose extension maps to an allowed MIME type
  // (e.g. HEIC uploads may arrive as application/octet-stream)
  const mimeFromExt = fileExt ? EXT_TO_MIME[fileExt] : undefined;
  if (mimeFromExt) {
    return { ext: fileExt, type: mimeFromExt };
  }

  throw new Error(
    `File type not allowed. Allowed types: ${Object.keys(EXT_TO_MIME).join(", ")}`,
  );
}

export interface SavedUpload {
  fileName: string;
  /** Path relative to the upload dir, e.g. "3/1792...-abc.jpg". */
  storagePath: string;
  /** Authenticated read URL for the stored image. */
  fileUrl: string;
  /** Stored MIME type after normalisation. */
  fileType: string;
  /** Bytes on disk for the stored image. */
  fileSize: number;
  /** Bytes the client originally sent, before compression. */
  originalSize: number;
  /** Thumbnail path, when a thumbnail was produced. */
  thumbStoragePath: string | null;
  thumbFileUrl: string | null;
}

/**
 * Persist an uploaded image.
 *
 * The file is normalised on the way in (see `api/lib/image.ts`): long edge
 * capped at 1600 px, EXIF stripped, JPEG re-encoded, plus a 400 px thumbnail.
 * An 8.8 MB phone photo lands on disk as ~200 KB and a ~15 KB thumbnail.
 *
 * GIFs are stored untouched — re-encoding would flatten the animation — but
 * still get a thumbnail from the first frame. Anything sharp cannot decode
 * falls back to the original bytes so a strange image never blocks an entry.
 */
export async function saveUploadedFile(
  userId: number,
  file: File,
): Promise<SavedUpload> {
  const { ext, type } = validateUploadedFile(file);
  const userDir = ensureUploadDir(userId);
  const buffer = Buffer.from(await file.arrayBuffer());

  const baseName = `${Date.now()}-${nanoid(8)}`;
  const originalSize = buffer.length;

  const isAnimatedGif = type === "image/gif";
  const processed = isAnimatedGif
    ? null
    : await processImage(buffer, file.name || "", type);

  if (processed) {
    const safeName = `${baseName}.jpg`;
    validateFileName(safeName);

    const fullPath = path.join(userDir, safeName);
    const thumbDir = ensureThumbDir(userId);
    const thumbFullPath = path.join(thumbDir, safeName);

    fs.writeFileSync(fullPath, processed.main);
    fs.writeFileSync(thumbFullPath, processed.thumbnail);

    const storagePath = `${userId}/${safeName}`;
    const thumbStoragePath = `${userId}/${THUMB_DIR_NAME}/${safeName}`;

    return {
      fileName: file.name,
      storagePath,
      fileUrl: `/api/uploads/${storagePath}`,
      fileType: "image/jpeg",
      fileSize: processed.main.length,
      originalSize,
      thumbStoragePath,
      thumbFileUrl: `/api/uploads/${thumbStoragePath}`,
    };
  }

  // Fallback: keep the bytes as-is (GIF, or an image sharp could not decode)
  const safeName = `${baseName}${ext}`;
  validateFileName(safeName);

  const fullPath = path.join(userDir, safeName);
  fs.writeFileSync(fullPath, buffer);

  const storagePath = `${userId}/${safeName}`;

  return {
    fileName: file.name,
    storagePath,
    fileUrl: `/api/uploads/${storagePath}`,
    fileType: type,
    fileSize: buffer.length,
    originalSize,
    thumbStoragePath: null,
    thumbFileUrl: null,
  };
}

export function getFilePath(storagePath: string): string | null {
  if (!storagePath || storagePath.includes("..") || storagePath.includes("\\")) {
    return null;
  }

  const full = path.resolve(UPLOAD_DIR, storagePath);
  // Ensure the resolved path is still inside the upload directory
  if (!full.startsWith(UPLOAD_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(full)) {
    return null;
  }
  return full;
}

/**
 * Remove a stored image and its thumbnail.
 *
 * Soft-deleting an entry used to leave the files behind forever — every deleted
 * photo stayed on disk. Paths are validated through `getFilePath`, so a crafted
 * value can never reach outside the upload directory.
 */
export function deleteStoredFiles(
  storagePath: string | null | undefined,
  thumbStoragePath?: string | null,
): void {
  for (const candidate of [storagePath, thumbStoragePath]) {
    if (!candidate) continue;
    const full = getFilePath(candidate);
    if (!full) continue;
    try {
      fs.unlinkSync(full);
    } catch (err) {
      console.error(`[upload] Failed to delete ${candidate}:`, err);
    }
  }
}

export function readFileAsBase64(storagePath: string): string | null {
  const full = getFilePath(storagePath);
  if (!full) return null;
  return fs.readFileSync(full).toString("base64");
}
