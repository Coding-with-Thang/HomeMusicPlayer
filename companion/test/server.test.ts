import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readTags } from "../src/tagWriter.js";

import { createTrackId, isPathInsideRoot } from "../src/library.js";
import { buildServers, parseByteRange } from "../src/server.js";
import { ALL_TOKEN_SCOPES } from "../src/types.js";
import type { CompanionConfig } from "../src/types.js";

test("path containment and stable IDs do not escape a configured root", () => {
  const root = path.resolve("C:/Music");
  assert.equal(isPathInsideRoot(root, path.join(root, "Album", "song.mp3")), true);
  assert.equal(isPathInsideRoot(root, path.resolve("C:/Windows/file.mp3")), false);
  assert.equal(
    createTrackId("server", root, path.join(root, "Album", "song.mp3")),
    createTrackId("server", root, path.join(root, "Album", "song.mp3")),
  );
});

test("range parser handles full, bounded, open, suffix, and invalid ranges", () => {
  assert.equal(parseByteRange(undefined, 100), null);
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-5", 100), { start: 95, end: 99 });
  assert.equal(parseByteRange("bytes=100-101", 100), "invalid");
  assert.equal(parseByteRange("items=1-2", 100), "invalid");
});

test("pairing protects the catalog and streams byte ranges", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "home-audio-player-"));
  const audio = Buffer.from("0123456789abcdefghij");
  await writeFile(path.join(directory, "test.mp3"), audio);
  await writeFile(path.join(directory, "second.mp3"), Buffer.from("second"));
  await mkdir(path.join(directory, "Album"));
  const canonicalRoot = await realpath(directory);
  const config: CompanionConfig = {
    adminPort: 47831,
    apiPort: 47832,
    configVersion: 2,
    libraryRoots: [canonicalRoot],
    serverId: "test-server",
    tokens: [],
  };
  const { admin, api, index } = buildServers(
    config,
    async () => undefined,
    { bootstrapCode: "test-bootstrap-code" },
  );

  try {
    await index.scan(config.libraryRoots);
    assert.equal(index.count, 2);

    const unauthorized = await api.inject({
      method: "GET",
      url: "/api/v1/library",
    });
    assert.equal(unauthorized.statusCode, 401);

    const blockedCode = await admin.inject({
      method: "POST",
      url: "/admin/pair",
    });
    assert.equal(blockedCode.statusCode, 401);

    const setup = await admin.inject({
      method: "POST",
      url: "/admin/setup",
      headers: { host: "localhost:80", origin: "http://localhost:80" },
      payload: {
        bootstrapCode: "test-bootstrap-code",
        password: "a secure test password",
      },
    });
    assert.equal(setup.statusCode, 200);
    const rejectedLogin = await admin.inject({
      method: "POST",
      url: "/admin/login",
      headers: { host: "localhost:80", origin: "http://localhost:80" },
      payload: { password: "wrong password" },
    });
    assert.equal(rejectedLogin.statusCode, 401);
    const login = await admin.inject({
      method: "POST",
      url: "/admin/login",
      headers: { host: "localhost:80", origin: "http://localhost:80" },
      payload: { password: "a secure test password" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const { csrfToken } = login.json<{ csrfToken: string }>();
    const adminHeaders = {
      cookie,
      host: "localhost:80",
      origin: "http://localhost:80",
      "x-csrf-token": csrfToken,
    };

    const blockedByCsrf = await admin.inject({
      method: "POST",
      url: "/admin/pair",
      headers: {
        cookie,
        host: "localhost:80",
        origin: "http://localhost:80",
      },
    });
    assert.equal(blockedByCsrf.statusCode, 403);

    const codeResponse = await admin.inject({
      method: "POST",
      url: "/admin/pair",
      headers: adminHeaders,
    });
    const { code } = codeResponse.json<{ code: string }>();
    const rejectedPairing = await api.inject({
      method: "POST",
      url: "/api/v1/pair",
      payload: { code: code === "000000" ? "000001" : "000000" },
    });
    assert.equal(rejectedPairing.statusCode, 401);
    const pairing = await api.inject({
      method: "POST",
      url: "/api/v1/pair",
      headers: { "tailscale-user-login": "listener@example.com" },
      payload: { code },
    });
    assert.equal(pairing.statusCode, 200);
    const { deviceId, token } = pairing.json<{ deviceId: string; token: string }>();
    const authorization = `Bearer ${token}`;
    const apiHeaders = {
      authorization,
      "tailscale-user-login": "listener@example.com",
    };

    const health = await api.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.headers["access-control-allow-origin"], undefined);

    const wrongIdentity = await api.inject({
      method: "GET",
      url: "/api/v1/library",
      headers: {
        authorization,
        "tailscale-user-login": "attacker@example.com",
      },
    });
    assert.equal(wrongIdentity.statusCode, 401);

    const readOnly = await admin.inject({
      method: "PATCH",
      url: `/admin/tokens/${deviceId}/scopes`,
      headers: adminHeaders,
      payload: { mode: "read" },
    });
    assert.equal(readOnly.statusCode, 200);
    const forbiddenDirectories = await api.inject({
      method: "GET",
      url: `/api/v1/directories?path=${encodeURIComponent(canonicalRoot)}`,
      headers: apiHeaders,
    });
    assert.equal(forbiddenDirectories.statusCode, 403);
    const fullAccess = await admin.inject({
      method: "PATCH",
      url: `/admin/tokens/${deviceId}/scopes`,
      headers: adminHeaders,
      payload: { mode: "full" },
    });
    assert.equal(fullAccess.statusCode, 200);
    assert.deepEqual(config.tokens[0]?.scopes, [...ALL_TOKEN_SCOPES]);

    const directories = await api.inject({
      method: "GET",
      url: `/api/v1/directories?path=${encodeURIComponent(canonicalRoot)}`,
      headers: apiHeaders,
    });
    assert.equal(directories.statusCode, 200);
    assert.equal(
      directories
        .json<{ directories: { name: string }[] }>()
        .directories.some((item) => item.name === "Album"),
      true,
    );

    const saveRoots = await api.inject({
      method: "POST",
      url: "/api/v1/library/roots",
      headers: apiHeaders,
      payload: { paths: [canonicalRoot] },
    });
    assert.equal(saveRoots.statusCode, 200);
    assert.equal(saveRoots.json<{ count: number }>().count, 2);

    const library = await api.inject({
      method: "GET",
      url: "/api/v1/library?limit=1",
      headers: apiHeaders,
    });
    const page = library.json<{
      items: { id: string; name: string }[];
      nextOffset: number | null;
      total: number;
    }>();
    assert.equal(page.total, 2);
    assert.equal(page.nextOffset, 1);
    const streamedTrack = page.items.find((item) => item.name === "test");
    const trackId =
      streamedTrack?.id ??
      index.list(0, 10).items.find((item) => item.name === "test")?.id;
    assert.ok(trackId);

    const full = await api.inject({
      method: "GET",
      url: `/api/v1/tracks/${trackId}/stream`,
      headers: apiHeaders,
    });
    assert.equal(full.statusCode, 200);
    assert.equal(full.rawPayload.toString(), audio.toString());
    assert.equal(full.headers["accept-ranges"], "bytes");

    const partial = await api.inject({
      method: "GET",
      url: `/api/v1/tracks/${trackId}/stream`,
      headers: { ...apiHeaders, range: "bytes=5-9" },
    });
    assert.equal(partial.statusCode, 206);
    assert.equal(partial.rawPayload.toString(), "56789");
    assert.equal(partial.headers["content-range"], `bytes 5-9/${audio.length}`);

    const head = await api.inject({
      method: "HEAD",
      url: `/api/v1/tracks/${trackId}/stream`,
      headers: apiHeaders,
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.rawPayload.length, 0);

    const invalid = await api.inject({
      method: "GET",
      url: `/api/v1/tracks/${trackId}/stream`,
      headers: { ...apiHeaders, range: `bytes=${audio.length}-` },
    });
    assert.equal(invalid.statusCode, 416);

    const metadata = await api.inject({
      method: "PATCH",
      url: `/api/v1/tracks/${trackId}/metadata`,
      headers: apiHeaders,
      payload: {
        album: "Test Album",
        artist: "Test Artist",
        genre: "Test Genre",
        name: "Changed Title",
        track: 3,
        year: 2026,
      },
    });
    assert.equal(metadata.statusCode, 200);
    assert.equal(
      metadata.json<{ track: { name: string } }>().track.name,
      "Changed Title",
    );
    const savedTags = await readTags({
      data: await readFile(path.join(directory, "test.mp3")),
      filename: "test.mp3",
    });
    assert.equal(savedTags.title, "Changed Title");
    assert.equal(savedTags.artist, "Test Artist");
    assert.equal(savedTags.album, "Test Album");

    const revoked = await api.inject({
      method: "DELETE",
      url: "/api/v1/session",
      headers: apiHeaders,
    });
    assert.equal(revoked.statusCode, 204);
    const afterRevoke = await api.inject({
      method: "GET",
      url: "/api/v1/library",
      headers: apiHeaders,
    });
    assert.equal(afterRevoke.statusCode, 401);
  } finally {
    await Promise.all([admin.close(), api.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
