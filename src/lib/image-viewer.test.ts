/**
 * Tests for the image viewer's pure gesture/transform helpers.
 *
 * These cover the behaviour that is easy to get subtly wrong and impossible to
 * eyeball in a screenshot: pan limits after rotation, pinch clamping, swipe
 * resolution at different zoom levels, and index wrapping.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_SCALE,
  MIN_SCALE,
  SWIPE_THRESHOLD,
  buildTransform,
  clampOffset,
  clampScale,
  normalizeRotation,
  resolveSwipe,
  rotateBy,
  touchDistance,
  wrapIndex,
} from "./image-viewer";

const container = { width: 400, height: 800 };

describe("clampScale", () => {
  it("keeps scale inside the allowed range", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(2.5)).toBe(2.5);
  });
});

describe("normalizeRotation", () => {
  it("wraps negative and over-full rotations into [0, 360)", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it("accumulates rotations without drifting out of range", () => {
    let r = 0;
    for (let i = 0; i < 8; i++) r = rotateBy(r, 90);
    expect(r).toBe(0);

    r = 0;
    for (let i = 0; i < 8; i++) r = rotateBy(r, -90);
    expect(r).toBe(0);
  });
});

describe("clampOffset", () => {
  it("centres the image at scale 1 (no panning)", () => {
    expect(clampOffset({ x: 120, y: -80 }, 1, 0, container)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("limits panning to the overflow at scale 2", () => {
    // 400 wide at 2x → 800, so 200px of overflow on each side
    const result = clampOffset({ x: 9999, y: 0 }, 2, 0, container);
    expect(result.x).toBe(200);
  });

  it("clamps in both directions", () => {
    expect(clampOffset({ x: -9999, y: 0 }, 2, 0, container).x).toBe(-200);
  });

  it("swaps the panning box when the image is rotated 90°", () => {
    // Rotated, the visual width comes from the container height (800)
    const landscape = clampOffset({ x: 9999, y: 0 }, 2, 90, container);
    const upright = clampOffset({ x: 9999, y: 0 }, 2, 0, container);
    expect(landscape.x).toBe(600); // (800*2 - 400)/2
    expect(upright.x).toBe(200); // (400*2 - 400)/2
  });

  it("treats 180° as not swapped", () => {
    expect(clampOffset({ x: 9999, y: 0 }, 2, 180, container).x).toBe(200);
  });
});

describe("touchDistance", () => {
  it("measures the pinch span", () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(touchDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});

describe("wrapIndex", () => {
  it("wraps in both directions", () => {
    expect(wrapIndex(0, 3)).toBe(0);
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(7, 3)).toBe(1);
  });

  it("is safe for an empty gallery", () => {
    expect(wrapIndex(0, 0)).toBe(0);
    expect(wrapIndex(5, 0)).toBe(0);
  });
});

describe("resolveSwipe", () => {
  it("ignores short drags", () => {
    expect(resolveSwipe(SWIPE_THRESHOLD - 1, 1, 3)).toBeNull();
    expect(resolveSwipe(-(SWIPE_THRESHOLD - 1), 1, 3)).toBeNull();
  });

  it("navigates at scale 1", () => {
    expect(resolveSwipe(SWIPE_THRESHOLD + 10, 1, 3)).toBe("prev");
    expect(resolveSwipe(-(SWIPE_THRESHOLD + 10), 1, 3)).toBe("next");
  });

  it("pans instead of navigating when zoomed in", () => {
    expect(resolveSwipe(500, 2, 3)).toBeNull();
  });

  it("does nothing with a single image", () => {
    expect(resolveSwipe(500, 1, 1)).toBeNull();
  });
});

describe("buildTransform", () => {
  it("composes translate, scale and rotate in a stable order", () => {
    expect(buildTransform({ x: 10, y: -5 }, 2, 90)).toBe(
      "translate3d(10px, -5px, 0) scale(2) rotate(90deg)",
    );
  });
});
