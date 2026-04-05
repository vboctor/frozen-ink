import type { VeeContextConfig } from "./schema";

export const defaultConfig: VeeContextConfig = {
  db: {
    mode: "local",
    tursoUrl: undefined,
    tursoToken: undefined,
  },
  storage: {
    mode: "local",
    s3Bucket: undefined,
    s3Region: undefined,
    s3Endpoint: undefined,
    s3AccessKeyId: undefined,
    s3SecretAccessKey: undefined,
  },
  sync: {
    interval: 900,
    concurrency: 2,
    retries: 3,
  },
  ui: {
    port: 3000,
  },
  mcp: {
    transport: "stdio",
    port: 3001,
  },
  logging: {
    level: "info",
    file: undefined,
  },
};
