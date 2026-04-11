export function assertInitialPublishConfirmation(params: {
  isUpdate: boolean;
  workerOnly: boolean;
  passwordHash: string;
  forcePublic: boolean;
}): void {
  if (!params.isUpdate && !params.workerOnly && params.passwordHash.length === 0 && !params.forcePublic) {
    throw new Error(
      "Initial publish without a password would make data publicly accessible. " +
      "Re-run with --public to confirm intentional public access.",
    );
  }
}
