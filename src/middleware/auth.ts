import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { verifyToken } from '../authUtils';
import { requestContext } from '../context';
import { isUserSystemAdmin, getUserPermissions, type AuthenticatedUser } from '../types';
import { USER_STATUSES, ERROR_CODES } from '../constants';

// ---------------------------------------------------------------------------
// Type extension — gives every Express Request typed auth properties.
// ---------------------------------------------------------------------------
declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
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
  user: User & { roleEntity?: any; permissions?: Record<string, any>; isSystemAdmin?: boolean };
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

async function fetchUserWithRole(userId: string): Promise<(User & { roleEntity?: any; permissions?: Record<string, any>; isSystemAdmin?: boolean }) | null> {
  const cached = userAuthCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const dbUser = await prisma.user.findUnique({
    include: { roleEntity: true },
    where: { id: userId },
  });
  if (dbUser) {
    const user = {
      ...dbUser,
      isSystemAdmin: isUserSystemAdmin(dbUser),
      permissions: getUserPermissions(dbUser) ?? {},
    };
    userAuthCache.set(userId, { user, expiresAt: Date.now() + USER_AUTH_CACHE_TTL_MS });
    return user;
  } else {
    userAuthCache.delete(userId);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated user from the request via JWT Bearer token.
 */
export async function getAuthUser(req: Request): Promise<User | null> {
  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.query && typeof req.query.token === 'string') {
    // Support EventSource (SSE) which cannot send custom Authorization headers
    token = req.query.token.trim();
  }

  if (token) {
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

    const authDbUser = await fetchUserWithRole(payload.userId);
    return authDbUser ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Enforces authentication. Attaches the resolved user to req.authUser.
 * Returns 401 if no valid session is found, or 403 if the account is blocked/unapproved.
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
  if (user.status === USER_STATUSES.BLOCKED || !user.isApproved || user.status !== USER_STATUSES.APPROVED) {
    res
      .status(403)
      .json({ error: ERROR_CODES.ACCOUNT_BLOCKED, message: 'Contact administrator for more information.' });
    return;
  }
  req.authUser = user;
  
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  const userId = user.id;
  const userName = user.name || 'Unknown';
  const method = req.method;
  const route = req.originalUrl || req.baseUrl || req.path;

  requestContext.run(
    {
      userId,
      userName,
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


