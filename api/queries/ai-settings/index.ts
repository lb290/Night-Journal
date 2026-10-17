import { eq } from "drizzle-orm";
import { getDb } from "../connection";
import { aiSettings } from "@db/schema";
import type { InsertAiSettings } from "@db/schema";
import { decryptApiKey, encryptApiKey } from "../../lib/crypto";

function decryptSettingsFields<
  T extends {
    visionApiKey?: string | null;
    diaryApiKey?: string | null;
    diaryWorkbuddyCredential?: string | null;
  },
>(settings: T | undefined): T | undefined {
  if (!settings) return undefined;
  return {
    ...settings,
    visionApiKey: decryptApiKey(settings.visionApiKey),
    diaryApiKey: decryptApiKey(settings.diaryApiKey),
    // The WorkBuddy credential is a bearer token; it gets the same at-rest
    // treatment as an API key.
    diaryWorkbuddyCredential: decryptApiKey(settings.diaryWorkbuddyCredential),
  };
}

function encryptSettingsData(
  data: Partial<InsertAiSettings>,
): Partial<InsertAiSettings> {
  const encrypted = { ...data };
  if ("visionApiKey" in data && data.visionApiKey !== undefined) {
    encrypted.visionApiKey = encryptApiKey(data.visionApiKey) ?? null;
  }
  if ("diaryApiKey" in data && data.diaryApiKey !== undefined) {
    encrypted.diaryApiKey = encryptApiKey(data.diaryApiKey) ?? null;
  }
  if ("diaryWorkbuddyCredential" in data && data.diaryWorkbuddyCredential !== undefined) {
    encrypted.diaryWorkbuddyCredential =
      encryptApiKey(data.diaryWorkbuddyCredential) ?? null;
  }
  return encrypted;
}

export async function findAiSettingsByUserId(userId: number) {
  const rows = await getDb()
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.userId, userId))
    .limit(1);
  return decryptSettingsFields(rows.at(0));
}

export async function upsertAiSettings(
  userId: number,
  data: Partial<Omit<InsertAiSettings, "id" | "userId" | "createdAt" | "updatedAt">>,
) {
  const db = getDb();
  const encrypted = encryptSettingsData(data as Partial<InsertAiSettings>);

  const existing = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.userId, userId),
  });

  if (existing) {
    await db
      .update(aiSettings)
      .set(encrypted)
      .where(eq(aiSettings.userId, userId));
    return findAiSettingsByUserId(userId);
  }

  const [{ id }] = await db
    .insert(aiSettings)
    .values({
      userId,
      ...encrypted,
    } as InsertAiSettings)
    .$returningId();

  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.id, id),
  });
  return decryptSettingsFields(settings);
}

export async function updateVisionSettings(
  userId: number,
  data: {
    visionApiKey?: string;
    visionApiBaseUrl?: string;
    visionModel?: string;
    enableImageUnderstanding?: boolean;
    visionPromptTemplate?: string;
  },
) {
  return upsertAiSettings(userId, data);
}

export async function updateDiarySettings(
  userId: number,
  data: {
    diaryApiKey?: string;
    diaryApiBaseUrl?: string;
    diaryModel?: string;
    /** "openai-compatible" | "workbuddy"; null/absent keeps the default. */
    diaryProvider?: string;
    /** WorkBuddy regional build id. */
    diaryWorkbuddyProduct?: string;
    /** Serialized WorkBuddy credential; encrypted at rest. */
    diaryWorkbuddyCredential?: string;
    diaryGenerationTime?: string;
    diaryLanguage?: string;
    diaryStyle?: string;
    diaryLength?: string;
    diaryPromptTemplate?: string;
    stylePrompts?: string;
    enableDream?: boolean;
  },
) {
  return upsertAiSettings(userId, data);
}
