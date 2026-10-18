/**
 * Diary editor — lets the user rewrite what the model produced.
 *
 * Opened from the detail page's "more" menu. Edits title, summary and body;
 * saving marks the diary as manually edited so auto-generation will not
 * overwrite it later (the backend does this via `updateDiaryContent`).
 *
 * Follows the same drawer conventions as the fragment editor on Home: a
 * vaul drawer, body scroll locked while open, and a keyboard-aware offset so
 * the save button stays reachable above the on-screen keyboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Drawer } from "vaul";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";

export interface DiaryDraft {
  title: string;
  summary: string;
  content: string;
}

interface DiaryEditorProps {
  open: boolean;
  onClose: () => void;
  initial: DiaryDraft;
  onSave: (draft: DiaryDraft) => Promise<void> | void;
  isSaving: boolean;
}

const TITLE_MAX = 255;
const SUMMARY_MAX = 500;

export function DiaryEditor({
  open,
  onClose,
  initial,
  onSave,
  isSaving,
}: DiaryEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [content, setContent] = useState(initial.content);
  const keyboardHeight = useKeyboardHeight();
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Reopening resets to whatever is currently stored, so a cancelled edit is
  // not carried over into the next one.
  useEffect(() => {
    if (open) {
      setTitle(initial.title);
      setSummary(initial.summary);
      setContent(initial.content);
    }
  }, [open, initial.title, initial.summary, initial.content]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const dirty = useMemo(
    () =>
      title !== initial.title ||
      summary !== initial.summary ||
      content !== initial.content,
    [title, summary, content, initial],
  );

  const canSave = content.trim().length > 0 && dirty && !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    await onSave({
      title: title.trim(),
      summary: summary.trim(),
      content: content.trim(),
    });
  }, [canSave, onSave, title, summary, content]);

  const handleReset = useCallback(() => {
    setTitle(initial.title);
    setSummary(initial.summary);
    setContent(initial.content);
  }, [initial]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-overlay"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onClick={handleClose}
        />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-drawer mx-auto flex max-w-[480px] flex-col rounded-t-3xl outline-none"
          style={{
            backgroundColor: "var(--bg-elevated)",
            maxHeight: "92dvh",
            bottom: keyboardHeight > 0 ? keyboardHeight : 0,
          }}
        >
          {/* Grab handle */}
          <div className="flex flex-shrink-0 justify-center pt-3 pb-1">
            <div
              className="h-1 w-10 rounded-full"
              style={{ backgroundColor: "var(--divider)" }}
            />
          </div>

          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between px-5 pb-2 pt-1">
            <div>
              <h2
                className="font-display text-lg"
                style={{ color: "var(--text-primary)" }}
              >
                编辑日记
              </h2>
              <p
                className="mt-0.5 font-ui text-xs"
                style={{ color: "var(--text-tertiary)" }}
              >
                保存后会标记为手动编辑，自动生成不再覆盖
              </p>
            </div>
            <button
              onClick={handleReset}
              disabled={!dirty || isSaving}
              className="flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-30"
              style={{ color: "var(--text-tertiary)" }}
              aria-label="恢复为原文"
            >
              <RotateCcw size={17} />
            </button>
          </div>

          {/* Scrollable form */}
          <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-3">
            {/* Title */}
            <label
              className="mb-1.5 mt-3 block font-ui text-xs"
              style={{ color: "var(--text-tertiary)" }}
            >
              标题
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="给这一天起个名字"
              className="w-full rounded-xl px-4 py-3 font-display text-base outline-none"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                border: "1px solid var(--divider)",
              }}
            />

            {/* Summary */}
            <label
              className="mb-1.5 mt-4 block font-ui text-xs"
              style={{ color: "var(--text-tertiary)" }}
            >
              一句话摘要
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value.slice(0, SUMMARY_MAX))}
              maxLength={SUMMARY_MAX}
              rows={2}
              placeholder="这一天的概括"
              className="w-full resize-none rounded-xl px-4 py-3 font-body text-sm outline-none"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                border: "1px solid var(--divider)",
                lineHeight: 1.7,
              }}
            />
            <p
              className="mt-1 text-right font-ui text-[11px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {summary.length}/{SUMMARY_MAX}
            </p>

            {/* Body */}
            <label
              className="mb-1.5 mt-2 block font-ui text-xs"
              style={{ color: "var(--text-tertiary)" }}
            >
              正文
            </label>
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="正文内容"
              className="w-full resize-y rounded-xl px-4 py-3 font-body text-[15px] outline-none"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)",
                border: "1px solid var(--divider)",
                lineHeight: 1.9,
                minHeight: 220,
              }}
            />
            <p
              className="mt-1 text-right font-ui text-[11px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {content.trim().length} 字
            </p>
          </div>

          {/* Save bar */}
          <div
            className="flex-shrink-0 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-2"
            style={{ backgroundColor: "var(--bg-elevated)" }}
          >
            <motion.button
              whileTap={canSave ? { scale: 0.97 } : {}}
              onClick={handleSave}
              disabled={!canSave}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-ui text-base font-medium disabled:opacity-40"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Check size={18} />
                  保存
                </>
              )}
            </motion.button>
            {!dirty && content.trim().length > 0 && (
              <p
                className="mt-2 text-center font-ui text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                没有改动
              </p>
            )}
            {content.trim().length === 0 && (
              <p
                className="mt-2 text-center font-ui text-[11px]"
                style={{ color: "var(--error)" }}
              >
                正文不能为空
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
