export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
}

export interface ParsedPagination {
  isPaginated: boolean;
  page: number;
  limit: number;
  skip?: number;
  take?: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

/**
 * Parses query parameters for server-side pagination.
 * Supports both (query, defaultLimit, maxLimit) and (query, options).
 * If `since` is present, delta sync takes precedence and pagination is disabled.
 * If neither `page` nor `limit` is present, or if `limit === 'all'`, pagination is disabled.
 */
export function parsePagination(
  query: Record<string, any>,
  defaultLimitOrOptions: number | PaginationOptions = 25,
  maxLimitArg: number = 100
): ParsedPagination {
  const opts: PaginationOptions = typeof defaultLimitOrOptions === 'object'
    ? defaultLimitOrOptions
    : { defaultLimit: defaultLimitOrOptions, maxLimit: maxLimitArg };

  const defaultLimit = opts.defaultLimit ?? 25;
  const maxLimit = opts.maxLimit ?? 100;
  const defaultSortBy = opts.defaultSortBy ?? 'createdAt';
  const defaultSortOrder = opts.defaultSortOrder ?? 'desc';

  const sortBy = (query.sortBy as string) || defaultSortBy;
  const sortOrder = ((query.sortOrder as string) || defaultSortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

  // If delta sync parameter is present, bypass pagination
  if (query.since) {
    return { isPaginated: false, page: 1, limit: defaultLimit, sortBy, sortOrder };
  }

  const rawPage = query.page;
  const rawLimit = query.limit;

  if (rawLimit === 'all') {
    return { isPaginated: false, page: 1, limit: defaultLimit, sortBy, sortOrder };
  }

  // Only paginate if at least one of page or limit is explicitly provided
  if (rawPage === undefined && rawLimit === undefined) {
    return { isPaginated: false, page: 1, limit: defaultLimit, sortBy, sortOrder };
  }

  let page = parseInt(String(rawPage || 1), 10);
  if (isNaN(page) || page < 1) page = 1;

  let limit = parseInt(String(rawLimit || defaultLimit), 10);
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const skip = (page - 1) * limit;
  const take = limit;

  return {
    isPaginated: true,
    page,
    limit,
    skip,
    take,
    sortBy,
    sortOrder,
  };
}

/**
 * Builds a standardized PaginatedResponse envelope.
 * Supports both buildPaginatedResponse(items, total, pagination)
 * and buildPaginatedResponse(items, total, page, limit).
 */
export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  pageOrPagination: number | ParsedPagination,
  limitArg?: number
): PaginatedResponse<T> {
  const page = typeof pageOrPagination === 'object' ? pageOrPagination.page : pageOrPagination;
  const limit = typeof pageOrPagination === 'object' ? pageOrPagination.limit : (limitArg || 25);
  const totalPages = Math.ceil(total / limit) || 1;
  const hasMore = page < totalPages;

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasMore,
  };
}
