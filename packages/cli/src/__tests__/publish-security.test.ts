import { describe, expect, it } from "bun:test";
import { assertInitialPublishConfirmation } from "../commands/publish-policy";

describe("publish security policy", () => {
  it("rejects initial public publish without explicit confirmation", () => {
    expect(() =>
      assertInitialPublishConfirmation({
        isUpdate: false,
        workerOnly: false,
        passwordHash: "",
        forcePublic: false,
      }),
    ).toThrow("publicly accessible");
  });

  it("allows initial public publish with explicit forcePublic", () => {
    expect(() =>
      assertInitialPublishConfirmation({
        isUpdate: false,
        workerOnly: false,
        passwordHash: "",
        forcePublic: true,
      }),
    ).not.toThrow();
  });

  it("allows initial publish when password protection is set", () => {
    expect(() =>
      assertInitialPublishConfirmation({
        isUpdate: false,
        workerOnly: false,
        passwordHash: "salt:hash",
        forcePublic: false,
      }),
    ).not.toThrow();
  });

  it("does not require forcePublic for updates", () => {
    expect(() =>
      assertInitialPublishConfirmation({
        isUpdate: true,
        workerOnly: false,
        passwordHash: "",
        forcePublic: false,
      }),
    ).not.toThrow();
  });
});
