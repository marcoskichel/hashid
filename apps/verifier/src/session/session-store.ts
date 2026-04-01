import { randomUUID } from 'node:crypto';

const SESSION_TTL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 5000;

interface Session {
  challenges: string[];
  expiresAt: number;
}

export interface SessionStartResult {
  nonce: string;
  challenges: string[];
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private onExpiry: (challenges: string[]) => void;

  constructor(onExpiry: (challenges: string[]) => void) {
    this.onExpiry = onExpiry;
    this.cleanupTimer = setInterval(() => {
      this.sweepExpired();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  create(challenges: string[]): SessionStartResult {
    const nonce = randomUUID();
    this.sessions.set(nonce, { challenges, expiresAt: Date.now() + SESSION_TTL_MS });
    return { nonce, challenges };
  }

  consume(nonce: string): Session | undefined {
    const session = this.sessions.get(nonce);
    if (!session) {
      return undefined;
    }
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(nonce);
      this.onExpiry(session.challenges);
      return undefined;
    }
    this.sessions.delete(nonce);
    return session;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [nonce, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(nonce);
        this.onExpiry(session.challenges);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}
