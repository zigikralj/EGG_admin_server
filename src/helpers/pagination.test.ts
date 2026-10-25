import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parsePagination, buildPaginatedResponse } from './pagination';

describe('Pagination Helper', () => {
  test('bypasses pagination when since is present for delta sync', () => {
    const result = parsePagination({ since: '2026-10-24T00:00:00.000Z', page: '2', limit: '10' });
    assert.strictEqual(result.isPaginated, false);
  });

  test('bypasses pagination when neither page nor limit is provided', () => {
    const result = parsePagination({});
    assert.strictEqual(result.isPaginated, false);
  });

  test('bypasses pagination when limit is "all"', () => {
    const result = parsePagination({ limit: 'all' });
    assert.strictEqual(result.isPaginated, false);
  });

  test('parses pagination with page and limit correctly', () => {
    const result = parsePagination({ page: '2', limit: '15' });
    assert.strictEqual(result.isPaginated, true);
    assert.strictEqual(result.page, 2);
    assert.strictEqual(result.limit, 15);
    assert.strictEqual(result.skip, 15);
    assert.strictEqual(result.take, 15);
  });

  test('clamps limit to maximum 100', () => {
    const result = parsePagination({ page: '1', limit: '500' });
    assert.strictEqual(result.isPaginated, true);
    assert.strictEqual(result.limit, 100);
    assert.strictEqual(result.take, 100);
  });

  test('defaults page to 1 when negative or invalid', () => {
    const result = parsePagination({ page: '-5', limit: '20' });
    assert.strictEqual(result.isPaginated, true);
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.skip, 0);
  });

  test('builds paginated envelope correctly', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const response = buildPaginatedResponse(items, 45, 2, 10);
    assert.strictEqual(response.total, 45);
    assert.strictEqual(response.page, 2);
    assert.strictEqual(response.limit, 10);
    assert.strictEqual(response.totalPages, 5);
    assert.strictEqual(response.hasMore, true);
    assert.deepStrictEqual(response.items, items);
  });

  test('calculates hasMore as false on the last page', () => {
    const items = [{ id: '41' }];
    const response = buildPaginatedResponse(items, 41, 5, 10);
    assert.strictEqual(response.totalPages, 5);
    assert.strictEqual(response.hasMore, false);
  });
});
