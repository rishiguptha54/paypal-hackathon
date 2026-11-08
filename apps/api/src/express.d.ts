import type { Logger } from './logger';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      sessionId: string;
    }
  }
}

export {};
