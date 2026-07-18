import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';
import { statusTelemetry } from '../monitor/statusTelemetry';
import { redactUrl } from '../utils/redactUrl';

/**
 * Structured HTTP request logger (winston). Replaces morgan so request logs are
 * JSON in production and flow through the same logger/transports (Loki) as the
 * rest of the app. Logs once per request on response finish so the final status
 * and total response time are known.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const responseTimeMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('http_request', {
      method: req.method,
      url: redactUrl(req.originalUrl),
      status: res.statusCode,
      responseTimeMs: Math.round(responseTimeMs * 100) / 100,
      ip: req.ip,
    });
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    statusTelemetry.record(ip, res.statusCode);
  });

  next();
}
