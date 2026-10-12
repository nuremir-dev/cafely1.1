import { describe, expect, it } from "vitest";

import { LoginAttemptStore } from "./login-attempts";

describe("LoginAttemptStore", () => {
  it("limits an identifier after the configured number of failed attempts", () => {
    const store = new LoginAttemptStore(2, 1_000);
    store.recordFailure("terminal-1", 10);
    expect(store.getRetryAfterSeconds("terminal-1", 20)).toBeNull();

    store.recordFailure("terminal-1", 30);
    expect(store.getRetryAfterSeconds("terminal-1", 40)).toBe(1);
  });

  it("expires attempts and clears them after a successful login", () => {
    const store = new LoginAttemptStore(1, 1_000);
    store.recordFailure("terminal-1", 10);
    expect(store.getRetryAfterSeconds("terminal-1", 1_011)).toBeNull();

    store.recordFailure("terminal-1", 2_000);
    store.clear("terminal-1");
    expect(store.getRetryAfterSeconds("terminal-1", 2_001)).toBeNull();
  });
});
