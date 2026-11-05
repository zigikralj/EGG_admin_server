import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { mockPrisma } from '../helpers/prismaMock';
import { createTestUser, createAuthHeader } from '../helpers/testAuth';

describe('Invoices Routes (GET, POST, PUT, PATCH /status, DELETE)', () => {
  const app = createApp();

  describe('GET /api/invoices', () => {
    it('returns invoices with items and pagination', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.invoice.findMany.mockResolvedValueOnce([
        { id: 'inv-1', invoiceNumber: '2026-001', totalAmount: 12000, items: [] },
      ]);
      mockPrisma.invoice.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/invoices?page=1&limit=10')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body.items).toHaveLength(1);
    });

    it('GET /api/invoices/:id returns invoice with items', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        invoiceNumber: '2026-001',
        items: [{ id: 'item-1', description: 'Consulting', amount: 10000 }],
      });

      const res = await request(app)
        .get('/api/invoices/inv-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.invoiceNumber).toBe('2026-001');
    });
  });

  describe('POST /api/invoices', () => {
    it('creates invoice with line items', async () => {
      const accountant = createTestUser({
        role: 'Accountant',
        permissions: { invoices: ['view', 'create', 'edit', 'delete'] },
      });
      mockPrisma.user.findUnique.mockResolvedValue(accountant);
      mockPrisma.invoice.create.mockResolvedValueOnce({
        id: 'inv-new',
        invoiceNumber: '2026-002',
        clientId: 'c1',
        totalAmount: 15000,
        items: [{ id: 'item-new-1', description: 'Testing fee', amount: 15000 }],
      });

      const res = await request(app)
        .post('/api/invoices')
        .set('Authorization', createAuthHeader(accountant))
        .send({
          invoiceNumber: '2026-002',
          clientId: 'c1',
          totalAmount: 15000,
          items: [{ description: 'Testing fee', amount: 15000 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.invoiceNumber).toBe('2026-002');
    });
  });

  describe('PUT /api/invoices/:id', () => {
    it('updates invoice and replaces items inside transaction', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        items: [],
      });
      mockPrisma.invoiceItem.deleteMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.invoice.update.mockResolvedValueOnce({
        id: 'inv-1',
        totalAmount: 20000,
        items: [{ id: 'item-2', description: 'Updated Line', amount: 20000 }],
      });

      const res = await request(app)
        .put('/api/invoices/inv-1')
        .set('Authorization', createAuthHeader(admin))
        .send({
          totalAmount: 20000,
          items: [{ description: 'Updated Line', amount: 20000 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.totalAmount).toBe(20000);
    });
  });

  describe('PATCH /api/invoices/:id/status', () => {
    it('updates invoice payment status', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({ id: 'inv-1', status: 'Pending' });
      mockPrisma.invoice.update.mockResolvedValueOnce({
        id: 'inv-1',
        status: 'Paid',
      });

      const res = await request(app)
        .patch('/api/invoices/inv-1/status')
        .set('Authorization', createAuthHeader(admin))
        .send({ status: 'Paid' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Paid');
    });
  });

  describe('DELETE /api/invoices/:id', () => {
    it('deletes invoice', async () => {
      const admin = createTestUser();
      mockPrisma.user.findUnique.mockResolvedValue(admin);
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({ id: 'inv-1' });
      mockPrisma.invoice.delete.mockResolvedValueOnce({ id: 'inv-1' });

      const res = await request(app)
        .delete('/api/invoices/inv-1')
        .set('Authorization', createAuthHeader(admin));

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });
  });
});
