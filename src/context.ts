import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  userId: string;
  userName: string;
  sessionId?: string;
  requestId?: string;
  method?: string;
  route?: string;
  source?: string;
  reason?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();


