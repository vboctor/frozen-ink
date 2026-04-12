import type { FrozenInkConfig } from "./schema";

export const defaultConfig: FrozenInkConfig = {
  sync: {
    interval: 900,
  },
  ui: {
    port: 3000,
  },
};
