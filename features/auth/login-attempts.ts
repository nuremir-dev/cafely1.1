import "server-only";

type Attempt = { count: number; resetAt: number };

export class LoginAttemptStore {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  getRetryAfterSeconds(identifier: string, now = Date.now()): number | null {
    const attempt = this.attempts.get(identifier);
    if (!attempt) return null;

    if (attempt.resetAt <= now) {
      this.attempts.delete(identifier);
      return null;
    }

    if (attempt.count < this.maxAttempts) return null;
    return Math.max(1, Math.ceil((attempt.resetAt - now) / 1000));
  }

  recordFailure(identifier: string, now = Date.now()) {
    const current = this.attempts.get(identifier);
    if (!current || current.resetAt <= now) {
      this.attempts.set(identifier, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    this.attempts.set(identifier, { ...current, count: current.count + 1 });
  }

  clear(identifier: string) {
    this.attempts.delete(identifier);
  }
}
