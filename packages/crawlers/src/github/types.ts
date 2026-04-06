export interface GitHubConfig {
  owner: string;
  repo: string;
  syncIssues?: boolean;
  syncPullRequests?: boolean;
  syncComments?: boolean;
  syncCheckStatuses?: boolean;
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
