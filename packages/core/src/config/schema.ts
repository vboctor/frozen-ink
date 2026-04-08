import { z } from "zod";

export const dbConfigSchema = z.object({
  mode: z.enum(["local", "turso"]).default("local"),
  tursoUrl: z.string().url().optional(),
  tursoToken: z.string().optional(),
});

export const storageConfigSchema = z.object({
  mode: z.enum(["local", "s3"]).default("local"),
  s3Bucket: z.string().optional(),
  s3Region: z.string().optional(),
  s3Endpoint: z.string().url().optional(),
  s3AccessKeyId: z.string().optional(),
  s3SecretAccessKey: z.string().optional(),
});

export const syncConfigSchema = z.object({
  interval: z.number().int().positive().default(900),
  concurrency: z.number().int().positive().default(2),
  retries: z.number().int().nonnegative().default(3),
});

export const uiConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
});

export const mcpConfigSchema = z.object({
  transport: z.enum(["stdio", "sse"]).default("stdio"),
  port: z.number().int().positive().default(3001),
});

export const loggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  file: z.string().optional(),
});

export const configSchema = z.object({
  db: dbConfigSchema.default({}),
  storage: storageConfigSchema.default({}),
  sync: syncConfigSchema.default({}),
  ui: uiConfigSchema.default({}),
  mcp: mcpConfigSchema.default({}),
  logging: loggingConfigSchema.default({}),
});

export type FrozenInkConfig = z.infer<typeof configSchema>;
export type DbConfig = z.infer<typeof dbConfigSchema>;
export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type SyncConfig = z.infer<typeof syncConfigSchema>;
export type UiConfig = z.infer<typeof uiConfigSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type LoggingConfig = z.infer<typeof loggingConfigSchema>;
