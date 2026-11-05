import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';
import { hashPassword } from '../../authUtils';
import { ERROR_CODES, USER_STATUSES } from '../../constants';

describe('Auth Routes (POST /login, POST /register, GET /me)', () => {
  const app = createApp();

  describe('POST /api/auth/login', () => {
    it('returns 200 with JWT and user payload on valid credentials', async () => {
      const rawPassword = 'Password123!';
      const user = createTestUser({ email: 'login@ekos.rs', status: USER_STATUSES.APPROVED, isApproved: true });
      user.password = hashPassword(rawPassword);

      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrName: 'login@ekos.rs', password: rawPassword });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('id', user.id);
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('returns 401 when password does not match', async () => {
      const user = createTestUser({ email: 'login@ekos.rs', status: USER_STATUSES.APPROVED, isApproved: true });
      user.password = hashPassword('CorrectPassword123!');

      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrName: 'login@ekos.rs', password: 'WrongPassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe(ERROR_CODES.INVALID_CREDENTIALS);
    });

    it('returns 403 when user is not approved', async () => {
      const rawPassword = 'Password123!';
      const user = createTestUser({ email: 'pending@ekos.rs', isApproved: false, status: USER_STATUSES.PENDING });
      user.password = hashPassword(rawPassword);

      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrName: 'pending@ekos.rs', password: rawPassword });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ERROR_CODES.PENDING_APPROVAL);
    });

    it('returns 400 when email or password is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ emailOrName: 'only@ekos.rs' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email/Username and Password are required');
    });
  });

  describe('POST /api/auth/register', () => {
    it('returns 201 on successful registration', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'new-user-id',
        name: 'New Registered User',
        email: 'register@ekos.rs',
        role: 'User',
        isApproved: false,
        status: USER_STATUSES.PENDING,
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New Registered User',
          email: 'register@ekos.rs',
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('returns 400 when email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(createTestUser({ email: 'existing@ekos.rs' }));

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Existing User',
          email: 'existing@ekos.rs',
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('A user with this name or email already exists');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 200 with current user profile (no password)', async () => {
      const user = createTestUser({ email: 'me@ekos.rs', status: USER_STATUSES.APPROVED, isApproved: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      const header = createAuthHeader(user);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', header);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('me@ekos.rs');
      expect(res.body).not.toHaveProperty('password');
    });

    it('returns 401 when token is missing', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
