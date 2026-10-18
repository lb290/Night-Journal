/**
 * Full-screen image viewer: pinch/tap zoom, rotate, and gallery navigation.
 *
 * Deliberately built on plain pointer events rather than a gesture library —
 * the app only needs pinch, pan, double-tap, swipe, and two rotate buttons, and
 * a dependency would add more weight than it saves.
 *
 * Rendered through a portal at the top of the z-index scale so it sits above
 * the bottom drawer (z-drawer) and the FAB (z-fab).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  RotateCcw,
  ZoomIn,
} from "lucide-react";
import {
  DOUBLE_TAP_SCALE,
  buildTransform,
  clampOffset,
  clampScale,
  normalizeRotation,
  resolveSwipe,
  rotateBy,
  touchDistance,
  wrapIndex,
  type Point,
} from "@/lib/image-viewer";

export interface ViewerImage {
  /** Full-resolution source. */
  src: string;
  /** Optional lower-res preview shown while the full image loads. */
  previewSrc?: string;
  alt?: string;
  /** Caption rendered under the toolbar. */
  caption?: string;
}

interface ImageViewerProps {
  images: ViewerImage[];
  /** Index of the image to open first. */
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
}

export function ImageViewer({
  images,
  initialIndex = 0,
  open,
  onClose,
}: ImageViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  // Whether a gesture is in flight. Mirrors the pointer refs into state so the
  // render pass can disable the CSS transition without reading a ref.
  const [gesturing, setGesturing] = useState(false);
  // Measured stage size. Needed because a rotated image has to be constrained
  // by the *swapped* box — `max-w-full` on the element does not account for the
  // transform, so a 90° rotation would otherwise overflow the stage.
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  // Active pointers, keyed by pointerId — two of them means a pinch.
  const pointersRef = useRef(new Map<number, Point>());
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  const dragStartRef = useRef<{ point: Point; offset: Point } | null>(null);
  const lastTapRef = useRef<{ time: number; point: Point } | null>(null);

  const current = images[index];

  const resetTransform = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Track the stage size so rotation can swap the constraint box.
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  // Reopening (or switching image) starts from a clean slate.
  useEffect(() => {
    if (open) {
      setIndex(wrapIndex(initialIndex, images.length));
      resetTransform();
      setLoaded(false);
    }
  }, [open, initialIndex, images.length, resetTransform]);

  const goTo = useCallback(
    (next: number) => {
      setIndex(wrapIndex(next, images.length));
      resetTransform();
      setLoaded(false);
    },
    [images.length, resetTransform],
  );

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  const toggleZoom = useCallback(() => {
    setScale((prev) => {
      if (prev > 1) {
        setOffset({ x: 0, y: 0 });
        return 1;
      }
      return DOUBLE_TAP_SCALE;
    });
  }, []);

  // ── Keyboard: Esc closes, arrows navigate, +/- zoom, r rotates ──
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goPrev();
          break;
        case "ArrowRight":
          goNext();
          break;
        case "+":
        case "=":
          setScale((s) => clampScale(s * 1.25));
          break;
        case "-":
          setScale((s) => clampScale(s / 1.25));
          break;
        case "r":
        case "R":
          setRotation((r) => rotateBy(r, 90));
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, goPrev, goNext]);

  // Lock body scroll while the viewer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // ── Pointer handling ──

  const containerSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { width: 0, height: 0 };
    return { width: el.clientWidth, height: el.clientHeight };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setGesturing(true);

      if (pointersRef.current.size === 2) {
        // Second finger down: start a pinch, abandon any drag in progress.
        const [a, b] = Array.from(pointersRef.current.values());
        pinchStartRef.current = { distance: touchDistance(a, b), scale };
        dragStartRef.current = null;
        return;
      }

      if (pointersRef.current.size === 1) {
        dragStartRef.current = { point: { x: e.clientX, y: e.clientY }, offset };
      }
    },
    [scale, offset],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pointers = Array.from(pointersRef.current.values());

      // Pinch: scale relative to the distance when the gesture began.
      if (pointers.length === 2 && pinchStartRef.current) {
        const distance = touchDistance(pointers[0], pointers[1]);
        const ratio = distance / (pinchStartRef.current.distance || 1);
        const nextScale = clampScale(pinchStartRef.current.scale * ratio);
        setScale(nextScale);
        if (nextScale === 1) setOffset({ x: 0, y: 0 });
        return;
      }

      // Single-finger drag: pan when zoomed, otherwise let it become a swipe
      // (resolved on pointer up so a small wobble does not change images).
      if (pointers.length === 1 && dragStartRef.current && scale > 1) {
        const start = dragStartRef.current;
        const dx = e.clientX - start.point.x;
        const dy = e.clientY - start.point.y;
        setOffset(
          clampOffset(
            { x: start.offset.x + dx, y: start.offset.y + dy },
            scale,
            rotation,
            containerSize(),
          ),
        );
      }
    },
    [scale, rotation, containerSize],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = dragStartRef.current;
      const wasPinching = pinchStartRef.current !== null;

      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchStartRef.current = null;
      if (pointersRef.current.size === 0) {
        dragStartRef.current = null;
        setGesturing(false);
      }

      if (wasPinching) {
        // Settle back to 1 rather than leaving a barely-zoomed image.
        setScale((s) => (s < 1.05 ? 1 : s));
        return;
      }

      // Double-tap zoom
      const now = Date.now();
      const point = { x: e.clientX, y: e.clientY };
      const last = lastTapRef.current;
      if (
        start &&
        last &&
        now - last.time < 300 &&
        Math.hypot(point.x - last.point.x, point.y - last.point.y) < 30
      ) {
        lastTapRef.current = null;
        toggleZoom();
        return;
      }
      lastTapRef.current = { time: now, point };

      // Swipe to navigate (only at scale 1)
      if (start) {
        const deltaX = e.clientX - start.point.x;
        const direction = resolveSwipe(deltaX, scale, images.length);
        if (direction === "prev") goPrev();
        else if (direction === "next") goNext();
      }
    },
    [scale, images.length, goPrev, goNext, toggleZoom],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Ctrl+wheel is the pinch gesture trackpads report; plain wheel is ignored
    // so scrolling the page behind does not zoom the photo.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setScale((s) => clampScale(s * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, []);

  if (!open || !current) return null;

  const hasMultiple = images.length > 1;
  const rotated = normalizeRotation(rotation) % 180 !== 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="图片查看"
    >
      {/* ── Top bar ── */}
      <div className="flex flex-shrink-0 items-center justify-between px-3 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:scale-90"
          aria-label="关闭"
        >
          <X size={22} />
        </button>

        {hasMultiple && (
          <span className="font-ui text-sm text-white/70">
            {index + 1} / {images.length}
          </span>
        )}

        <div className="flex items-center">
          <button
            onClick={() => setScale((s) => clampScale(s > 1 ? 1 : DOUBLE_TAP_SCALE))}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:scale-90"
            aria-label={scale > 1 ? "缩小" : "放大"}
          >
            <ZoomIn size={20} />
          </button>
        </div>
      </div>

      {/* ── Image stage ── */}
      <div
        ref={containerRef}
        className="relative flex flex-1 touch-none select-none items-center justify-center overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* Preview underneath prevents a black flash while the full image loads */}
        {current.previewSrc && !loaded && (
          <img
            src={current.previewSrc}
            alt=""
            aria-hidden="true"
            className="absolute max-h-full max-w-full object-contain opacity-70 blur-[1px]"
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.img
            key={`${current.src}-${index}`}
            src={current.src}
            alt={current.alt ?? `图片 ${index + 1}`}
            onLoad={() => setLoaded(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: loaded ? 1 : 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="object-contain"
            style={{
              // A 90°/270° rotation swaps the visual axes, so the element must
              // be constrained by the stage's transposed dimensions. Using
              // `max-w-full max-h-full` alone lets the rotated image overflow.
              maxWidth: rotated ? stage.height || "100%" : "100%",
              maxHeight: rotated ? stage.width || "100%" : "100%",
              transform: buildTransform(offset, scale, rotation),
              // While a finger is down the transform must track the pointer
              // exactly; a transition would lag behind and feel rubbery.
              transition: gesturing ? "none" : "transform 0.18s ease-out",
              cursor: scale > 1 ? "grab" : "zoom-in",
            }}
            draggable={false}
          />
        </AnimatePresence>

        {/* Gallery arrows (desktop + tablets) */}
        {hasMultiple && (
          <>
            <button
              onClick={goPrev}
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm active:scale-90"
              aria-label="上一张"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm active:scale-90"
              aria-label="下一张"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {/* ── Bottom bar: rotate + caption ── */}
      <div className="flex flex-shrink-0 flex-col items-center gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRotation((r) => rotateBy(r, -90))}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:scale-90"
            aria-label="向左旋转"
          >
            <RotateCcw size={20} />
          </button>
          <button
            onClick={() => setRotation((r) => rotateBy(r, 90))}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 active:scale-90"
            aria-label="向右旋转"
          >
            <RotateCw size={20} />
          </button>
        </div>

        {current.caption && (
          <p className="max-w-[85%] text-center font-ui text-xs leading-relaxed text-white/60">
            {current.caption}
          </p>
        )}

        {hasMultiple && (
          <div className="flex items-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === index ? 18 : 6,
                  backgroundColor:
                    i === index ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)",
                }}
                aria-label={`第 ${i + 1} 张`}
                aria-current={i === index}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
