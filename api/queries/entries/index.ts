import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { getDb } from "../connection";
import { entries, entryAttachments } from "@db/schema";
import { monthRange, toDateColumnValue } from "../../lib/date";
import { deleteStoredFiles } from "../../lib/upload";

// ─── Entries ───────────────────────────────────────────────────────

export async function findEntriesByDate(userId: number, date: string) {
  const db = getDb();
  const userEntries = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        // Bind the calendar day as a "YYYY-MM-DD" string: DATE columns carry no
        // timezone, and passing a Date lets the driver shift it by the server's
        // UTC offset (UTC+8 turned 2026-10-17 into 2026-10-17 08:00:00, matching
        // nothing).
        sql`${entries.entryDate} = ${toDateColumnValue(date)}`,
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(desc(entries.createdAt));

  // Fetch attachments for each entry
  const entriesWithAttachments = await Promise.all(
    userEntries.map(async (entry) => {
      const attachments = await db
        .select()
        .from(entryAttachments)
        .where(eq(entryAttachments.entryId, entry.id));
      return { ...entry, attachments };
    }),
  );

  return entriesWithAttachments;
}

export async function findEntryById(userId: number, entryId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.id, entryId),
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
      ),
    )
    .limit(1);
  return rows.at(0);
}

export async function createEntry(
  userId: number,
  data: { contentText: string; moodLabel?: string; entryDate: string },
) {
  const db = getDb();
  const [{ id }] = await db
    .insert(entries)
    .values({
      userId,
      contentText: data.contentText,
      moodLabel: data.moodLabel,
      entryDate: new Date(data.entryDate),
    })
    .$returningId();

  const entry = await db.query.entries.findFirst({
    where: eq(entries.id, id),
  });
  return entry;
}

export async function updateEntry(
  userId: number,
  entryId: number,
  data: { contentText?: string; moodLabel?: string; entryDate?: string; includedInDiary?: boolean },
) {
  const db = getDb();

  const updateData: Record<string, unknown> = {};
  if (data.contentText !== undefined) updateData.contentText = data.contentText;
  if (data.moodLabel !== undefined) updateData.moodLabel = data.moodLabel;
  if (data.entryDate !== undefined) updateData.entryDate = new Date(data.entryDate);
  if (data.includedInDiary !== undefined) updateData.includedInDiary = data.includedInDiary;

  await db
    .update(entries)
    .set(updateData)
    .where(
      and(
        eq(entries.id, entryId),
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
      ),
    );

  return findEntryById(userId, entryId);
}

export async function findEntriesByMonth(userId: number, year: number, month: number) {
  const db = getDb();
  // Month bounds as DATE-column strings — local-midnight Date objects shift by
  // the server's UTC offset and drift outside the requested month.
  const { start: startDate, end: endDate } = monthRange(year, month);

  const userEntries = await db
    .select({
      id: entries.id,
      userId: entries.userId,
      contentText: entries.contentText,
      moodLabel: entries.moodLabel,
      createdAt: entries.createdAt,
      updatedAt: entries.updatedAt,
      entryDate: entries.entryDate,
      hasImages: entries.hasImages,
      includedInDiary: entries.includedInDiary,
      deletedAt: entries.deletedAt,
    })
    .from(entries)
    .where(
      and(
        eq(entries.userId, userId),
        sql`${entries.entryDate} >= ${startDate}`,
        sql`${entries.entryDate} < ${endDate}`,
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(desc(entries.entryDate));

  return userEntries;
}

/**
 * Soft-delete an entry and drop its image files from disk.
 *
 * The row is kept (`deletedAt`) so the deletion is reversible at the data
 * level, but the uploaded photos are removed: nothing in the app can restore a
 * deleted entry, so keeping multi-megabyte files around forever only grows the
 * upload directory. Files are only unlinked after the row update succeeds.
 */
export async function softDeleteEntry(userId: number, entryId: number) {
  const db = getDb();

  // Read the attachment paths *before* updating, scoped to this user so a
  // crafted entryId can never reach another user's files.
  const attachments = await db
    .select({
      storagePath: entryAttachments.storagePath,
      thumbStoragePath: entryAttachments.thumbStoragePath,
    })
    .from(entryAttachments)
    .innerJoin(entries, eq(entryAttachments.entryId, entries.id))
    .where(
      and(
        eq(entryAttachments.entryId, entryId),
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
      ),
    );

  await db
    .update(entries)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(entries.id, entryId),
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
      ),
    );

  for (const att of attachments) {
    deleteStoredFiles(att.storagePath, att.thumbStoragePath);
  }
}

// ─── Entry Attachments ─────────────────────────────────────────────

export async function findAttachmentsByEntryId(entryId: number) {
  return getDb()
    .select()
    .from(entryAttachments)
    .where(eq(entryAttachments.entryId, entryId));
}

function isValidStoragePath(userId: number, storagePath: string): boolean {
  // Prevent path traversal and cross-user access
  // storagePath must be either "<userId>/<fileName>" or
  // "<userId>/thumb/<fileName>" (derived previews live in a subfolder).
  if (storagePath.includes("..") || storagePath.includes("\\")) {
    return false;
  }
  if (storagePath.startsWith("/")) return false;
  const parts = storagePath.split("/");
  if (parts.length !== 2 && parts.length !== 3) return false;
  const [first, second, third] = parts;
  if (first !== String(userId)) return false;
  if (!second || second.includes("/") || second.includes("\\")) return false;
  if (parts.length === 3) {
    if (second !== "thumb") return false;
    if (!third || third.includes("/") || third.includes("\\")) return false;
  }
  return true;
}

function isValidAttachmentFileUrl(
  storagePath: string,
  fileUrl: string,
): boolean {
  // Local file URLs are derived from the storage path; reject crafted URLs
  if (!fileUrl.startsWith("/api/uploads/")) return false;
  const suffix = fileUrl.slice("/api/uploads/".length);
  return suffix === storagePath && !suffix.includes("..") && !suffix.includes("\\");
}

export async function createAttachment(
  userId: number,
  entryId: number,
  data: {
    fileUrl: string;
    fileType: string;
    fileName: string;
    storagePath: string;
    thumbStoragePath?: string | null;
    fileSize?: number | null;
  },
) {
  if (!isValidStoragePath(userId, data.storagePath)) {
    throw new Error("Invalid attachment storage path");
  }
  if (!isValidAttachmentFileUrl(data.storagePath, data.fileUrl)) {
    throw new Error("Invalid attachment file URL");
  }
  if (data.fileName.includes("..") || data.fileName.includes("/") || data.fileName.includes("\\")) {
    throw new Error("Invalid attachment file name");
  }
  if (data.thumbStoragePath) {
    if (!isValidStoragePath(userId, data.thumbStoragePath)) {
      throw new Error("Invalid thumbnail storage path");
    }
    // The thumbnail must sit next to its image, not anywhere else in the tree
    const thumbName = data.thumbStoragePath.split("/")[2];
    const mainName = data.storagePath.split("/").pop();
    if (thumbName !== mainName) {
      throw new Error("Thumbnail does not match attachment");
    }
  }

  const db = getDb();
  const [{ id }] = await db
    .insert(entryAttachments)
    .values({
      entryId,
      userId,
      fileUrl: data.fileUrl,
      fileType: data.fileType,
      fileName: data.fileName,
      storagePath: data.storagePath,
      thumbStoragePath: data.thumbStoragePath ?? null,
      fileSize: data.fileSize ?? null,
    })
    .$returningId();

  // Mark entry as having images
  await db
    .update(entries)
    .set({ hasImages: true })
    .where(eq(entries.id, entryId));

  const attachment = await db.query.entryAttachments.findFirst({
    where: eq(entryAttachments.id, id),
  });
  return attachment;
}

export async function updateAttachmentVision(
  attachmentId: number,
  data: {
    visionStatus: string;
    visionSummary?: string;
    visionModelUsed?: string;
    visionContextSnapshot?: string;
  },
) {
  await getDb()
    .update(entryAttachments)
    .set(data)
    .where(eq(entryAttachments.id, attachmentId));
}
