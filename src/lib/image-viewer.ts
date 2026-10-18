/**
 * Pure helpers for the image viewer.
 *
 * Kept free of DOM and React so the gesture maths can be unit-tested without a
 * browser: clamping, rotation normalisation, pinch distance, and index wrap.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;

/** Distance beyond which a horizontal drag counts as a swipe. */
export const SWIPE_THRESHOLD = 60;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

/** Keep rotation in [0, 360) so comparisons and CSS stay tidy. */
export function normalizeRotation(rotation: number): number {
  const r = rotation % 360;
  return r < 0 ? r + 360 : r;
}

export function rotateBy(rotation: number, delta: number): number {
  return normalizeRotation(rotation + delta);
}

/**
 * Offset limits for a zoomed image.
 *
 * A rotated image swaps its visual width and height, so the panning box has to
 * swap with it. At scale 1 the image is centred and cannot be panned at all.
 */
export function clampOffset(
  offset: Point,
  scale: number,
  rotation: number,
  container: Size,
): Point {
  if (scale <= 1) return { x: 0, y: 0 };

  const swapped = normalizeRotation(rotation) % 180 !== 0;
  const imageWidth = swapped ? container.height : container.width;
  const imageHeight = swapped ? container.width : container.height;

  const maxX = Math.max(0, (imageWidth * scale - container.width) / 2);
  const maxY = Math.max(0, (imageHeight * scale - container.height) / 2);

  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  };
}

/** Euclidean distance between two touch points — the pinch measurement. */
export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function touchMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Wrap an index into range, so prev/next never falls off the gallery. */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

/**
 * Decide what a horizontal drag should do.
 *
 * At scale 1 a swipe flips to the neighbouring image; when zoomed in the same
 * gesture must pan instead, otherwise the user cannot look around a zoomed
 * photo without changing images.
 */
export function resolveSwipe(
  deltaX: number,
  scale: number,
  imageCount: number,
): "prev" | "next" | null {
  if (scale > 1 || imageCount <= 1) return null;
  if (Math.abs(deltaX) < SWIPE_THRESHOLD) return null;
  return deltaX > 0 ? "prev" : "next";
}

/** CSS transform for the image, in a stable order. */
export function buildTransform(
  offset: Point,
  scale: number,
  rotation: number,
): string {
  return `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale}) rotate(${rotation}deg)`;
}
