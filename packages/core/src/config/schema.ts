import { z } from "zod";

export const syncConfigSchema = z.object({
  interval: z.number().int().positive().default(900),
});

export const uiConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
});

export const configSchema = z.object({
  sync: syncConfigSchema.default({}),
  ui: uiConfigSchema.default({}),
});

export type FrozenInkConfig = z.infer<typeof configSchema>;
export type SyncConfig = z.infer<typeof syncConfigSchema>;
export type UiConfig = z.infer<typeof uiConfigSchema>;
