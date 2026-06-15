export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'closed';
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'bug' | 'vulnerability' | 'task' | 'feature' | 'story' | 'epic';
  severity: number; // 0-10
  assignee: string;
  reporter: string;
  tags: string[];
  linkedFindings: string[]; // IDs from existing detected_issues/open_issues
  storyPoints?: number;
  dueDate?: string;
  slaDeadline?: string;
  isOverdue?: boolean;
  epicLink?: string;
  sprintId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  jiraKey?: string;
  jiraId?: string;
  jiraSyncedAt?: string;
  jiraSyncStatus?: 'synced' | 'error';
  links?: TicketLink[];
}

export type TicketLinkType = 'blocks' | 'blocked_by' | 'relates_to';

export interface TicketLink {
  ticketId: string;
  type: TicketLinkType;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  body: string;
  author: string;
  createdAt: string;
}

export interface TicketActivity {
  id: string;
  ticketId: string;
  actor: string;
  type: 'status_change' | 'priority_change' | 'assignee_change' | 'created' | 'comment_added';
  details: {
    field?: string;
    oldValue?: string;
    newValue?: string;
    message?: string;
  };
  createdAt: string;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  defaultIssueType: string;
}

export interface JiraSyncResult {
  ok: boolean;
  jiraKey?: string;
  jiraId?: string;
  error?: string;
}

export interface TicketFilters {
  status?: string;
  priority?: string;
  type?: string;
  assignee?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  overdue?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
