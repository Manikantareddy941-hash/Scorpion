import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodType } from 'zod';

const formatZodError = (error: ZodError) =>
    error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
    }));

/** Validates req.body against schema, replacing it with the parsed (and stripped) result. */
export const validateBody = (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Invalid request body', details: formatZodError(result.error) });
    }
    req.body = result.data;
    next();
};

/** Validates req.query against schema, replacing it with the parsed (and stripped) result. */
export const validateQuery = (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
        return res.status(400).json({ error: 'Invalid query parameters', details: formatZodError(result.error) });
    }
    req.query = result.data as typeof req.query;
    next();
};

/** Validates req.params against schema, replacing it with the parsed (and stripped) result. */
export const validateParams = (schema: ZodType) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
        return res.status(400).json({ error: 'Invalid route parameters', details: formatZodError(result.error) });
    }
    req.params = result.data as typeof req.params;
    next();
};
