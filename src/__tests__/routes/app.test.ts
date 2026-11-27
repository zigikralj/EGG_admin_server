import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('App & Global Handlers (GET, Error, 404, Rate Limit)', () => {
  const app = createApp();

  it('GET / returns API running message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Project Tracker API is running');
  });

  it('GET /health returns health payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });

  it('returns 404 for undefined routes', async () => {
    const res = await request(app).get('/api/some-undefined-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('handles Prisma P2002 unique constraint violation as 400', async () => {
    const admin = createTestUser();
    mockPrisma.user.findUnique.mockResolvedValue(admin);
    const header = createAuthHeader(admin);

    // Trigger P2002 error from mock
    const p2002Error: any = new Error('Unique constraint failed');
    p2002Error.code = 'P2002';
    p2002Error.meta = { target: ['name'] };
    mockPrisma.category.create.mockRejectedValueOnce(p2002Error);

    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', header)
      .send({ code: 'CAT1', name: 'Duplicate Category' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already exists');
  });

  it('handles Prisma P2025 record not found as 404', async () => {
    const admin = createTestUser();
    mockPrisma.user.findUnique.mockResolvedValue(admin);
    const header = createAuthHeader(admin);

    const p2025Error: any = new Error('Record to delete does not exist');
    p2025Error.code = 'P2025';
    mockPrisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1', name: 'To Delete' });
    mockPrisma.project.count.mockResolvedValueOnce(0);
    mockPrisma.category.delete.mockRejectedValueOnce(p2025Error);

    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', header);

    expect(res.status).toBe(404);
  });
});

describe('CORS_ORIGIN configuration', () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  it('allows all origins when CORS_ORIGIN is unset', async () => {
    delete process.env.CORS_ORIGIN;
    const app = createApp();

    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('allows only configured origins when CORS_ORIGIN is set', async () => {
    process.env.CORS_ORIGIN = 'https://app.example.com,https://staging.example.com';
    const app = createApp();

    const allowedPrimary = await request(app)
      .get('/health')
      .set('Origin', 'https://app.example.com');
    expect(allowedPrimary.status).toBe(200);
    expect(allowedPrimary.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const allowedSecondary = await request(app)
      .get('/health')
      .set('Origin', 'https://staging.example.com');
    expect(allowedSecondary.status).toBe(200);
    expect(allowedSecondary.headers['access-control-allow-origin']).toBe('https://staging.example.com');

    const disallowed = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');
    expect(disallowed.status).toBe(200);
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();

    const noOrigin = await request(app).get('/health');
    expect(noOrigin.status).toBe(200);
  });

  it('trims whitespace and trailing slashes in CORS_ORIGIN entries', async () => {
    process.env.CORS_ORIGIN = ' https://app.example.com/ , https://staging.example.com ';
    const app = createApp();

    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://app.example.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('supports wildcard subdomain entries in CORS_ORIGIN', async () => {
    process.env.CORS_ORIGIN = '*.example.com,https://*.example.org';
    const app = createApp();

    const allowedSub = await request(app)
      .get('/health')
      .set('Origin', 'https://sub.example.com');
    expect(allowedSub.status).toBe(200);
    expect(allowedSub.headers['access-control-allow-origin']).toBe('https://sub.example.com');

    const allowedDeepSub = await request(app)
      .get('/health')
      .set('Origin', 'https://deep.sub.example.org');
    expect(allowedDeepSub.status).toBe(200);
    expect(allowedDeepSub.headers['access-control-allow-origin']).toBe('https://deep.sub.example.org');

    const blockedHttp = await request(app)
      .get('/health')
      .set('Origin', 'http://sub.example.com');
    expect(blockedHttp.status).toBe(200);
    expect(blockedHttp.headers['access-control-allow-origin']).toBeUndefined();

    const blockedSimilarDomain = await request(app)
      .get('/health')
      .set('Origin', 'https://evil-example.com');
    expect(blockedSimilarDomain.status).toBe(200);
    expect(blockedSimilarDomain.headers['access-control-allow-origin']).toBeUndefined();

    const blockedApex = await request(app)
      .get('/health')
      .set('Origin', 'https://example.com');
    expect(blockedApex.status).toBe(200);
    expect(blockedApex.headers['access-control-allow-origin']).toBeUndefined();
  });
});
