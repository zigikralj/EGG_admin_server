import { Request, Response, NextFunction } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { verifyToken } from '../authUtils';

// ---------------------------------------------------------------------------
// Type extension — gives every Express Request a typed authUser property.
// ---------------------------------------------------------------------------
declare global {
  namespace Express {
    interface Request {
      authUser?: User;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory maps for online-status tracking and force-logout revocation.
// NOTE: These are process-local and reset on server restart.
//       For multi-instance deployments, a shared store (e.g. Redis) is needed.
// ---------------------------------------------------------------------------
export const userActivityMap = new Map<string, number>();
export const userForceLogoutMap = new Map<string, number>();

// Periodic cleanup — purge entries older than 1 hour, runs every 5 minutes.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, ts] of userActivityMap) {
    if (ts < cutoff) userActivityMap.delete(id);
  }
  for (const [id, ts] of userForceLogoutMap) {
    if (ts < cutoff) userForceLogoutMap.delete(id);
  }
}, 5 * 60 * 1000).unref(); // .unref() so the interval doesn't block process exit

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated user from the request.
 * Tries JWT Bearer token first, then falls back to X-User-Id header.
 *
 * NOTE: The X-User-Id fallback is a critical security vulnerability and
 *       will be removed in Phase 3.
 */
export async function getAuthUser(req: Request): Promise<User | null> {
  // 1. JWT Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const payload = verifyToken(token);
    if (!payload || !payload.userId) return null;

    const forceLogoutAt = userForceLogoutMap.get(payload.userId);
    const tokenIatMs = (payload as { iat?: number }).iat
      ? (payload as { iat?: number }).iat! * 1000
      : 0;
    if (forceLogoutAt && tokenIatMs && tokenIatMs < forceLogoutAt) return null;

    // Check if Administrator or Manager is switching user (impersonation / preview)
    const xUserId = req.headers["x-user-id"] as string;
    const authDbUser = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (authDbUser && xUserId && xUserId !== payload.userId) {
      if (authDbUser.role === "Administrator" || authDbUser.role === "Manager") {
        const impersonatedUser = await prisma.user.findUnique({ where: { id: xUserId } });
        if (impersonatedUser && impersonatedUser.isApproved && impersonatedUser.status !== "BLOCKED") {
          userActivityMap.set(impersonatedUser.id, Date.now());
          return impersonatedUser;
        }
      }
    }

    if (authDbUser) userActivityMap.set(authDbUser.id, Date.now());
    return authDbUser ?? null;
  }

  // Fallback X-User-Id
  const fallbackXUserId = req.headers["x-user-id"] as string;
  if (fallbackXUserId) {
    const fallbackUser = await prisma.user.findUnique({ where: { id: fallbackXUserId } });
    if (fallbackUser) userActivityMap.set(fallbackUser.id, Date.now());
    return fallbackUser ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Enforces authentication. Attaches the resolved user to req.authUser.
 * Returns 401 if no valid session is found.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await getAuthUser(req);
  if (!user) {
    res
      .status(401)
      .json({ error: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
    return;
  }
  req.authUser = user;
  next();
}
