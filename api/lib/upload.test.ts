/**
 * Tests for the upload path: compression, thumbnail generation, and the
 * cleanup that runs when an entry is deleted.
 *
 * The heavy lifting (sharp / heic-convert) is mocked so these tests stay fast
 * and do not depend on native binaries being present on CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const processImageMock = vi.fn();

vi.mock("./image", () => ({
  processImage: processImageMock,
  MAX_IMAGE_DIMENSION: 1600,
  THUMBNAIL_DIMENSION: 400,
  isHeifFile: (name: string, mime?: string) =>
    /\.(heic|heif)$/i.test(name) || mime === "image/heic" || mime === "image/heif",
}));

let tmpRoot: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nj-upload-"));
  process.env.UPLOAD_DIR = tmpRoot;
});

afterEach(() => {
  delete process.env.UPLOAD_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Build a File the way the browser would send it. */
function makeFile(name: string, type: string, bytes: Buffer): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("saveUploadedFile", () => {
  it("stores the compressed image plus a thumbnail and reports both paths", async () => {
    processImageMock.mockResolvedValue({
      main: Buffer.from("MAIN-JPEG"),
      thumbnail: Buffer.from("THUMB-JPEG"),
      width: 1200,
      height: 1600,
    });

    const { saveUploadedFile } = await import("./upload");
    const original = Buffer.alloc(8 * 1024 * 1024, 7);

    const result = await saveUploadedFile(
      3,
      makeFile("IMG_0001.jpg", "image/jpeg", original),
    );

    // Stored file is the compressed output, not the original bytes
    expect(result.storagePath).toMatch(/^3\/\d+-[A-Za-z0-9_-]+\.jpg$/);
    expect(result.fileType).toBe("image/jpeg");
    expect(result.fileSize).toBe(Buffer.from("MAIN-JPEG").length);
    expect(result.originalSize).toBe(original.length);

    // Thumbnail lives in a subfolder and shares the file name
    expect(result.thumbStoragePath).toBeTruthy();
    expect(result.thumbStoragePath).toMatch(/^3\/thumb\/\d+-[A-Za-z0-9_-]+\.jpg$/);
    expect(path.basename(result.thumbStoragePath!)).toBe(
      path.basename(result.storagePath),
    );

    // Both files exist on disk with the right contents
    expect(fs.readFileSync(path.join(tmpRoot, result.storagePath), "utf-8")).toBe(
      "MAIN-JPEG",
    );
    expect(
      fs.readFileSync(path.join(tmpRoot, result.thumbStoragePath!), "utf-8"),
    ).toBe("THUMB-JPEG");

    // The read URLs are derived from the storage paths
    expect(result.fileUrl).toBe(`/api/uploads/${result.storagePath}`);
    expect(result.thumbFileUrl).toBe(`/api/uploads/${result.thumbStoragePath}`);
  });

  it("falls back to the original bytes when the image cannot be decoded", async () => {
    processImageMock.mockResolvedValue(null);

    const { saveUploadedFile } = await import("./upload");
    const bytes = Buffer.from("NOT-AN-IMAGE");

    const result = await saveUploadedFile(
      7,
      makeFile("weird.png", "image/png", bytes),
    );

    // Original extension and MIME survive, no thumbnail is claimed
    expect(result.storagePath).toMatch(/^7\/\d+-[A-Za-z0-9_-]+\.png$/);
    expect(result.fileType).toBe("image/png");
    expect(result.thumbStoragePath).toBeNull();
    expect(result.thumbFileUrl).toBeNull();
    expect(fs.readFileSync(path.join(tmpRoot, result.storagePath))).toEqual(bytes);
  });

  it("does not re-encode animated GIFs but still stores them", async () => {
    const { saveUploadedFile } = await import("./upload");
    const bytes = Buffer.from("GIF89a-fake");

    const result = await saveUploadedFile(
      7,
      makeFile("anim.gif", "image/gif", bytes),
    );

    expect(processImageMock).not.toHaveBeenCalled();
    expect(result.fileType).toBe("image/gif");
    expect(result.storagePath).toMatch(/^7\/\d+-[A-Za-z0-9_-]+\.gif$/);
    expect(fs.readFileSync(path.join(tmpRoot, result.storagePath))).toEqual(bytes);
  });

  it("rejects files above the size limit", async () => {
    const { saveUploadedFile, MAX_UPLOAD_SIZE } = await import("./upload");
    const tooBig = Buffer.alloc(MAX_UPLOAD_SIZE + 1, 1);

    await expect(
      saveUploadedFile(1, makeFile("big.jpg", "image/jpeg", tooBig)),
    ).rejects.toThrow(/too large/i);
    expect(processImageMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported types", async () => {
    const { saveUploadedFile } = await import("./upload");

    await expect(
      saveUploadedFile(1, makeFile("doc.pdf", "application/pdf", Buffer.from("x"))),
    ).rejects.toThrow(/not allowed/i);
  });
});

describe("deleteStoredFiles", () => {
  it("removes both the image and its thumbnail", async () => {
    processImageMock.mockResolvedValue({
      main: Buffer.from("M"),
      thumbnail: Buffer.from("T"),
      width: 100,
      height: 100,
    });

    const { saveUploadedFile, deleteStoredFiles } = await import("./upload");
    const saved = await saveUploadedFile(
      5,
      makeFile("a.jpg", "image/jpeg", Buffer.from("orig")),
    );

    const mainPath = path.join(tmpRoot, saved.storagePath);
    const thumbPath = path.join(tmpRoot, saved.thumbStoragePath!);
    expect(fs.existsSync(mainPath)).toBe(true);
    expect(fs.existsSync(thumbPath)).toBe(true);

    deleteStoredFiles(saved.storagePath, saved.thumbStoragePath);

    expect(fs.existsSync(mainPath)).toBe(false);
    expect(fs.existsSync(thumbPath)).toBe(false);
  });

  it("ignores path traversal attempts", async () => {
    const { deleteStoredFiles } = await import("./upload");

    const outside = path.join(tmpRoot, "..", "must-survive.txt");
    fs.writeFileSync(outside, "keep me");

    // Should be a no-op: the resolved path escapes the upload dir
    deleteStoredFiles("../must-survive.txt");
    expect(fs.existsSync(outside)).toBe(true);

    fs.unlinkSync(outside);
  });

  it("tolerates missing files", async () => {
    const { deleteStoredFiles } = await import("./upload");
    expect(() => deleteStoredFiles("9/nope.jpg", "9/thumb/nope.jpg")).not.toThrow();
  });
});
