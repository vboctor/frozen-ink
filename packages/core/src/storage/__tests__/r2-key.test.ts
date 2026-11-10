import { describe, expect, test } from "bun:test";
import { toR2SafeKey } from "../r2-key";

describe("toR2SafeKey", () => {
  test("rewrites traversal-like dot pairs inside a filename", () => {
    expect(toR2SafeKey("mantisbt/content/issues/assets/2709-mantis bugnote..JPG"))
      .toBe("mantisbt/content/issues/assets/2709-mantis bugnote~dd~JPG");
  });

  test("escapes existing tildes to avoid collisions", () => {
    expect(toR2SafeKey("files/name~dd~JPG")).toBe("files/name~~dd~~JPG");
  });

  test("leaves ordinary keys unchanged", () => {
    expect(toR2SafeKey("mantisbt/content/issues/assets/image.jpg"))
      .toBe("mantisbt/content/issues/assets/image.jpg");
  });
});
