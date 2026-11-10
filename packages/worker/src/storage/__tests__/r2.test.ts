import { describe, expect, test } from "bun:test";
import { getR2Asset } from "../r2";

describe("R2 asset upgrade compatibility", () => {
  test("reads legacy keys after worker-only upgrades", async () => {
    const keys: string[] = [];
    const legacy = { body: new ReadableStream() };
    const bucket = { get: async (key: string) => {
      keys.push(key);
      return key === "collection/attachments/image~1.png" ? legacy : null;
    } };
    const result = await getR2Asset(bucket as unknown as R2Bucket, "collection/attachments/image~1.png");
    expect(result?.body).toBe(legacy.body);
    expect(keys).toEqual(["collection/attachments/image~~1.png", "collection/attachments/image~1.png"]);
  });
  test("prefers newly published encoded objects", async () => {
    const keys: string[] = [];
    const object = { body: new ReadableStream() };
    const bucket = { get: async (key: string) => { keys.push(key); return object; } };
    expect((await getR2Asset(bucket as unknown as R2Bucket, "collection/attachments/image..png"))?.body).toBe(object.body);
    expect(keys).toEqual(["collection/attachments/image~dd~png"]);
  });
});
