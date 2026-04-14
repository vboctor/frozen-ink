export interface MantisHubUser {
  id: number;
  name: string;
  real_name?: string;
  email?: string;
  avatar?: {
    tag?: string;
    attr?: { src?: string };
  };
}

export interface MantisHubProject {
  id: number;
  name: string;
  description?: string;
  status?: { id: number; name: string; label: string };
}

/** Entity types that can be synced for a MantisHub collection. */
export type MantisHubEntityType = "issues" | "pages" | "users";

export interface MantisHubConfig {
  url: string;
  project?: { id?: number; name?: string };
  maxEntities?: number;
  /**
   * Entity types to synchronize. Defaults to all applicable types when omitted.
   * "pages" is only available on MantisHub instances.
   */
  entities?: MantisHubEntityType[];
}

export interface MantisHubCredentials {
  token: string;
}

/** A wiki page from MantisHub Pages plugin (via ApiX update endpoint). */
export interface MantisHubPage {
  id: number;
  name: string;
  title: string;
  project: { id: number; name: string };
  issue_id: number;
  created_by: { id: number; name: string; real_name?: string; email?: string; avatar?: string };
  created_at: { timestamp: string };
  updated_by: { id: number; name: string; real_name?: string; email?: string; avatar?: string };
  updated_at: { timestamp: string };
  content: string;
}

/** A file attachment on a MantisHub wiki page. */
export interface MantisHubPageFile {
  id: number;
  page_id: number;
  name: string;
  size: number;
  content_type: string;
  created_at: { timestamp: string };
  download_url: string;
}

export interface MantisHubIssue {
  id: number;
  summary: string;
  description: string;
  steps_to_reproduce?: string;
  additional_information?: string;
  sticky: boolean;
  created_at: string;
  updated_at: string;
  project: { id: number; name: string };
  category?: { id: number; name: string };
  reporter?: { id: number; name: string; email?: string };
  handler?: { id: number; name: string; email?: string };
  status: { id: number; name: string; label: string; color?: string };
  resolution: { id: number; name: string; label: string };
  view_state?: { id: number; name: string; label: string };
  priority: { id: number; name: string; label: string };
  severity: { id: number; name: string; label: string };
  reproducibility?: { id: number; name: string; label: string };
  tags?: Array<{ id: number; name: string }>;
  /** Issue-level file attachments (returned as "attachments" by the REST API). */
  attachments?: Array<{
    id: number;
    filename: string;
    content_type: string;
    size: number;
    download_url?: string;
    description?: string;
  }>;
  notes?: Array<{
    id: number;
    reporter: { id: number; name: string; real_name?: string; email?: string };
    text: string;
    view_state?: { id: number; name: string; label: string };
    type?: string;
    created_at: string;
    updated_at: string;
    attachments?: Array<{
      id: number;
      reporter?: { id: number; name: string; real_name?: string };
      filename: string;
      content_type: string;
      size: number;
      created_at?: string;
      download_url?: string;
    }>;
  }>;
  relationships?: Array<{
    id: number;
    type: { id: number; name: string; label: string };
    issue: { id: number; summary?: string };
  }>;
  history?: Array<{
    created_at: string;
    user: { id: number; name: string };
    type: { id: number; name: string };
    message: string;
    field?: { name: string; old_value: string; new_value: string };
  }>;
  custom_fields?: Array<{
    field: { id: number; name: string };
    value: string;
  }>;
}
