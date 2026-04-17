/**
 * Pure helper for resolving HTTP MCP connection parameters.
 * Kept in a separate file so it can be unit-tested without module mocking:
 * callers inject the @frozenink/core functions they need.
 */
export interface PublishStateView {
  mcpUrl: string;
  protected?: boolean;
}

export interface CredentialView {
  password?: unknown;
}

export function resolveHttpParams(
  collectionName: string,
  providedPassword: string | undefined,
  getPublishState: (name: string) => PublishStateView | null,
  getCredentials: (name: string) => CredentialView | null,
  credentialKey: string,
): { httpUrl: string; bearerToken?: string } {
  const publishState = getPublishState(collectionName);
  if (!publishState) {
    throw new Error(
      `Collection "${collectionName}" is not published. Run \`fink publish ${collectionName}\` before linking HTTP MCP.`,
    );
  }
  const httpUrl = publishState.mcpUrl;
  const trimmed = providedPassword?.trim();
  if (trimmed) {
    return { httpUrl, bearerToken: trimmed };
  }

  const stored = getCredentials(credentialKey);
  const storedPassword = typeof stored?.password === "string" ? stored.password : "";
  if (storedPassword) {
    return { httpUrl, bearerToken: storedPassword };
  }

  if (publishState.protected) {
    throw new Error(
      `Collection "${collectionName}" is password protected but no password is stored locally. ` +
      "Pass --password <value> or re-publish with --password to record it.",
    );
  }

  return { httpUrl };
}
