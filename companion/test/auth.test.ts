import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminSessionManager,
  AttemptLimiter,
  createPasswordVerifier,
  verifyPassword,
} from "../src/auth.js";

test("admin passwords are salted and verified with scrypt", async () => {
  const first = await createPasswordVerifier("a sufficiently long password");
  const second = await createPasswordVerifier("a sufficiently long password");

  assert.notEqual(first.salt, second.salt);
  assert.equal(await verifyPassword("a sufficiently long password", first), true);
  assert.equal(await verifyPassword("the wrong password", first), false);
});

test("admin sessions carry CSRF tokens and can be revoked", () => {
  const sessions = new AdminSessionManager();
  const created = sessions.create();

  assert.equal(sessions.get(created.id)?.csrfToken, created.csrfToken);
  sessions.delete(created.id);
  assert.equal(sessions.get(created.id), null);
});

test("attempt limiter blocks repeated failures and resets", () => {
  const limiter = new AttemptLimiter(2, 60_000);

  assert.equal(limiter.allow("client"), true);
  limiter.recordFailure("client");
  assert.equal(limiter.allow("client"), true);
  limiter.recordFailure("client");
  assert.equal(limiter.allow("client"), false);
  limiter.reset("client");
  assert.equal(limiter.allow("client"), true);
});
