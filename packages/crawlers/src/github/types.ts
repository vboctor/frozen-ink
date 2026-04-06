export interface GitHubConfig {
  owner: string;
  repo: string;
  syncIssues?: boolean;
  syncPullRequests?: boolean;
  syncComments?: boolean;
  syncCheckStatuses?: boolean;
  /** When true, only syncs open issues/PRs and deletes previously synced closed ones. */
  openOnly?: boolean;
  /** Maximum total entities to sync across all types (useful for testing). */
  maxEntities?: number;
  /** Maximum number of issues to sync. */
  maxIssues?: number;
  /** Maximum number of pull requests to sync. */
  maxPullRequests?: number;
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

export interface GitHubReactions {
  total_count: number;
  "+1": number;
  "-1": number;
  laugh: number;
  hooray: number;
  confused: number;
  heart: number;
  rocket: number;
  eyes: number;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  reactions?: GitHubReactions;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser | null;
  state: string; // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  body: string | null;
  submitted_at: string;
  html_url: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped"
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null; // "completed" | "not_planned" | "reopened" | null
  html_url: string;
  user: GitHubUser | null;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  reactions?: GitHubReactions;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: { url: string };
  comments: number; // comment count
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
  reactions?: GitHubReactions;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number; // comment count
}

/** Full user profile from GET /users/:login */
export interface GitHubUserProfile {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  bio: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}
