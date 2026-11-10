import { describe, expect, test } from "bun:test";
import { encodeR2ObjectKey, shouldRetryR2UploadWithWrangler } from "../wrangler-api";

describe("encodeR2ObjectKey", () => {
  test("preserves path separators and encodes reserved characters in each segment", () => {
    expect(encodeR2ObjectKey("mantisbt/content/issues/assets/2709-mantis bugnote..JPG"))
      .toBe("mantisbt/content/issues/assets/2709-mantis%20bugnote..JPG");
  });
});

describe("shouldRetryR2UploadWithWrangler", () => {
  test("recognizes an edge-generated HTML 403", () => {
    expect(shouldRetryR2UploadWithWrangler(403, "<!DOCTYPE html><html><body>Forbidden</body></html>"))
      .toBe(true);
  });

  test("leaves normal API errors unchanged", () => {
    expect(shouldRetryR2UploadWithWrangler(403, '{"errors":[{"message":"forbidden"}]}'))
      .toBe(false);
    expect(shouldRetryR2UploadWithWrangler(500, "<html>Server error</html>"))
      .toBe(false);
  });
});
