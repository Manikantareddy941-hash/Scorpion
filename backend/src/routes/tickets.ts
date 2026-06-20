import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyUser } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  createTicket,
  getTicket,
  findByLinkedFinding,
  getUnsyncedTickets,
  updateTicket,
  deleteTicket,
  listTickets,
  addComment,
  getComments,
  getActivity,
  getStats,
  addLink,
  removeLink
} from '../models/ticketModel';
import {
  setJiraConfig,
  getJiraConfig,
  pushTicketToJira,
  pullFromJira,
  testConnection
} from '../services/jiraService';
import { TicketFilters, TicketLinkType } from '../../../shared/types';
import { logger } from '../services/logger';

const router = Router();

// Apply authentication middleware to all ticket endpoints
router.use(verifyUser);

const ticketStatus = z.enum(['todo', 'in_progress', 'in_review', 'done', 'closed']);
const ticketPriority = z.enum(['critical', 'high', 'medium', 'low']);
const ticketType = z.enum(['bug', 'vulnerability', 'task', 'feature', 'story', 'epic']);

const jiraConfigSchema = z.object({
  baseUrl: z.string().trim().url('baseUrl must be a valid URL'),
  email: z.string().trim().email(),
  apiToken: z.string().trim().min(1),
  projectKey: z.string().trim().min(1),
  defaultIssueType: z.string().trim().min(1),
});

const fromFindingSchema = z.object({
  findingId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  severity: z.union([z.string(), z.number()]).optional(),
  type: ticketType.optional(),
});

const createTicketSchema = z.object({
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

const addLinkSchema = z.object({
  targetId: z.string().trim().min(1),
  type: z.enum(['blocks', 'blocked_by', 'relates_to'] as [TicketLinkType, ...TicketLinkType[]]),
});

const addCommentSchema = z.object({
  body: z.string().trim().min(1),
});

const updateTicketSchema = createTicketSchema.partial();

// Try-catch helper for async handlers
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * GET /api/tickets - List & filter tickets
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { status, priority, type, assignee, search, page, limit, sortBy, sortOrder } = req.query;

  const filters: TicketFilters = {
    status: status as string,
    priority: priority as string,
    type: type as string,
    assignee: assignee as string,
    search: search as string,
    page: page ? parseInt(page as string, 10) : undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    sortBy: sortBy as string,
    sortOrder: sortOrder as 'asc' | 'desc',
    overdue: req.query.overdue === 'true'
  };

  const response = await listTickets(filters);
  res.json(response);
}));

/**
 * GET /api/tickets/stats - Aggregated stats
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = await getStats();
  res.json(stats);
}));

/**
 * GET /api/tickets/jira/config - Retrieve current JIRA configuration (redacted)
 */
router.get('/jira/config', asyncHandler(async (req: Request, res: Response) => {
  const config = getJiraConfig();
  if (!config) {
    return res.json({ configured: false });
  }

  res.json({
    configured: true,
    baseUrl: config.baseUrl,
    email: config.email,
    projectKey: config.projectKey,
    defaultIssueType: config.defaultIssueType,
    apiToken: '********' // Redacted
  });
}));

/**
 * POST /api/tickets/jira/config - Save JIRA configuration
 */
router.post('/jira/config', validateBody(jiraConfigSchema), asyncHandler(async (req: Request, res: Response) => {
  const { baseUrl, email, apiToken, projectKey, defaultIssueType } = req.body;

  setJiraConfig({
    baseUrl,
    email,
    apiToken,
    projectKey,
    defaultIssueType
  });

  res.json({ message: 'Jira configuration updated successfully.' });
}));

/**
 * GET /api/tickets/jira/test - Test connection to Jira
 */
router.get('/jira/test', asyncHandler(async (req: Request, res: Response) => {
  const result = await testConnection();
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
}));

/**
 * GET /api/tickets/by-finding/:findingId - Get ticket by linked finding ID
 */
router.get('/by-finding/:findingId', asyncHandler(async (req: Request, res: Response) => {
  const ticket = await findByLinkedFinding(req.params.findingId);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found for this finding' });
  }
  res.json(ticket);
}));

/**
 * GET /api/tickets/:id - Get a single ticket
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  res.json(ticket);
}));

/**
 * POST /api/tickets/from-finding - Auto-create ticket from a security finding
 */
router.post('/from-finding', validateBody(fromFindingSchema), asyncHandler(async (req: Request, res: Response) => {
  const { findingId, title, description, severity, type } = req.body;

  // Duplicate prevention check
  const existingTicket = await findByLinkedFinding(findingId);
  if (existingTicket) {
    return res.status(409).json({ 
      error: 'A ticket is already linked to this finding.', 
      ticket: existingTicket 
    });
  }

  const sevVal = severity !== undefined ? Number(severity) : 0;
  let priority: 'critical' | 'high' | 'medium' | 'low' = 'low';
  if (sevVal >= 9) {
    priority = 'critical';
  } else if (sevVal >= 7) {
    priority = 'high';
  } else if (sevVal >= 4) {
    priority = 'medium';
  }

  const userEmail = (req as any).user?.email || 'dev@scorpion.local';

  const ticket = await createTicket({
    title,
    description,
    status: 'todo',
    priority,
    type: type || 'vulnerability',
    severity: sevVal,
    assignee: '',
    reporter: userEmail,
    tags: [],
    linkedFindings: [findingId]
  } as any);

  res.status(201).json(ticket);
}));

/**
 * POST /api/tickets - Create a new ticket
 */
router.post('/', validateBody(createTicketSchema), asyncHandler(async (req: Request, res: Response) => {
  const { title, description, status, priority, type, severity, assignee, tags, linkedFindings, storyPoints, dueDate, epicLink, sprintId } = req.body;

  // Duplicate prevention check
  if (Array.isArray(linkedFindings) && linkedFindings.length > 0) {
    for (const findingId of linkedFindings) {
      const existingTicket = await findByLinkedFinding(findingId);
      if (existingTicket) {
        return res.status(409).json({ 
          error: 'A ticket is already linked to this finding.', 
          ticket: existingTicket 
        });
      }
    }
  }

  const userEmail = (req as any).user?.email || 'dev@scorpion.local';
  
  const ticket = await createTicket({
    title,
    description,
    status: status || 'todo',
    priority: priority || 'medium',
    type: type || 'task',
    severity: severity !== undefined ? Number(severity) : 0,
    assignee: assignee || '',
    reporter: userEmail,
    tags: Array.isArray(tags) ? tags : [],
    linkedFindings: Array.isArray(linkedFindings) ? linkedFindings : [],
    storyPoints: storyPoints !== undefined ? Number(storyPoints) : undefined,
    dueDate,
    epicLink,
    sprintId
  } as any);

  res.status(201).json(ticket);
}));

/**
 * PATCH /api/tickets/:id - Partially update a ticket
 */
router.patch('/:id', validateBody(updateTicketSchema), asyncHandler(async (req: Request, res: Response) => {
  const userEmail = (req as any).user?.email || 'dev@scorpion.local';
  try {
    const updated = await updateTicket(req.params.id, req.body, userEmail);
    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(updated);
  } catch (err: any) {
    logger.error('Error in PATCH ticket:', err);
    res.status(500).json({ error: err.message || 'Failed to update ticket' });
  }
}));

/**
 * DELETE /api/tickets/:id - Delete a ticket
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const success = await deleteTicket(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  res.status(204).end();
}));

/**
 * POST /api/tickets/:id/links - Link a ticket to another ticket
 */
router.post('/:id/links', validateBody(addLinkSchema), asyncHandler(async (req: Request, res: Response) => {
  const { targetId, type } = req.body;

  const userEmail = (req as any).user?.email || 'dev@scorpion.local';
  const updatedTicket = await addLink(req.params.id, targetId, type as TicketLinkType, userEmail);
  if (!updatedTicket) {
    return res.status(404).json({ error: 'Ticket or target ticket not found' });
  }
  
  res.json(updatedTicket);
}));

/**
 * DELETE /api/tickets/:id/links/:targetId - Remove a link between tickets
 */
router.delete('/:id/links/:targetId', asyncHandler(async (req: Request, res: Response) => {
  const userEmail = (req as any).user?.email || 'dev@scorpion.local';
  const updatedTicket = await removeLink(req.params.id, req.params.targetId, userEmail);
  if (!updatedTicket) {
    return res.status(404).json({ error: 'Ticket not found' });
  }
  
  res.json(updatedTicket);
}));

/**
 * GET /api/tickets/:id/comments - Retrieve comment thread
 */
router.get('/:id/comments', asyncHandler(async (req: Request, res: Response) => {
  const comments = await getComments(req.params.id);
  res.json(comments);
}));

/**
 * POST /api/tickets/:id/comments - Add a comment to the ticket
 */
router.post('/:id/comments', validateBody(addCommentSchema), asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body;

  const userEmail = (req as any).user?.email || 'dev@scorpion.local';
  const comment = await addComment(req.params.id, body, userEmail);
  res.status(201).json(comment);
}));

/**
 * GET /api/tickets/:id/activity - Retrieve ticket activity audit logs
 */
router.get('/:id/activity', asyncHandler(async (req: Request, res: Response) => {
  const activity = await getActivity(req.params.id);
  res.json(activity);
}));

/**
 * POST /api/tickets/sync/bulk - Bulk sync all unsynced tickets to Jira
 */
router.post('/sync/bulk', asyncHandler(async (req: Request, res: Response) => {
  const unsynced = await getUnsyncedTickets();
  const results: any[] = [];
  let synced = 0;
  let failed = 0;

  for (const ticket of unsynced) {
    try {
      const syncResult = await pushTicketToJira(ticket.id);
      results.push({ ticketId: ticket.id, ...syncResult });
      if (syncResult.ok) {
        synced++;
      } else {
        failed++;
      }
    } catch (err: any) {
      failed++;
      results.push({
        ticketId: ticket.id,
        ok: false,
        error: err.message || 'Error during sync'
      });
    }
  }

  res.json({
    total: unsynced.length,
    synced,
    failed,
    results
  });
}));

/**
 * POST /api/tickets/:id/sync - Push local ticket changes to JIRA
 */
router.post('/:id/sync', asyncHandler(async (req: Request, res: Response) => {
  const result = await pushTicketToJira(req.params.id);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
}));

/**
 * POST /api/tickets/sync/pull/:jiraKey - Pull ticket changes from JIRA
 */
router.post('/sync/pull/:jiraKey', asyncHandler(async (req: Request, res: Response) => {
  const result = await pullFromJira(req.params.jiraKey);
  if (!result.ok) {
    return res.status(400).json(result);
  }
  res.json(result);
}));

export default router;
