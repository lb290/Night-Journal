/**
 * Tests for entries.reanalyzeVision — the on-demand re-run of image
 * understanding for an entry's attachments.
 *
 * Strategy: mock the DB query layer, the model call and the file reader, then
 * drive the router through createCallerFactory. Vision itself is
 * fire-and-forget, so the assertions use vi.waitFor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@db/schema";

vi.mock("../lib/env", () => ({
  env: {
    appSecret: "test-secret-that-is-long-enough-32c",
    databaseUrl: "mysql://root:pw@localhost/db",
    isProduction: false,
    ownerUnionId: "",
  },
}));

vi.mock("../queries/entries", () => ({
  findEntriesByDate: vi.fn(),
  findEntriesByMonth: vi.fn(),
  findEntryById: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  softDeleteEntry: vi.fn(),
  createAttachment: vi.fn(),
  updateAttachmentVision: vi.fn(),
  findAttachmentsByEntryId: vi.fn(),
}));

vi.mock("../queries/ai-settings", () => ({
  findAiSettingsByUserId: vi.fn(),
}));

vi.mock("../lib/openai", () => ({
  callVisionModel: vi.fn(),
}));

vi.mock("../lib/upload", () => ({
  readFileAsBase64: vi.fn(),
}));

import {
  findEntryById,
  findAttachmentsByEntryId,
  updateAttachmentVision,
} from "../queries/entries";
import { findAiSettingsByUserId } from "../queries/ai-settings";
import { callVisionModel } from "../lib/openai";
import { readFileAsBase64 } from "../lib/upload";
import { entriesRouter } from "./entries";
import type { TrpcContext } from "../context";

function makeUser(id: number): User {
  return {
    id,
    unionId: `uid_${id}`,
    username: null,
    passwordHash: null,
    name: "Test User",
    email: null,
    avatar: null,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  };
}

function makeCtx(user: User): TrpcContext {
  return {
    req: new Request("http://localhost"),
    resHeaders: new Headers(),
    user,
  };
}

const attachment = {
  id: 7,
  entryId: 42,
  userId: 1,
  fileUrl: "/api/uploads/1/a.jpg",
  storagePath: "1/a.jpg",
  fileType: "image/jpeg",
  fileName: "a.jpg",
  visionStatus: "failed",
  visionSummary: null,
  visionModelUsed: null,
  visionContextSnapshot: null,
};

const configuredVision = {
  enableImageUnderstanding: true,
  visionApiKey: "enc:key",
  visionApiBaseUrl: "https://api.example.com",
  visionModel: "vision-model",
  visionPromptTemplate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFileAsBase64).mockReturnValue("BASE64");
  vi.mocked(callVisionModel).mockResolvedValue(
    JSON.stringify({ usable_diary_material: "一张画" }),
  );
});

describe("entries.reanalyzeVision", () => {
  const user = makeUser(1);
  const caller = entriesRouter.createCaller(makeCtx(user));

  it("throws NOT_FOUND for an entry that is not the caller's", async () => {
    vi.mocked(findEntryById).mockResolvedValue(undefined);

    await expect(caller.reanalyzeVision({ entryId: 42 })).rejects.toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(findAttachmentsByEntryId).not.toHaveBeenCalled();
  });

  it("throws BAD_REQUEST when the entry has no images", async () => {
    vi.mocked(findEntryById).mockResolvedValue({
      id: 42,
      userId: 1,
      contentText: "文字碎片",
    } as never);
    vi.mocked(findAttachmentsByEntryId).mockResolvedValue([]);

    await expect(caller.reanalyzeVision({ entryId: 42 })).rejects.toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
    expect(updateAttachmentVision).not.toHaveBeenCalled();
  });

  it("throws PRECONDITION_FAILED when no vision model is configured", async () => {
    vi.mocked(findEntryById).mockResolvedValue({
      id: 42,
      userId: 1,
      contentText: "文字碎片",
    } as never);
    vi.mocked(findAttachmentsByEntryId).mockResolvedValue([attachment] as never);
    vi.mocked(findAiSettingsByUserId).mockResolvedValue({
      ...configuredVision,
      visionApiKey: null,
    } as never);

    await expect(caller.reanalyzeVision({ entryId: 42 })).rejects.toThrow(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
    // Nothing may be flipped to pending if we are not going to run.
    expect(updateAttachmentVision).not.toHaveBeenCalled();
    expect(callVisionModel).not.toHaveBeenCalled();
  });

  it("marks attachments pending, then actually re-runs the analysis", async () => {
    vi.mocked(findEntryById).mockResolvedValue({
      id: 42,
      userId: 1,
      contentText: "同学要我给他画一幅画",
    } as never);
    vi.mocked(findAttachmentsByEntryId).mockResolvedValue([attachment] as never);
    vi.mocked(findAiSettingsByUserId).mockResolvedValue(configuredVision as never);

    const result = await caller.reanalyzeVision({ entryId: 42 });

    expect(result).toEqual({ success: true, count: 1 });
    expect(updateAttachmentVision).toHaveBeenCalledWith(7, {
      visionStatus: "pending",
    });

    await vi.waitFor(() => {
      expect(callVisionModel).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(updateAttachmentVision).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          visionStatus: "completed",
          visionSummary: "一张画",
          visionContextSnapshot: "同学要我给他画一幅画",
        }),
      );
    });
  });
});
