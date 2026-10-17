import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "../middleware";
import {
  findAiSettingsByUserId,
  updateVisionSettings,
  updateDiarySettings,
} from "../queries/ai-settings";
import {
  findPresetsByUserId,
  createPreset,
  updatePreset,
  deletePreset,
} from "../queries/model-presets";
import { testModelConnection } from "../lib/openai";
import { decryptApiKey } from "../lib/crypto";
import { fetchAuthState, loopGetToken, getAccount, buildCredential } from "../lib/workbuddy/auth";
import { ALL_PRODUCTS, PRODUCT_MODELS, productById } from "../lib/workbuddy/product";

export const aiSettingsRouter = createRouter({
  // ── queries ──────────────────────────────────────────────────────

  get: authedQuery.query(async ({ ctx }) => {
    const settings = await findAiSettingsByUserId(ctx.user.id);
    if (!settings) {
      // Return default settings object if none exist yet
      return {
        userId: ctx.user.id,
        enableImageUnderstanding: true,
        diaryGenerationTime: "02:00",
        diaryLanguage: "zh",
        diaryStyle: "温柔真实",
        diaryLength: "中",
        timezone: "Asia/Shanghai",
        visionModel: null,
        visionApiBaseUrl: null,
        visionPromptTemplate: null,
        diaryModel: null,
        diaryApiBaseUrl: null,
        diaryProvider: null,
        diaryWorkbuddyProduct: null,
        diaryPromptTemplate: null,
        stylePrompts: null,
        enableDream: true,
        createdAt: null,
        updatedAt: null,
      };
    }

    // Never expose API keys or the WorkBuddy credential to the frontend. The
    // credential is a bearer token, so leaking it would hand over the account.
    return {
      ...settings,
      visionApiKey: undefined,
      diaryApiKey: undefined,
      diaryWorkbuddyCredential: undefined,
    };
  }),

  // ── mutations ────────────────────────────────────────────────────

  updateVision: authedQuery
    .input(
      z.object({
        visionApiKey: z.string().optional(),
        visionApiBaseUrl: z.string().max(500).optional(),
        visionModel: z.string().max(100).optional(),
        enableImageUnderstanding: z.boolean().optional(),
        visionPromptTemplate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await updateVisionSettings(ctx.user.id, input);
      if (!settings) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update vision settings",
        });
      }
      return {
        ...settings,
        visionApiKey: undefined,
        diaryApiKey: undefined,
      };
    }),

  updateDiary: authedQuery
    .input(
      z.object({
        diaryApiKey: z.string().optional(),
        diaryApiBaseUrl: z.string().max(500).optional(),
        diaryModel: z.string().max(100).optional(),
        diaryProvider: z.enum(["openai-compatible", "workbuddy"]).optional(),
        diaryWorkbuddyProduct: z.string().max(32).optional(),
        diaryGenerationTime: z.string().max(10).optional(),
        diaryLanguage: z.string().max(20).optional(),
        diaryStyle: z.string().max(50).optional(),
        diaryLength: z.string().max(20).optional(),
        diaryPromptTemplate: z.string().optional(),
        stylePrompts: z.string().optional(),
        enableDream: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await updateDiarySettings(ctx.user.id, input);
      if (!settings) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update diary settings",
        });
      }
      return {
        ...settings,
        visionApiKey: undefined,
        diaryApiKey: undefined,
        diaryWorkbuddyCredential: undefined,
      };
    }),

  testVision: authedQuery
    .input(
      z.object({
        apiKey: z.string().min(1),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await testModelConnection({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
        });
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "连接失败: 未知错误",
        });
      }
    }),

  testDiary: authedQuery
    .input(
      z.object({
        apiKey: z.string().min(1),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const result = await testModelConnection({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
        });
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "连接失败: 未知错误",
        });
      }
    }),

  // ── presets ────────────────────────────────────────────────────

  listPresets: authedQuery.query(async ({ ctx }) => {
    const presets = await findPresetsByUserId(ctx.user.id);
    return presets.map((p) => ({ ...p, apiKey: null }));
  }),

  createPreset: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(100),
        type: z.enum(["vision", "diary"]),
        apiBaseUrl: z.string().max(500).optional(),
        apiKey: z.string().optional(),
        model: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preset = await createPreset(ctx.user.id, input);
      return preset ? { ...preset, apiKey: null } : null;
    }),

  updatePreset: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(100).optional(),
        apiBaseUrl: z.string().max(500).optional(),
        apiKey: z.string().optional(),
        model: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const preset = await updatePreset(ctx.user.id, id, data);
      return preset ? { ...preset, apiKey: null } : null;
    }),

  deletePreset: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deletePreset(ctx.user.id, input.id);
      return { success: true };
    }),

  loadPreset: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const presets = await findPresetsByUserId(ctx.user.id);
      const preset = presets.find((p) => p.id === input.id);
      if (!preset) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found" });
      }
      const presetApiKey = decryptApiKey(preset.apiKey);
      if (preset.type === "vision") {
        const settings = await updateVisionSettings(ctx.user.id, {
          visionApiBaseUrl: preset.apiBaseUrl ?? undefined,
          visionApiKey: presetApiKey ?? undefined,
          visionModel: preset.model ?? undefined,
        });
        return { ...settings, visionApiKey: undefined, diaryApiKey: undefined };
      }
      const settings = await updateDiarySettings(ctx.user.id, {
        diaryApiBaseUrl: preset.apiBaseUrl ?? undefined,
        diaryApiKey: presetApiKey ?? undefined,
        diaryModel: preset.model ?? undefined,
      });
      return { ...settings, visionApiKey: undefined, diaryApiKey: undefined };
    }),

  // ── WorkBuddy channel ────────────────────────────────────────────

  /**
   * Step 1 of the WorkBuddy login: obtain a state and the URL the user opens.
   *
   * The flow is polling-based (no local callback server), which is why it can
   * be driven from a server: the client opens the URL, then polls `workbuddyPoll`.
   */
  workbuddyStart: authedQuery
    .input(z.object({ product: z.string().max(32).optional() }))
    .mutation(async ({ input }) => {
      const product = productById(input.product);
      const { state, authUrl } = await fetchAuthState(product);
      return { state, authUrl, product: product.id, displayName: product.displayName };
    }),

  /**
   * Step 2: poll until the browser approval lands, then persist the credential.
   *
   * Blocks for up to the login timeout, so the client should keep the request
   * open rather than firing it in a tight loop.
   */
  workbuddyPoll: authedQuery
    .input(
      z.object({
        state: z.string().min(1),
        product: z.string().max(32).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const product = productById(input.product);
      const token = await loopGetToken(product, input.state);
      const account = await getAccount(product, input.state, token);
      const credential = buildCredential(token, account);

      const settings = await updateDiarySettings(ctx.user.id, {
        diaryProvider: "workbuddy",
        diaryWorkbuddyProduct: product.id,
        diaryWorkbuddyCredential: JSON.stringify(credential),
        // A sensible default the user can change afterwards.
        diaryModel: "deepseek-v4.1-flash",
      });

      return {
        success: true,
        nickname: account.nickname,
        product: product.id,
        // Never echo the credential back.
        diaryProvider: settings?.diaryProvider ?? "workbuddy",
      };
    }),

  /** Sign out of WorkBuddy and fall back to the OpenAI-compatible path. */
  workbuddySignOut: authedQuery.mutation(async ({ ctx }) => {
    await updateDiarySettings(ctx.user.id, {
      diaryProvider: "openai-compatible",
      diaryWorkbuddyCredential: "",
      diaryWorkbuddyProduct: "",
    });
    return { success: true };
  }),

  /** Which products exist and which models each build serves. */
  workbuddyProducts: authedQuery.query(() =>
    ALL_PRODUCTS.map((product) => ({
      id: product.id,
      displayName: product.displayName,
      models: PRODUCT_MODELS[product.id] ?? [],
    })),
  ),
});
