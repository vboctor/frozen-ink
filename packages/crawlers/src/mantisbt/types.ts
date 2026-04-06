export interface MantisBTConfig {
  baseUrl: string;
  projectId?: number;
  maxEntities?: number;
}

export interface MantisBTCredentials {
  token: string;
}

export interface MantisBTIssue {
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
  /** Issue-level file attachments. */
  files?: Array<{
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
}
