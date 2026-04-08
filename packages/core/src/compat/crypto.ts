import { isBun } from "./runtime";
import { createHash } from "node:crypto";

export interface CryptoHasherLike {
  update(data: string | Buffer): CryptoHasherLike;
  digest(encoding: "hex"): string;
}

/**
 * Create a hash instance compatible with both Bun and Node.js.
 * Under Bun, uses Bun.CryptoHasher for performance.
 * Under Node.js/Electron, uses node:crypto.
 */
export function createCryptoHasher(algorithm: string): CryptoHasherLike {
  if (isBun) {
    const hasher = new Bun.CryptoHasher(algorithm as any);
    return {
      update(data: string | Buffer) {
        hasher.update(data);
        return this;
      },
      digest(encoding: "hex") {
        return hasher.digest(encoding) as string;
      },
    };
  }
  const h = createHash(algorithm);
  return {
    update(data: string | Buffer) {
      h.update(data);
      return this;
    },
    digest(encoding: "hex") {
      return h.digest(encoding);
    },
  };
}
