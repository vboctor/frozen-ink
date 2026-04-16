import { join } from "path";
import { unlinkSync } from "fs";
import { getFrozenInkHome } from "./loader";
import { atomicWriteYaml, readYaml } from "./yaml-utils";

type CredentialSet = Record<string, unknown>;
type CredentialsStore = Record<string, CredentialSet>;

function getCredentialsPath(): string {
  return join(getFrozenInkHome(), "credentials.yml");
}

export function loadCredentials(): CredentialsStore {
  return readYaml<CredentialsStore>(getCredentialsPath()) ?? {};
}

export function getNamedCredentials(name: string): CredentialSet | null {
  const store = loadCredentials();
  return store[name] ?? null;
}

export function saveNamedCredentials(name: string, creds: CredentialSet): void {
  const store = loadCredentials();
  store[name] = creds;
  atomicWriteYaml(getCredentialsPath(), store);
}

export function removeNamedCredentials(name: string): void {
  const store = loadCredentials();
  if (!(name in store)) return;
  delete store[name];
  if (Object.keys(store).length === 0) {
    try { unlinkSync(getCredentialsPath()); } catch { /* ignore */ }
  } else {
    atomicWriteYaml(getCredentialsPath(), store);
  }
}

export function listNamedCredentials(): string[] {
  return Object.keys(loadCredentials());
}

/**
 * Resolve the `credentials` field from a collection entry.
 * - If it's a string, look it up in credentials.yml by name.
 * - If it's an object, return it as-is (backward compat).
 */
export function resolveCredentials(
  credentialsField: string | CredentialSet,
): CredentialSet {
  if (typeof credentialsField === "string") {
    const creds = getNamedCredentials(credentialsField);
    if (!creds) {
      const credPath = join(getFrozenInkHome(), "credentials.yml");
      throw new Error(
        `Unknown credential set: "${credentialsField}". Define it in ${credPath}`,
      );
    }
    return creds;
  }
  return credentialsField;
}
