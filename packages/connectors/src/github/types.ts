export interface GitHubConfig {
  owner: string;
  repo: string;
  syncIssues?: boolean;
  syncPullRequests?: boolean;
}

export interface GitHubCredentials {
  token: string;
  owner: string;
  repo: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubMilestone {
  title: string;
  number: number;
  state: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: GitHubUser | null;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: { url: string };
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: GitHubUser | null;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  merged: boolean;
  merged_at: string | null;
  draft: boolean;
  review_comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}
