import { describe, it, expect } from 'vitest';
import { parsePagination, buildPaginatedResponse } from '../../helpers/pagination';

describe('Pagination Helper', () => {
  it('bypasses pagination when since is present for delta sync', () => {
    const result = parsePagination({ since: '2026-10-24T00:00:00.000Z', page: '2', limit: '10' });
    expect(result.isPaginated).toBe(false);
  });

  it('bypasses pagination when neither page nor limit is provided', () => {
    const result = parsePagination({});
    expect(result.isPaginated).toBe(false);
  });

  it('bypasses pagination when limit is "all"', () => {
    const result = parsePagination({ limit: 'all' });
    expect(result.isPaginated).toBe(false);
  });

  it('parses pagination with page and limit correctly', () => {
    const result = parsePagination({ page: '2', limit: '15' });
    expect(result.isPaginated).toBe(true);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(15);
    expect(result.skip).toBe(15);
    expect(result.take).toBe(15);
  });

  it('clamps limit to maximum 100', () => {
    const result = parsePagination({ page: '1', limit: '500' });
    expect(result.isPaginated).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.take).toBe(100);
  });

  it('defaults page to 1 when negative or invalid', () => {
    const result = parsePagination({ page: '-5', limit: '20' });
    expect(result.isPaginated).toBe(true);
    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('builds paginated envelope correctly', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const response = buildPaginatedResponse(items, 45, 2, 10);
    expect(response.total).toBe(45);
    expect(response.page).toBe(2);
    expect(response.limit).toBe(10);
    expect(response.totalPages).toBe(5);
    expect(response.hasMore).toBe(true);
    expect(response.items).toEqual(items);
  });

  it('calculates hasMore as false on the last page', () => {
    const items = [{ id: '41' }];
    const response = buildPaginatedResponse(items, 41, 5, 10);
    expect(response.totalPages).toBe(5);
    expect(response.hasMore).toBe(false);
  });
});
