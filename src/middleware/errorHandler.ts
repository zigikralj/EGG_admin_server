import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler and forwards any thrown errors to Express's
 * next(err) error pipeline, eliminating repetitive try/catch blocks in every
 * route handler.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someDbCall();
 *     res.json(data);
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Central Express error-handling middleware.
 * Must be registered LAST, after all routes: app.use(errorHandler)
 *
 * Handles:
 *  - Prisma P2002 (unique constraint violation)  → 400
 *  - Prisma P2025 (record not found)             → 404
 *  - Everything else                             → 500
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const prismaError = error as { code?: string; meta?: { target?: string | string[] }; message?: string };

  // Prisma: unique constraint
  if (prismaError?.code === 'P2002') {
    const targets = prismaError?.meta?.target;
    const targetStr = Array.isArray(targets)
      ? targets.join(', ')
      : targets
        ? String(targets)
        : 'field';
    res.status(400).json({ error: `A record with this ${targetStr} already exists.` });
    return;
  }

  // Prisma: record not found (thrown by update/delete on missing records)
  if (prismaError?.code === 'P2025') {
    res.status(404).json({ error: 'Record not found.' });
    return;
  }

  // Generic server error
  const message = prismaError?.message || 'An unexpected error occurred.';
  console.error('[%s] %s', req.method, req.path, error);
  res.status(500).json({ error: message });
}
