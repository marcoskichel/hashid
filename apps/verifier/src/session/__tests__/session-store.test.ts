import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStore } from '@hashid/verifier/session/session-store.js';

describe('SessionStore', () => {
  let reclaimed: string[][];
  let store: SessionStore;

  beforeEach(() => {
    reclaimed = [];
    store = new SessionStore((challenges) => {
      reclaimed.push(challenges);
    });
  });

  afterEach(() => {
    store.destroy();
  });

  it('create returns a nonce and the challenges', () => {
    const { nonce, challenges } = store.create(['a', 'b', 'c']);
    expect(nonce).toMatch(/^[\da-f-]{36}$/);
    expect(challenges).toEqual(['a', 'b', 'c']);
  });

  it('consume returns the session for a valid nonce', () => {
    const { nonce } = store.create(['x', 'y']);
    const session = store.consume(nonce);
    expect(session?.challenges).toEqual(['x', 'y']);
  });

  it('consume returns undefined for an unknown nonce', () => {
    expect(store.consume('not-a-real-nonce')).toBeUndefined();
  });

  it('consume removes the session (single use)', () => {
    const { nonce } = store.create(['x']);
    store.consume(nonce);
    expect(store.consume(nonce)).toBeUndefined();
  });

  it('consume triggers onExpiry and returns undefined for expired sessions', () => {
    vi.useFakeTimers();
    const { nonce } = store.create(['expired-challenge']);
    vi.advanceTimersByTime(31_000);
    const session = store.consume(nonce);
    expect(session).toBeUndefined();
    expect(reclaimed).toEqual([['expired-challenge']]);
    vi.useRealTimers();
  });
});
