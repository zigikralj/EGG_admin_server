import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { verifyToken } from '../authUtils';
import { requestContext } from '../context';

// ---------------------------------------------------------------------------
// Type extension — gives every Express Request typed auth properties.
// ---------------------------------------------------------------------------
declare global {
  namespace Express {
    interface Request {
      authUser?: User & { roleEntity?: any };
      requestId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory maps for online-status tracking and force-logout revocation.
// ---------------------------------------------------------------------------
// In-memory store for force-logout timestamps and user auth cache.
// NOTE: These are process-local and reset on server restart.
//       For multi-instance deployments, a shared store (e.g. Redis) is needed.
// ---------------------------------------------------------------------------
export const userForceLogoutMap = new Map<string, number>();

interface CachedUser {
  user: User & { roleEntity?: any };
  expiresAt: number;
}
const userAuthCache = new Map<string, CachedUser>();
const USER_AUTH_CACHE_TTL_MS = 60_000; // 60 seconds

export function invalidateUserAuthCache(userId?: string): void {
  if (userId) {
    userAuthCache.delete(userId);
  } else {
    userAuthCache.clear();
  }
}

// Periodic cleanup — purge entries older than 1 hour / expired cache, runs every 5 minutes.
setInterval(() => {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  for (const [id, ts] of userForceLogoutMap) {
    if (ts < cutoff) userForceLogoutMap.delete(id);
  }
  for (const [id, entry] of userAuthCache) {
    if (entry.expiresAt < now) userAuthCache.delete(id);
  }
}, 5 * 60 * 1000).unref(); // .unref() so the interval doesn't block process exit

async function fetchUserWithRole(userId: string): Promise<(User & { roleEntity?: any }) | null> {
  const cached = userAuthCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const user = await prisma.user.findUnique({
    include: { roleEntity: true },
    where: { id: userId },
  });
  if (user) {
    userAuthCache.set(userId, { user, expiresAt: Date.now() + USER_AUTH_CACHE_TTL_MS });
  } else {
    userAuthCache.delete(userId);
  }
  return user ?? null;
}

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
    if (forceLogoutAt && tokenIatMs && tokenIatMs < forceLogoutAt) {
      userAuthCache.delete(payload.userId);
      return null;
    }

    // Check if Administrator or Manager is switching user (impersonation / preview)
    const xUserId = req.headers["x-user-id"] as string;
    const authDbUser = await fetchUserWithRole(payload.userId);

    if (authDbUser && xUserId && xUserId !== payload.userId) {
      if (authDbUser.role === "Administrator" || authDbUser.role === "Manager") {
        const impersonatedUser = await fetchUserWithRole(xUserId);
        if (impersonatedUser && impersonatedUser.isApproved && impersonatedUser.status !== "BLOCKED") {
          return impersonatedUser;
        }
      }
    }
    return authDbUser ?? null;
  }

  // Fallback X-User-Id
  const fallbackXUserId = req.headers["x-user-id"] as string;
  if (fallbackXUserId) {
    const fallbackUser = await fetchUserWithRole(fallbackXUserId);
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
  
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;

  const userId = user.id;
  const userName = user.name || 'Unknown';
  const method = req.method;
  const route = req.originalUrl || req.baseUrl || req.path;

  requestContext.run(
    {
      userId,
      userName,
      sessionId,
      requestId,
      method,
      route,
      source: 'api',
    },
    () => {
      next();
    }
  );
}


