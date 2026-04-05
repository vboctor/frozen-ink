import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./packages/core/src/db/master-schema.ts",
    "./packages/core/src/db/collection-schema.ts",
  ],
  out: "./drizzle",
});
