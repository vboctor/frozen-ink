export interface GitConfig {
  repoPath: string;
  includeDiffs?: boolean;
}

export interface GitCredentials {
  repoPath: string;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  parents: string[];
}

export interface GitFileChange {
  status: string;
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface GitBranchInfo {
  name: string;
  hash: string;
  isRemote: boolean;
}

export interface GitTagInfo {
  name: string;
  objectHash: string;
  targetHash: string;
  tagger: string;
  date: string;
  subject: string;
  annotated: boolean;
}
