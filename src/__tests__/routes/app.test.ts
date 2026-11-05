import { describe, it, expect, vi } from 'vitest';
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
