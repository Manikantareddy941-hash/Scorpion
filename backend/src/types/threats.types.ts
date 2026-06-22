import { Request } from 'express';
import { z } from 'zod';

export interface AuthenticatedRequest extends Request {
  user?: { $id: string };
}

// Falco's `output_fields` is a free-form map of whatever fields the matched
// rule captured; only the container id/image keys are read here.
export const falcoEventSchema = z.object({
  rule: z.string().trim().min(1).optional(),
  priority: z.string().trim().min(1).optional(),
  output: z.string().optional(),
  time: z.string().optional(),
  output_fields: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type FalcoEvent = z.infer<typeof falcoEventSchema>;

export type ThreatStatus = 'compromised' | 'passing';

export interface ThreatDocument {
  $id: string;
  rule: string;
  priority: string;
  containerId: string;
  output: string;
  status: ThreatStatus;
  timestamp: string;
  ownerUserId?: string;
}
