import { format } from "date-fns";
import { complete, providerKindOf } from "../lib/model-dispatch";
import { decryptApiKey } from "../lib/crypto";
import { findEntriesByDate, updateEntry } from "../queries/entries";
import { findAiSettingsByUserId } from "../queries/ai-settings";
import { findDiaryByDate, updateDiary } from "../queries/diaries";
import { findProfileByUserId, findActiveShortTermMemories } from "../queries/memories";
import { dreamProfile } from "./dream";
import {
  DEFAULT_DIARY_SYSTEM_PROMPT,
  DEFAULT_DIARY_USER_TEMPLATE,
  DEFAULT_STYLE_PROMPTS,
  splitDiaryPrompt,
} from "@contracts/prompts";
import type { ShortTermMemory } from "@db/schema";

// In-process guard: prevents the same (userId, date) Dream pass from
// running twice concurrently — e.g. when regenerate + scheduler both
// trigger generateDiaryForDate in the same tick. Entries are cleared in
// the .finally() so a failed Dream pass can be retried on the next
// diary generation.
const dreamInFlight = new Set<string>();

/**
 * Convert an internal generation error into a user-safe message.
 * Never forward raw provider/transport diagnostics to the client.
 */
function sanitizeGenerationError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return "连接模型服务失败，请检查网络或 API 地址";
  }
  if (lower.includes("timeout")) {
    return "模型响应超时，请稍后重试";
  }
  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("authentication") || lower.includes("401")) {
    return "API 密钥无效或已被拒绝";
  }
  if (lower.includes("parse") || lower.includes("json")) {
    return "模型返回格式不正确，无法解析为日记";
  }
  return "生成失败，请稍后重试";
}

function getStylePrompt(style: string, stylePromptsJson?: string | null): string {
  if (stylePromptsJson) {
    try {
      const parsed = JSON.parse(stylePromptsJson) as Record<string, string>;
      if (parsed[style]) return parsed[style];
    } catch {
      // ignore invalid JSON
    }
  }
  return DEFAULT_STYLE_PROMPTS[style] ?? "";
}

type ShortTermMemoryInput = Pick<ShortTermMemory, "content" | "category" | "importance">;

interface DiaryMemory {
  profileSummary: string | null;
  languageStyle: string | null;
  shortTermMemories: ShortTermMemoryInput[];
}

interface DiaryContext {
  date: string;
  language: string;
  style: string;
  length: string;
  stylePrompt: string;
  fragments: Array<{
    contentText: string;
    moodLabel: string | null;
    createdAt: Date;
    attachments?: Array<{ visionSummary: string | null }>;
  }>;
  memory?: DiaryMemory | null;
}

/**
 * Render fragment descriptions for the prompt.
 * Each fragment includes its time, optional mood, content text, and any
 * image summaries produced by the vision model.
 */
function renderFragments(fragments: DiaryContext["fragments"]): string {
  return fragments
    .map((f, i) => {
      const time = format(new Date(f.createdAt), "HH:mm");
      const mood = f.moodLabel ? ` [${f.moodLabel}]` : "";
      const imageSummaries =
        f.attachments
          ?.filter((a) => a.visionSummary)
          .map((a) => `图片概要：${a.visionSummary}`)
          .join("\n") ?? "";
      return `${i + 1}. ${time}${mood}\n${f.contentText}${imageSummaries ? "\n" + imageSummaries : ""}`;
    })
    .join("\n\n");
}

/**
 * Render the consolidated image summary block.
 */
function renderImageSummaries(fragments: DiaryContext["fragments"]): string {
  const summaries = fragments
    .flatMap((f) => f.attachments?.filter((a) => a.visionSummary).map((a) => a.visionSummary) ?? [])
    .filter((s): s is string => !!s);
  return summaries.length > 0 ? summaries.join("\n") : "无";
}

/**
 * Render the Dream memory block. Injected only when a profile or short-term
 * memories exist.
 *
 * The wording is deliberately blunt: the profile is *inferred* from earlier
 * (often AI-written) diaries, so it must never be treated as a source of
 * facts. Without that warning the model happily narrates remembered details
 * as if they happened today, which compounds its own earlier inventions.
 */
function renderMemoryBlock(memory: DiaryMemory | null | undefined): string {
  if (!memory || (!memory.profileSummary && memory.shortTermMemories.length === 0)) {
    return "";
  }
  const lines: string[] = [];
  if (memory.profileSummary) {
    lines.push(`对这个用户的理解：${memory.profileSummary}`);
  }
  if (memory.languageStyle) {
    lines.push(`语风参考：${memory.languageStyle}`);
  }
  if (memory.shortTermMemories.length > 0) {
    const memLines = memory.shortTermMemories.map((m) => `- [${m.category}] ${m.content}`).join("\n");
    lines.push(`近期状态：\n${memLines}`);
  }
  return `
以下是对这个用户的背景理解，**只用来理解他的语气和状态，不是事实来源**：
- 不要把这里出现的任何具体情节、对话、物品、事件写成今天发生的事
- 不要因为这里提到过，就在今天日记里补细节
- 今天发生了什么，只以「今日碎片」为准
${lines.join("\n")}
`;
}

/**
 * Known placeholders for the diary user-message template.
 *
 * Keep this list in sync with the documentation in `contracts/prompts.ts`
 * and the hints shown in the Settings UI.
 */
export const DIARY_PLACEHOLDERS = [
  "{{date}}",
  "{{language}}",
  "{{style}}",
  "{{stylePrompt}}",
  "{{length}}",
  "{{fragments}}",
  "{{imageSummaries}}",
  "{{memoryBlock}}",
] as const;

/**
 * Build the user message sent to the diary model.
 *
 * If the configured prompt template contains any known placeholders, they are
 * replaced with the corresponding rendered content. This lets power users
 * rearrange or omit parts of the prompt from Settings.
 *
 * If the template contains no known placeholders (legacy custom prompts or
 * the old hard-coded format), the rendered content is appended after the
 * template as a fallback so existing user configurations keep working.
 */
export function buildDiaryUserMessage(context: DiaryContext, template: string): string {
  const { date, language, style, length, stylePrompt, fragments, memory } = context;

  const fragmentDescriptions = renderFragments(fragments);
  const imageSummaries = renderImageSummaries(fragments);
  const memoryBlock = renderMemoryBlock(memory);

  const legacyContentBlock = `日期：${date}
语言：${language}
日记风格：${style}
风格说明：${stylePrompt}
日记长度：${length}（仅供参考，实际篇幅以碎片信息量为准）
${memoryBlock}
今日碎片：
${fragmentDescriptions}

图片摘要汇总：
${imageSummaries}

说明：「今日碎片」和「图片摘要汇总」是唯一的事实来源；除它们之外的内容都只是参考资料，不得当作事实写进日记。
请根据以上素材生成日记。`;

  const hasPlaceholder = DIARY_PLACEHOLDERS.some((p) => template.includes(p));
  if (!hasPlaceholder) {
    return `${template}\n\n${legacyContentBlock}`;
  }

  const values: Record<string, string> = {
    date,
    language,
    style,
    stylePrompt,
    length,
    fragments: fragmentDescriptions,
    imageSummaries,
    memoryBlock,
  };
  return DIARY_PLACEHOLDERS.reduce((acc, key) => acc.replaceAll(key, values[key.slice(2, -2)] ?? ""), template);
}

/**
 * Decode newlines that arrived double-escaped.
 *
 * Models frequently emit content whose line breaks are escaped twice, so after
 * JSON.parse the string still holds the literal two characters "\\" + "n"
 * instead of a newline. Stored as-is, the whole diary renders as one
 * unbroken paragraph. We only rewrite the literal escape sequence, leaving
 * any real newlines untouched.
 */
function decodeEscapedNewlines(text: string): string {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

/**
 * Titles that carry no information: a bare date, or a generic word like
 * "日记" / "记录". The model produces these when it cannot find an angle, and
 * they are worse than useless in a list of diaries — every entry looks alike.
 */
const DATE_ONLY_TITLE =
  /^\s*(?:\d{4}\s*[年\-/.]\s*)?\d{1,2}\s*[月\-/.]\s*\d{1,2}\s*日?\s*$/;
const CHINESE_DATE_TITLE =
  /^\s*(?:\d{4}\s*年\s*)?[一二三四五六七八九十元正冬腊]{1,3}月[初十廿三]{0,2}[一二三四五六七八九十]{1,3}日?\s*$/;
/** "十月" / "10月" on its own is still a date, not a title. */
const MONTH_ONLY_TITLE = /^\s*(?:\d{4}\s*年\s*)?(?:\d{1,2}|[一二三四五六七八九十元正冬腊]{1,3})\s*月\s*$/;
const GENERIC_TITLES = new Set([
  "日记",
  "记录",
  "今天",
  "今日",
  "一天",
  "日常",
  "无题",
  "随记",
  "碎碎念",
]);

/**
 * Whether a title is worth keeping.
 *
 * This is a safety net, not the main fix: the prompt tells the model how to
 * write a title, but models regress. Rejecting the obvious non-titles here
 * means a bad title never reaches the database.
 */
export function isUsableTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (DATE_ONLY_TITLE.test(t)) return false;
  if (CHINESE_DATE_TITLE.test(t)) return false;
  if (MONTH_ONLY_TITLE.test(t)) return false;
  if (GENERIC_TITLES.has(t)) return false;
  // A title is a phrase, not a paragraph
  if (t.length > 24) return false;
  return true;
}

/**
 * Derive a fallback title from the diary body.
 *
 * Used only when the model returns something unusable. Takes the first
 * clause of the first non-empty paragraph, which is the closest thing to the
 * day's opening beat, and trims it to a title-sized phrase.
 */
export function deriveFallbackTitle(content: string): string {
  const firstParagraph = content
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstParagraph) return "无题";

  // Cut at the first sentence break, then cap the length
  const firstClause = firstParagraph.split(/[。！？；，,]/)[0]?.trim() ?? "";
  const candidate = (firstClause || firstParagraph).replace(/\s+/g, " ").trim();

  if (candidate.length <= 12) return candidate;
  return candidate.slice(0, 12);
}

export function parseDiaryResponse(
  content: string,
): { title: string; summary: string; content: string } | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const rawContent = typeof parsed.content === "string" ? parsed.content.trim() : "";
    const diaryContent = decodeEscapedNewlines(rawContent).trim();
    if (!title || !diaryContent) return null;

    // A date-as-title ("十月十八日") tells the reader nothing. Prefer a title
    // derived from the body over storing something meaningless.
    const finalTitle = isUsableTitle(title) ? title : deriveFallbackTitle(diaryContent);

    return { title: finalTitle, summary, content: diaryContent };
  } catch (err) {
    console.error("[diary] Failed to parse JSON response:", err);
    return null;
  }
}

export async function generateDiaryForDate(userId: number, date: string): Promise<void> {
  const settings = await findAiSettingsByUserId(userId);
  if (!settings || !settings.diaryApiKey || !settings.diaryApiBaseUrl) {
    throw new Error("Diary model not configured");
  }

  const diary = await findDiaryByDate(userId, date);
  if (!diary) {
    throw new Error("Diary not found");
  }
  if (diary.manuallyEdited) {
    console.log(`[diary] Diary ${diary.id} was manually edited, skipping generation`);
    return;
  }

  try {
    const entries = await findEntriesByDate(userId, date);
    if (entries.length === 0) {
      throw new Error("No entries for this date");
    }

    const style = settings.diaryStyle ?? "温柔真实";
    const length = settings.diaryLength ?? "中";
    const language = settings.diaryLanguage ?? "zh";
    const stylePrompt = getStylePrompt(style, settings.stylePrompts);

    // Split the stored template into system (instructions) and user (data
    // template with placeholders). Three cases:
    //   1. No custom template → use clean defaults for both.
    //   2. Custom template WITH separator (---) → extract each part.
    //   3. Legacy custom template WITHOUT separator → preserve it as the
    //      system prompt (old behavior) and use the default user template.
    const split = settings.diaryPromptTemplate
      ? splitDiaryPrompt(settings.diaryPromptTemplate)
      : null;

    let systemPrompt: string;
    let userPromptTemplate: string;

    if (!split) {
      systemPrompt = DEFAULT_DIARY_SYSTEM_PROMPT;
      userPromptTemplate = DEFAULT_DIARY_USER_TEMPLATE;
    } else if (split.system !== null) {
      systemPrompt = split.system;
      userPromptTemplate = split.user;
    } else {
      systemPrompt = settings.diaryPromptTemplate!;
      userPromptTemplate = DEFAULT_DIARY_USER_TEMPLATE;
    }

    // Load Dream memory (profile + active short-term memories) for prompt
    // injection. Skipped when the user has disabled Dream or no profile
    // exists yet — both resolve to a null memory block.
    let memory: DiaryMemory | null = null;
    if (settings.enableDream !== false) {
      const [profile, shortTermMemories] = await Promise.all([
        findProfileByUserId(userId),
        findActiveShortTermMemories(userId, 5),
      ]);
      if (profile || shortTermMemories.length > 0) {
        memory = {
          profileSummary: profile?.summary ?? null,
          languageStyle: profile?.languageStyle ?? null,
          shortTermMemories,
        };
      }
    }

    const userMessage = buildDiaryUserMessage(
      {
        date,
        language,
        style,
        length,
        stylePrompt,
        fragments: entries,
        memory,
      },
      userPromptTemplate,
    );

    // Dispatch on the configured provider: an OpenAI-compatible endpoint or the
    // WorkBuddy channel. The WorkBuddy credential is stored encrypted, so it is
    // decrypted here, at the point of use.
    const kind = providerKindOf(settings.diaryProvider);
    const content = await complete({
      kind,
      apiKey: settings.diaryApiKey ?? undefined,
      baseUrl: settings.diaryApiBaseUrl ?? undefined,
      model: settings.diaryModel ?? undefined,
      accessToken:
        kind === "workbuddy"
          ? (decryptApiKey(settings.diaryWorkbuddyCredential) ?? undefined)
          : undefined,
      productId: settings.diaryWorkbuddyProduct ?? undefined,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      maxTokens: 2048,
      // Low temperature on purpose: this is a faithful transcription task, not
      // a creative one. Higher values made the model invent scenes, dialogue
      // and props that were never recorded.
      temperature: 0.3,
      timeoutMs: 120_000,
    });

    const parsed = parseDiaryResponse(content);
    if (!parsed) {
      throw new Error("Failed to parse diary response");
    }

    await updateDiary(userId, diary.id, {
      title: parsed.title,
      summary: parsed.summary,
      content: parsed.content,
      style,
      length,
      diaryModelUsed: settings.diaryModel ?? "default",
      generationStatus: "generated",
      generationError: null,
      generatedAt: new Date(),
      manuallyEdited: false,
    });

    // Trigger an async Dream pass to update the user profile based on the
    // newly generated diary + recent history. Fire-and-forget: never blocks
    // or fails the diary generation. Skipped when the user disabled Dream.
    // The in-process guard prevents duplicate Dream passes for the same
    // (userId, date) when regenerate + scheduler race in the same tick.
    if (settings.enableDream !== false) {
      const dreamKey = `${userId}:${date}`;
      if (!dreamInFlight.has(dreamKey)) {
        dreamInFlight.add(dreamKey);
        dreamProfile(userId, date)
          .catch((err) => {
            console.error(`[diary] Dream pass failed for user ${userId} date ${date}:`, err);
          })
          .finally(() => {
            dreamInFlight.delete(dreamKey);
          });
      }
    }

    // Mark entries as included (non-critical)
    try {
      for (const entry of entries) {
        if (!entry.includedInDiary) {
          await updateEntry(userId, entry.id, { includedInDiary: true });
        }
      }
    } catch (err) {
      console.error("[diary] Failed to mark entries as included:", err);
    }
  } catch (err) {
    console.error(`[diary] Generation failed for user ${userId} date ${date}:`, err);
    const safeMessage = sanitizeGenerationError(err);
    if (diary.generationStatus === "pending") {
      await updateDiary(userId, diary.id, {
        generationStatus: "failed",
        generationError: safeMessage,
      });
    }
    throw err;
  }
}
