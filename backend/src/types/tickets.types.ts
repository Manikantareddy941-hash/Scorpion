import { Request } from 'express';
import { z } from 'zod';
import { TicketLinkType } from '../../../shared/types';

export interface AuthenticatedRequest extends Request {
  user?: { $id: string; userId: string; email?: string };
}

export const ticketStatus = z.enum(['todo', 'in_progress', 'in_review', 'done', 'closed']);
export const ticketPriority = z.enum(['critical', 'high', 'medium', 'low']);
export const ticketType = z.enum(['bug', 'vulnerability', 'task', 'feature', 'story', 'epic']);

export const jiraConfigSchema = z.object({
  baseUrl: z.string().trim().url('baseUrl must be a valid URL'),
  email: z.string().trim().email(),
  apiToken: z.string().trim().min(1),
  projectKey: z.string().trim().min(1),
  defaultIssueType: z.string().trim().min(1),
});

export const fromFindingSchema = z.object({
  findingId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  severity: z.union([z.string(), z.number()]).optional(),
  type: ticketType.optional(),
});

export const createTicketSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: ticketStatus.optional(),
  priority: ticketPriority.optional(),
  type: ticketType.optional(),
  severity: z.union([z.string(), z.number()]).optional(),
  assignee: z.string().optional(),
  tags: z.array(z.string()).optional(),
  linkedFindings: z.array(z.string()).optional(),
  storyPoints: z.union([z.string(), z.number()]).optional(),
  dueDate: z.string().optional(),
  epicLink: z.string().optional(),
  sprintId: z.string().optional(),
});

export const updateTicketSchema = createTicketSchema.partial();

export const addLinkSchema = z.object({
  targetId: z.string().trim().min(1),
  type: z.enum(['blocks', 'blocked_by', 'relates_to'] as [TicketLinkType, ...TicketLinkType[]]),
});

export const addCommentSchema = z.object({
  body: z.string().trim().min(1),
});

export type FromFindingInput = z.infer<typeof fromFindingSchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type JiraConfigInput = z.infer<typeof jiraConfigSchema>;
