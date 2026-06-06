import { Express } from 'express';
import ticketsRouter from './routes/tickets';

/**
 * Register tickets route module in Express application
 */
export function registerTicketRoutes(app: Express): void {
  app.use('/api/tickets', ticketsRouter);
}
