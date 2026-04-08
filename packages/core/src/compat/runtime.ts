/** Runtime detection: true when running under Bun, false under Node.js / Electron. */
export const isBun = typeof globalThis.Bun !== "undefined";
