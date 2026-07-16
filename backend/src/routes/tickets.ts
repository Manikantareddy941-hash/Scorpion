import { Router, Request, Response, NextFunction } from 'express';
import { verifyUser } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ticketsService } from '../services/ticketsService';
import { TicketFilters } from '../../../shared/types';
import {
  AuthenticatedRequest,
  jiraConfigSchema,
  fromFindingSchema,
  createTicketSchema,
  updateTicketSchema,
  addLinkSchema,
  addCommentSchema
} from '../types/tickets.types';
import { logger } from '../services/logger';

const router = Router();

// Apply authentication middleware to all ticket endpoints
router.use(verifyUser);

const asyncHandler = (fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<unknown>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthenticatedRequest, res, next).catch(next);
  };
};

function actorEmail(req: AuthenticatedRequest): string {
  return req.user?.email || 'dev@scorpion.local';
}

/**
 * GET /api/tickets - List & filter tickets
 */
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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

  res.json(await ticketsService.listTickets(filters));
}));

/**
 * GET /api/tickets/stats - Aggregated stats
 */
router.get('/stats', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(await ticketsService.getStats());
}));

/**
 * GET /api/tickets/jira/config - Retrieve current JIRA configuration (redacted)
 */
router.get('/jira/config', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(ticketsService.getRedactedJiraConfig());
}));

/**
 * POST /api/tickets/jira/config - Save JIRA configuration
 */
router.post('/jira/config', validateBody(jiraConfigSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  ticketsService.saveJiraConfig(req.body);
  res.json({ message: 'Jira configuration updated successfully.' });
}));

/**
 * GET /api/tickets/jira/test - Test connection to Jira
 */
router.get('/jira/test', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await ticketsService.testJiraConnection();
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
}));

/**
 * GET /api/tickets/by-finding/:findingId - Get ticket by linked finding ID
 */
router.get('/by-finding/:findingId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ticket = await ticketsService.getTicketByFinding(req.params.findingId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found for this finding' });
  res.json(ticket);
}));

/**
 * GET /api/tickets/:id - Get a single ticket
 */
router.get('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ticket = await ticketsService.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
}));

/**
 * POST /api/tickets/from-finding - Auto-create ticket from a security finding
 */
router.post('/from-finding', validateBody(fromFindingSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await ticketsService.createFromFinding(req.body, actorEmail(req));
  if (result.conflict) {
    return res.status(409).json({ error: 'A ticket is already linked to this finding.', ticket: result.ticket });
  }
  res.status(201).json(result.ticket);
}));

/**
 * POST /api/tickets - Create a new ticket
 */
router.post('/', validateBody(createTicketSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await ticketsService.createTicket(req.body, actorEmail(req));
  if (result.conflict) {
    return res.status(409).json({ error: 'A ticket is already linked to this finding.', ticket: result.ticket });
  }
  res.status(201).json(result.ticket);
}));

/**
 * PATCH /api/tickets/:id - Partially update a ticket
 */
router.patch('/:id', validateBody(updateTicketSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await ticketsService.updateTicket(req.params.id, req.body, actorEmail(req));
    if (!updated) return res.status(404).json({ error: 'Ticket not found' });
    res.json(updated);
  } catch (err) {
    logger.error('Error in PATCH ticket:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update ticket' });
  }
}));

/**
 * DELETE /api/tickets/:id - Delete a ticket
 */
router.delete('/:id', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const success = await ticketsService.deleteTicket(req.params.id);
  if (!success) return res.status(404).json({ error: 'Ticket not found' });
  res.status(204).end();
}));

/**
 * POST /api/tickets/:id/links - Link a ticket to another ticket
 */
router.post('/:id/links', validateBody(addLinkSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { targetId, type } = req.body;
  const updatedTicket = await ticketsService.addLink(req.params.id, targetId, type, actorEmail(req));
  if (!updatedTicket) return res.status(404).json({ error: 'Ticket or target ticket not found' });
  res.json(updatedTicket);
}));

/**
 * DELETE /api/tickets/:id/links/:targetId - Remove a link between tickets
 */
router.delete('/:id/links/:targetId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const updatedTicket = await ticketsService.removeLink(req.params.id, req.params.targetId, actorEmail(req));
  if (!updatedTicket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(updatedTicket);
}));

/**
 * GET /api/tickets/:id/comments - Retrieve comment thread
 */
router.get('/:id/comments', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(await ticketsService.getComments(req.params.id));
}));

/**
 * POST /api/tickets/:id/comments - Add a comment to the ticket
 */
router.post('/:id/comments', validateBody(addCommentSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const comment = await ticketsService.addComment(req.params.id, req.body.body, actorEmail(req));
  res.status(201).json(comment);
}));

/**
 * GET /api/tickets/:id/activity - Retrieve ticket activity audit logs
 */
router.get('/:id/activity', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(await ticketsService.getActivity(req.params.id));
}));

/**
 * POST /api/tickets/sync/bulk - Bulk sync all unsynced tickets to Jira
 */
router.post('/sync/bulk', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  res.json(await ticketsService.bulkSyncToJira());
}));

/**
 * POST /api/tickets/:id/sync - Push local ticket changes to JIRA
 */
router.post('/:id/sync', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await ticketsService.syncTicketToJira(req.params.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
}));

/**
 * POST /api/tickets/sync/pull/:jiraKey - Pull ticket changes from JIRA
 */
router.post('/sync/pull/:jiraKey', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await ticketsService.pullTicketFromJira(req.params.jiraKey);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
}));

export default router;
