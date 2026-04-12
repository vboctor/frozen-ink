import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface WorkspaceEntry {
  name: string;
  path: string;
  lastOpened: string;
}

export interface WorkspacesData {
  workspaces: WorkspaceEntry[];
  lastWorkspace: string | null;
}

const WORKSPACES_DIR = join(homedir(), ".frozenink");
const WORKSPACES_FILE = join(WORKSPACES_DIR, "workspaces.json");

function ensureDir() {
  mkdirSync(WORKSPACES_DIR, { recursive: true });
}

export function loadWorkspaces(): WorkspacesData {
  ensureDir();
  if (!existsSync(WORKSPACES_FILE)) {
    return { workspaces: [], lastWorkspace: null };
  }
  return JSON.parse(readFileSync(WORKSPACES_FILE, "utf-8"));
}

function saveWorkspaces(data: WorkspacesData): void {
  ensureDir();
  writeFileSync(WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export function createWorkspace(name: string, dirPath: string): void {
  // Ensure the workspace directory exists with proper structure
  mkdirSync(join(dirPath, "collections"), { recursive: true });

  // Collections directory is created above — no separate context file needed.
  // Collection metadata is stored in per-collection .config files.

  // Create initial frozenink.yml if it doesn't exist
  const configPath = join(dirPath, "frozenink.yml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, "", "utf-8");
  }

  // Register in workspaces
  const data = loadWorkspaces();
  const existing = data.workspaces.find((w) => w.path === dirPath);
  if (existing) {
    existing.name = name;
    existing.lastOpened = new Date().toISOString();
  } else {
    data.workspaces.push({ name, path: dirPath, lastOpened: new Date().toISOString() });
  }
  data.lastWorkspace = dirPath;
  saveWorkspaces(data);
}

export function openWorkspace(dirPath: string): void {
  const data = loadWorkspaces();
  const existing = data.workspaces.find((w) => w.path === dirPath);
  if (existing) {
    existing.lastOpened = new Date().toISOString();
  } else {
    const name = dirPath.split("/").pop() ?? "Workspace";
    data.workspaces.push({ name, path: dirPath, lastOpened: new Date().toISOString() });
  }
  data.lastWorkspace = dirPath;
  saveWorkspaces(data);
}

export function listRecentWorkspaces(): WorkspaceEntry[] {
  const data = loadWorkspaces();
  return data.workspaces
    .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime());
}

export function getLastWorkspace(): string | null {
  const data = loadWorkspaces();
  return data.lastWorkspace;
}
