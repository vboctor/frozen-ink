/**
 * The plaintext publish password for a collection lives in credentials.yml
 * under a deterministic key, so re-publish and MCP HTTP linking can recover it
 * without prompting.
 */
export function getPublishCredentialKey(collectionName: string): string {
  return `publish-${collectionName}`;
}
