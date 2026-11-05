import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../../authUtils';
import { requireAuth, userForceLogoutMap, invalidateUserAuthCache } from '../../middleware/auth';
import { sanitizeString, validatePassword } from '../../middleware/validate';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Auth Utilities', () => {
  it('hashes password and verifies successfully with bcrypt', () => {
    const raw = 'SecurePass123!';
    const hash = hashPassword(raw);
    expect(hash).not.toBe(raw);
    expect(verifyPassword(raw, hash)).toBe(true);
    expect(verifyPassword('WrongPass', hash)).toBe(false);
  });

  it('generates JWT and verifies payload correctly', () => {
    const payload = { id: 'usr-123', role: 'Administrator' };
    const token = generateToken(payload);
    expect(typeof token).toBe('string');
    const decoded = verifyToken(token) as any;
    expect(decoded.userId).toBe('usr-123');
    expect(decoded.role).toBe('Administrator');
  });

  it('verifyToken returns null on invalid or tampered token', () => {
    expect(verifyToken('invalid.token.here')).toBeNull();
  });
});

describe('Validate Middleware', () => {
  it('sanitizeString cleans tags and trims string', () => {
    expect(sanitizeString('   hello   ')).toBe('hello');
    expect(sanitizeString(123 as any)).toBeNull();
    expect(sanitizeString('')).toBeNull();
  });

  it('validatePassword validates length and composition', () => {
    expect(validatePassword('short').valid).toBe(false);
    expect(validatePassword('nouppercase123!').valid).toBe(false);
    expect(validatePassword('NOLOWERCASE123!').valid).toBe(false);
    expect(validatePassword('NoSpecialChar123').valid).toBe(false);
    expect(validatePassword('ValidPass123!').valid).toBe(true);
  });
});

describe('Auth Middleware (requireAuth)', () => {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ success: true, user: req.authUser });
  });

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });

  it('returns 403 when user is not approved or is blocked', async () => {
    const blockedUser = createTestUser({ id: 'blocked-1', isApproved: false, status: 'Blocked' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(blockedUser);
    const header = createAuthHeader(blockedUser);

    const res = await request(app).get('/protected').set('Authorization', header);
    expect(res.status).toBe(403);
  });

  it('returns 401 when token was issued before a force-logout event', async () => {
    const user = createTestUser({ id: 'fl-user-1' });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const header = createAuthHeader(user);

    // Set force logout timestamp in the future
    userForceLogoutMap.set(user.id, Date.now() + 10000);

    const res = await request(app).get('/protected').set('Authorization', header);
    expect(res.status).toBe(401);
  });

  it('passes and attaches req.authUser for valid approved user', async () => {
    invalidateUserAuthCache();
    userForceLogoutMap.clear();

    const user = createTestUser({ id: 'valid-user-1' });
    mockPrisma.user.findUnique.mockResolvedValue(user);
    const header = createAuthHeader(user);

    const res = await request(app).get('/protected').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.id).toBe('valid-user-1');
  });
});
