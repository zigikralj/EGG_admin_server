import { Response } from 'express';

/**
 * Centralised Prisma error handler.
 *
 * Handles known Prisma error codes and falls back to a generic 500 for
 * anything unexpected.
 *
 * P2002 — Unique constraint violation
 * P2025 — Record not found (used by update/delete when the record is missing)
 */
export function handlePrismaError(
  res: Response,
  error: unknown,
  defaultMessage: string
): void {
  const prismaError = error as { code?: string; meta?: { target?: string | string[] } };

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

  if (prismaError?.code === 'P2025') {
    res.status(404).json({ error: 'Record not found.' });
    return;
  }

  console.error('%s', defaultMessage, error);
  res.status(500).json({ error: defaultMessage });
}
