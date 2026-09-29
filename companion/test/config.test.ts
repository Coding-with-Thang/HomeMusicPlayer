import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConfig } from "../src/config.js";
import { ALL_TOKEN_SCOPES } from "../src/types.js";

test("legacy token hashes migrate to scoped device records", () => {
  const migrated = normalizeConfig({
    adminPort: 47831,
    apiPort: 47832,
    libraryRoots: ["C:\\Music"],
    serverId: "server",
    tokenHashes: ["abc123"],
  });

  assert.ok(migrated);
  assert.equal(migrated.configVersion, 2);
  assert.equal(migrated.tokens[0]?.hash, "abc123");
  assert.deepEqual(migrated.tokens[0]?.scopes, [...ALL_TOKEN_SCOPES]);
});

test("invalid persisted credentials are rejected", () => {
  assert.equal(
    normalizeConfig({
      adminPort: 47831,
      apiPort: 47832,
      configVersion: 2,
      libraryRoots: [],
      serverId: "server",
      tokens: [{ hash: "missing required token fields" }],
    }),
    null,
  );
});
