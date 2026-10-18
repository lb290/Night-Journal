/**
 * Tests for the image pipeline itself.
 *
 * These use sharp for real (no mocks) because the whole point is verifying the
 * resize / re-encode / metadata-stripping behaviour. Synthetic images are built
 * in-memory, so no fixtures are needed and the tests stay fast.
 */

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  processImage,
  isHeifFile,
  MAX_IMAGE_DIMENSION,
  THUMBNAIL_DIMENSION,
} from "./image";

/** Build a JPEG of the given size with a metadata block attached. */
async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 60, b: 200 },
    },
  })
    .jpeg({ quality: 95 })
    .withMetadata({ exif: { IFD0: { Copyright: "test-copyright" } } })
    .toBuffer();
}

describe("processImage", () => {
  it("caps the long edge and produces a thumbnail", async () => {
    const input = await makeJpeg(3000, 4000);
    const result = await processImage(input, "photo.jpg", "image/jpeg");

    expect(result).not.toBeNull();
    const { main, thumbnail, width, height } = result!;

    // Portrait 3000×4000 → long edge 1600
    expect(Math.max(width, height)).toBe(MAX_IMAGE_DIMENSION);
    expect(width).toBe(1200);
    expect(height).toBe(1600);

    // The stored image is dramatically smaller than the source
    expect(main.length).toBeLessThan(input.length);

    const thumbMeta = await sharp(thumbnail).metadata();
    expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBeLessThanOrEqual(
      THUMBNAIL_DIMENSION,
    );
    expect(thumbMeta.format).toBe("jpeg");
  });

  it("does not upscale a small image", async () => {
    const input = await makeJpeg(320, 240);
    const result = await processImage(input, "small.jpg", "image/jpeg");

    expect(result).not.toBeNull();
    expect(result!.width).toBe(320);
    expect(result!.height).toBe(240);
  });

  it("strips EXIF metadata", async () => {
    const input = await makeJpeg(800, 600);
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processImage(input, "tagged.jpg", "image/jpeg");
    const meta = await sharp(result!.main).metadata();

    expect(meta.exif).toBeUndefined();
  });

  it("always emits JPEG, whatever the input format", async () => {
    const png = await sharp({
      create: { width: 900, height: 700, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await processImage(png, "shot.png", "image/png");
    expect(result).not.toBeNull();
    expect((await sharp(result!.main).metadata()).format).toBe("jpeg");
  });

  it("returns null for undecodable input instead of throwing", async () => {
    const result = await processImage(
      Buffer.from("this is definitely not an image"),
      "broken.jpg",
      "image/jpeg",
    );
    expect(result).toBeNull();
  });

  it("keeps the aspect ratio of a landscape image", async () => {
    const input = await makeJpeg(4000, 2000);
    const result = await processImage(input, "wide.jpg", "image/jpeg");

    expect(result!.width).toBe(1600);
    expect(result!.height).toBe(800);
  });
});

describe("isHeifFile", () => {
  it("detects HEIC and HEIF by extension", () => {
    expect(isHeifFile("IMG_0001.HEIC")).toBe(true);
    expect(isHeifFile("photo.heif")).toBe(true);
    expect(isHeifFile("photo.jpg")).toBe(false);
  });

  it("detects by MIME type when the name has no useful extension", () => {
    expect(isHeifFile("upload", "image/heic")).toBe(true);
    expect(isHeifFile("upload", "image/jpeg")).toBe(false);
  });
});
