import { createReadStream } from "node:fs";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import Fastify, {
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { writeTags } from "./tagWriter.js";

import {
  AdminSessionManager,
  AttemptLimiter,
  createPasswordVerifier,
  findToken,
  hashToken,
  PairingManager,
  tokenHasScope,
  verifyPassword,
} from "./auth.js";
import { MusicLibraryIndex } from "./library.js";
import { LibraryWatcher } from "./watcher.js";
import {
  ALL_TOKEN_SCOPES,
  type CompanionConfig,
  type DeviceToken,
  type IndexedTrack,
  type TokenScope,
} from "./types.js";

type ByteRange = { end: number; start: number };
type EditableMetadata = {
  album?: string;
  artist?: string;
  genre?: string;
  name?: string;
  track?: number;
  year?: number;
};

export function parseByteRange(header: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) return "invalid";

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

function mimeType(track: IndexedTrack) {
  const types: Record<string, string> = {
    AAC: "audio/aac",
    FLAC: "audio/flac",
    M4A: "audio/mp4",
    MP3: "audio/mpeg",
    OGG: "audio/ogg",
    OPUS: "audio/ogg",
    WAV: "audio/wav",
  };
  return types[track.extension] ?? "application/octet-stream";
}

function bearerToken(authorization: string | undefined) {
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  return match?.[1] ?? null;
}

async function directoryEntry(directoryPath: string) {
  try {
    const canonical = await realpath(directoryPath);
    if (!(await stat(canonical)).isDirectory()) return null;
    return { name: path.basename(canonical) || canonical, path: canonical };
  } catch {
    return null;
  }
}

async function listDirectories(requestedPath?: string) {
  if (!requestedPath) {
    const candidates =
      process.platform === "win32"
        ? [
            homedir(),
            ...Array.from({ length: 26 }, (_, index) =>
              String.fromCharCode(65 + index).concat(":\\"),
            ),
          ]
        : [homedir(), "/"];
    const entries = await Promise.all(candidates.map(directoryEntry));
    const unique = new Map(
      entries
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => [entry.path.toLocaleLowerCase(), entry]),
    );
    return { currentPath: null, parentPath: null, directories: [...unique.values()] };
  }

  const currentPath = await realpath(requestedPath);
  if (!(await stat(currentPath)).isDirectory()) {
    throw new Error("The selected path is not a directory.");
  }
  const entries = await readdir(currentPath, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => directoryEntry(path.join(currentPath, entry.name))),
    )
  )
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
  const parent = path.dirname(currentPath);
  return {
    currentPath,
    parentPath: parent === currentPath ? null : parent,
    directories,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pageHtml(content: string, script: string, nonce: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>HomeAudioPlayer Companion</title>
<style nonce="${nonce}">body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px;color:#18212f}section{border:1px solid #d8dee8;border-radius:14px;padding:20px;margin:16px 0}textarea,input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #aab4c3}textarea{width:100%;box-sizing:border-box}button{background:#2563eb;color:white;border:0;cursor:pointer;margin-right:8px}.danger{background:#b42318}.secondary{background:#475467}.muted{color:#637083}code{display:block;background:#f1f5f9;padding:12px;border-radius:8px;overflow:auto}.device{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #e4e7ec;padding:12px 0}.error{color:#b42318}</style></head>
<body><h1>HomeAudioPlayer Companion</h1>${content}<script nonce="${nonce}">${script}</script></body></html>`;
}

function setupHtml(nonce: string) {
  return pageHtml(
    `<p class="muted">Set an admin password before configuring or pairing this companion.</p>
<section><h2>First-run setup</h2><p>Enter the setup code printed by the companion process and choose a password of at least 12 characters.</p>
<p><input id="code" autocomplete="one-time-code" placeholder="Setup code"></p>
<p><input id="password" type="password" autocomplete="new-password" placeholder="Admin password"></p>
<button id="submit">Secure companion</button><p id="message" class="error"></p></section>`,
    `document.querySelector('#submit').onclick=async()=>{const r=await fetch('/admin/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bootstrapCode:document.querySelector('#code').value,password:document.querySelector('#password').value})});if(r.ok){location.reload();return}const j=await r.json();document.querySelector('#message').textContent=j.error||'Setup failed.'};`,
    nonce,
  );
}

function loginHtml(nonce: string) {
  return pageHtml(
    `<p class="muted">Sign in to manage folders, pairing, and paired devices.</p>
<section><h2>Admin sign in</h2><p><input id="password" type="password" autocomplete="current-password" placeholder="Admin password"></p>
<button id="submit">Sign in</button><p id="message" class="error"></p></section>`,
    `document.querySelector('#submit').onclick=async()=>{const r=await fetch('/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.querySelector('#password').value})});if(r.ok){location.reload();return}const j=await r.json();document.querySelector('#message').textContent=j.error||'Sign in failed.'};`,
    nonce,
  );
}

function adminHtml(
  config: CompanionConfig,
  index: MusicLibraryIndex,
  csrfToken: string,
  nonce: string,
) {
  const roots = escapeHtml(config.libraryRoots.join("\n"));
  const devices = config.tokens.length
    ? config.tokens
        .map(
          (token) =>
            `<div class="device"><div><strong>${escapeHtml(token.label)}</strong><div class="muted">${escapeHtml(token.createdAt)}${token.tailscaleLogin ? ` · ${escapeHtml(token.tailscaleLogin)}` : ""}<br>${token.scopes.includes("library:manage") ? "Full mobile access" : "Read-only playback"}</div></div><div><button class="secondary scope" data-id="${escapeHtml(token.id)}" data-mode="${token.scopes.includes("library:manage") ? "read" : "full"}">${token.scopes.includes("library:manage") ? "Make read-only" : "Allow management"}</button><button class="danger revoke" data-id="${escapeHtml(token.id)}">Revoke</button></div></div>`,
        )
        .join("")
    : `<p class="muted">No phones are paired.</p>`;
  return pageHtml(
    `<p class="muted">Authenticated local administration.</p>
<section><h2>Music folders</h2><textarea id="roots" rows="6" placeholder="C:\\Users\\you\\Music">${roots}</textarea><p><button id="saveRoots">Save and rescan</button></p><p id="scan">${index.count} tracks indexed · revision ${index.revision}${index.scannedAt ? ` · last scan ${escapeHtml(index.scannedAt)}` : ""}</p><p class="muted">New, changed, and removed files are picked up automatically while the companion runs.</p></section>
<section><h2>Private Tailscale HTTPS</h2><p>Run this in an Administrator PowerShell window after signing into Tailscale:</p><code>tailscale serve --bg ${config.apiPort}</code><p class="muted">Use Serve, not Funnel. Use the resulting https://*.ts.net address in the mobile app.</p></section>
<section><h2>Pair a phone</h2><button id="pair">Generate pairing code</button><h3 id="code"></h3></section>
<section><h2>Paired devices</h2>${devices}<p><button id="revokeAll" class="danger">Revoke all devices</button></p></section>
<button id="logout" class="secondary">Sign out</button>`,
    `const csrf=${JSON.stringify(csrfToken)};const headers={'x-csrf-token':csrf};const jsonHeaders={...headers,'content-type':'application/json'};
async function json(r){const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed.');return j}
document.querySelector('#saveRoots').onclick=async()=>{const libraryRoots=document.querySelector('#roots').value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);document.querySelector('#scan').textContent='Scanning…';try{const j=await json(await fetch('/admin/roots',{method:'POST',headers:jsonHeaders,body:JSON.stringify({libraryRoots})}));document.querySelector('#scan').textContent=j.count+' tracks indexed'}catch(e){document.querySelector('#scan').textContent='Scan failed: '+e.message}};
document.querySelector('#pair').onclick=async()=>{try{const j=await json(await fetch('/admin/pair',{method:'POST',headers}));document.querySelector('#code').textContent=j.code+' (expires '+new Date(j.expiresAt).toLocaleTimeString()+')'}catch(e){document.querySelector('#code').textContent=e.message}};
for(const button of document.querySelectorAll('.revoke'))button.onclick=async()=>{if(confirm('Revoke this device?')){await json(await fetch('/admin/tokens/'+encodeURIComponent(button.dataset.id),{method:'DELETE',headers}));location.reload()}};
for(const button of document.querySelectorAll('.scope'))button.onclick=async()=>{await json(await fetch('/admin/tokens/'+encodeURIComponent(button.dataset.id)+'/scopes',{method:'PATCH',headers:jsonHeaders,body:JSON.stringify({mode:button.dataset.mode})}));location.reload()};
document.querySelector('#revokeAll').onclick=async()=>{if(confirm('Revoke every paired device?')){await json(await fetch('/admin/tokens',{method:'DELETE',headers}));location.reload()}};
document.querySelector('#logout').onclick=async()=>{await fetch('/admin/logout',{method:'POST',headers});location.reload()};`,
    nonce,
  );
}

export function buildServers(
  config: CompanionConfig,
  saveConfig: (config: CompanionConfig) => Promise<void>,
  options: { bootstrapCode?: string; indexStoragePath?: string; watchLibrary?: boolean } = {},
) {
  const pairing = new PairingManager();
  const adminSessions = new AdminSessionManager();
  const loginLimiter = new AttemptLimiter();
  const pairingLimiter = new AttemptLimiter(12, 15 * 60 * 1000);
  const authenticatedTokens = new WeakMap<object, DeviceToken>();
  const index = new MusicLibraryIndex(config.serverId, options.indexStoragePath);
  const api = Fastify({ logger: true });
  const admin = Fastify({ logger: true });
  const watcher = options.watchLibrary ? new LibraryWatcher(index, api.log) : null;
  const rescanRoots = async () => {
    const count = await index.scan(config.libraryRoots);
    await watcher?.start(config.libraryRoots);
    return count;
  };

  const audit = (event: string, details: Record<string, unknown> = {}) => {
    api.log.info({ audit: event, ...details }, "security audit");
  };

  const requiredScope = (method: string, pathname: string): TokenScope | null => {
    if (
      (pathname === "/api/v1/library" || pathname === "/api/v1/library/changes") &&
      method === "GET"
    ) {
      return "library:read";
    }
    if (/^\/api\/v1\/tracks\/[^/]+\/artwork$/.test(pathname) && method === "GET") {
      return "library:read";
    }
    if (
      /^\/api\/v1\/tracks\/[^/]+\/stream$/.test(pathname) &&
      (method === "GET" || method === "HEAD")
    ) {
      return "stream:read";
    }
    if (/^\/api\/v1\/tracks\/[^/]+\/metadata$/.test(pathname) && method === "PATCH") {
      return "metadata:write";
    }
    if (pathname === "/api/v1/directories" && method === "GET") return "library:manage";
    if (pathname === "/api/v1/library/roots" && method === "POST") return "library:manage";
    return null;
  };

  api.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0];
    if (pathname === "/api/v1/health" || pathname === "/api/v1/pair") return;
    const token = bearerToken(request.headers.authorization);
    const record = token ? findToken(token, config.tokens) : undefined;
    const tailscaleLogin = request.headers["tailscale-user-login"];
    if (
      !record ||
      (record.tailscaleLogin &&
        (typeof tailscaleLogin !== "string" || tailscaleLogin !== record.tailscaleLogin))
    ) {
      return reply.code(401).send({ error: "Authentication required." });
    }
    const scope = requiredScope(request.method, pathname ?? "");
    if (scope && !tokenHasScope(record, scope)) {
      return reply.code(403).send({ error: "This device is not allowed to perform that action." });
    }
    authenticatedTokens.set(request, record);
  });

  api.get("/api/v1/health", async () => ({
    apiVersion: 1,
    epoch: index.epoch,
    revision: index.revision,
    serverId: config.serverId,
    trackCount: index.count,
  }));

  api.post<{ Body: { code?: string; label?: string } }>("/api/v1/pair", async (request, reply) => {
    if (!pairingLimiter.allow(request.ip)) {
      return reply.code(429).send({ error: "Too many pairing attempts. Try again later." });
    }
    const token = pairing.exchange(request.body?.code?.trim() ?? "");
    if (!token) {
      pairingLimiter.recordFailure(request.ip);
      return reply.code(401).send({ error: "Invalid or expired pairing code." });
    }
    pairingLimiter.reset(request.ip);
    const tailscaleLogin = request.headers["tailscale-user-login"];
    const label =
      typeof request.body?.label === "string" && request.body.label.trim()
        ? request.body.label.trim().slice(0, 100)
        : "HomeAudioPlayer phone";
    const record: DeviceToken = {
      createdAt: new Date().toISOString(),
      hash: hashToken(token),
      id: randomUUID(),
      label,
      scopes: [...ALL_TOKEN_SCOPES],
      ...(typeof tailscaleLogin === "string" ? { tailscaleLogin } : {}),
    };
    config.tokens.push(record);
    await saveConfig(config);
    audit("device.paired", { deviceId: record.id, tailscaleLogin: record.tailscaleLogin });
    return { deviceId: record.id, serverId: config.serverId, token };
  });

  api.delete("/api/v1/session", async (request, reply) => {
    const record = authenticatedTokens.get(request);
    if (!record) return reply.code(401).send({ error: "Authentication required." });
    config.tokens = config.tokens.filter((item) => item.id !== record.id);
    await saveConfig(config);
    audit("device.self_revoked", { deviceId: record.id });
    return reply.code(204).send();
  });

  api.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/api/v1/library",
    async (request) => {
      const offset = Math.max(Number.parseInt(request.query.offset ?? "0", 10) || 0, 0);
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? "250", 10) || 250, 1), 1000);
      return { serverId: config.serverId, scannedAt: index.scannedAt, ...index.list(offset, limit) };
    },
  );

  api.get<{ Querystring: { epoch?: string; limit?: string; since?: string } }>(
    "/api/v1/library/changes",
    async (request) => {
      const since = Math.max(Number.parseInt(request.query.since ?? "0", 10) || 0, 0);
      const limit = Math.min(Math.max(Number.parseInt(request.query.limit ?? "500", 10) || 500, 1), 1000);
      return { serverId: config.serverId, ...index.changesSince(since, request.query.epoch, limit) };
    },
  );

  api.get<{ Querystring: { path?: string } }>(
    "/api/v1/directories",
    async (request, reply) => {
      try {
        return {
          ...(await listDirectories(request.query.path)),
          selectedPaths: config.libraryRoots,
        };
      } catch {
        return reply.code(404).send({ error: "That directory is unavailable." });
      }
    },
  );

  api.post<{ Body: { paths?: string[] } }>(
    "/api/v1/library/roots",
    async (request, reply) => {
      if (
        !Array.isArray(request.body?.paths) ||
        request.body.paths.some((item) => typeof item !== "string")
      ) {
        return reply.code(400).send({ error: "paths must be an array of directories." });
      }
      const canonical = await Promise.all(request.body.paths.map(directoryEntry));
      if (canonical.some((entry) => !entry)) {
        return reply.code(400).send({ error: "One or more directories are unavailable." });
      }
      config.libraryRoots = [
        ...new Set(
          canonical
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
            .map((entry) => entry.path),
        ),
      ];
      await saveConfig(config);
      const count = await rescanRoots();
      audit("library.roots_changed", {
        deviceId: authenticatedTokens.get(request)?.id,
        rootCount: config.libraryRoots.length,
      });
      return { count, selectedPaths: config.libraryRoots };
    },
  );

  api.get<{ Params: { id: string } }>("/api/v1/tracks/:id/artwork", async (request, reply) => {
    const artwork = await index.getArtwork(request.params.id);
    if (!artwork) return reply.code(404).send({ error: "Artwork not found." });
    return reply.type(artwork.mimeType).send(Buffer.from(artwork.data));
  });

  api.patch<{ Body: EditableMetadata; Params: { id: string } }>(
    "/api/v1/tracks/:id/metadata",
    async (request, reply) => {
      const track = index.getTrack(request.params.id);
      if (!track) return reply.code(404).send({ error: "Track not found." });
      const metadata = request.body;
      if (
        !metadata ||
        typeof metadata !== "object" ||
        [metadata.album, metadata.artist, metadata.genre, metadata.name].some(
          (value) => value !== undefined && (typeof value !== "string" || value.length > 1000),
        ) ||
        [metadata.track, metadata.year].some(
          (value) =>
            value !== undefined &&
            (!Number.isInteger(value) || value < 0 || value > 999999),
        )
      ) {
        return reply.code(400).send({ error: "Invalid metadata." });
      }
      if (track.size > 512 * 1024 * 1024) {
        return reply.code(413).send({ error: "This audio file is too large to edit safely." });
      }

      const original = await readFile(track.filePath);
      const modified = await writeTags(
        { data: original, filename: path.basename(track.filePath) },
        {
          album: metadata.album,
          artist: metadata.artist,
          genre: metadata.genre,
          title: metadata.name,
          track: metadata.track ?? 0,
          year: metadata.year ?? 0,
        },
      );
      if (!modified) {
        return reply.code(422).send({
          error: `${track.extension} metadata could not be updated.`,
        });
      }

      const suffix = randomUUID();
      const temporaryPath = `${track.filePath}.hap-write-${suffix}`;
      const backupPath = `${track.filePath}.hap-backup-${suffix}`;
      const fileStats = await stat(track.filePath);
      await writeFile(temporaryPath, modified, { mode: fileStats.mode });
      try {
        await rename(track.filePath, backupPath);
        try {
          await rename(temporaryPath, track.filePath);
        } catch (error) {
          await rename(backupPath, track.filePath);
          throw error;
        }
        await rm(backupPath, { force: true }).catch(() => undefined);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }

      await index.reindexPaths([track.filePath]);
      audit("track.metadata_changed", {
        deviceId: authenticatedTokens.get(request)?.id,
        trackId: request.params.id,
      });
      return { track: index.getPublicTrack(request.params.id) };
    },
  );

  const streamTrack = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const track = index.getTrack(request.params.id);
    if (!track) return reply.code(404).send({ error: "Track not found." });
    const range = parseByteRange(request.headers.range, track.size);
    reply.header("Accept-Ranges", "bytes").type(mimeType(track));
    if (range === "invalid") {
      return reply.header("Content-Range", `bytes */${track.size}`).code(416).send();
    }
    if (range) {
      const length = range.end - range.start + 1;
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${track.size}`);
      reply.header("Content-Length", length).code(206);
      if (request.method === "HEAD") return reply.send();
      return reply.send(createReadStream(track.filePath, range));
    }
    reply.header("Content-Length", track.size);
    if (request.method === "HEAD") return reply.send();
    return reply.send(createReadStream(track.filePath));
  };

  api.route({ method: ["GET", "HEAD"], url: "/api/v1/tracks/:id/stream", handler: streamTrack });

  const cookieValue = (header: string | undefined, name: string) =>
    header
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === name)?.[1];
  const sessionFor = (request: FastifyRequest) =>
    adminSessions.get(cookieValue(request.headers.cookie, "hap_admin"));
  const validAdminOrigin = (request: FastifyRequest) => {
    const host = request.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return false;
    return request.headers.origin === `http://${host}`;
  };
  const requireAdmin = (request: FastifyRequest, reply: FastifyReply) => {
    const session = sessionFor(request);
    if (!session) {
      reply.code(401).send({ error: "Admin sign-in required." });
      return null;
    }
    if (
      !validAdminOrigin(request) ||
      request.headers["x-csrf-token"] !== session.csrfToken
    ) {
      reply.code(403).send({ error: "Invalid admin request." });
      return null;
    }
    return session;
  };
  const setSessionCookie = (reply: FastifyReply, id: string) =>
    reply.header(
      "Set-Cookie",
      `hap_admin=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 60 * 60}`,
    );
  const bootstrapMatches = (supplied: string) => {
    if (!options.bootstrapCode) return false;
    const left = Buffer.from(supplied);
    const right = Buffer.from(options.bootstrapCode);
    return left.length === right.length && timingSafeEqual(left, right);
  };

  admin.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    const host = request.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      return reply.code(400).send({ error: "Invalid host." });
    }
  });

  admin.get("/", async (request, reply) => {
    const nonce = randomBytes(16).toString("base64");
    reply
      .header(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      )
      .type("text/html");
    if (!config.adminPassword) return reply.send(setupHtml(nonce));
    const session = sessionFor(request);
    return reply.send(
      session ? adminHtml(config, index, session.csrfToken, nonce) : loginHtml(nonce),
    );
  });

  admin.post<{ Body: { bootstrapCode?: string; password?: string } }>(
    "/admin/setup",
    async (request, reply) => {
      if (config.adminPassword) {
        return reply.code(409).send({ error: "Admin password is already configured." });
      }
      if (!validAdminOrigin(request)) {
        return reply.code(403).send({ error: "Invalid setup request." });
      }
      const password = request.body?.password ?? "";
      if (!bootstrapMatches(request.body?.bootstrapCode ?? "")) {
        return reply.code(401).send({ error: "Invalid setup code." });
      }
      if (password.length < 12 || password.length > 1024) {
        return reply.code(400).send({ error: "Use an admin password of 12–1024 characters." });
      }
      config.adminPassword = await createPasswordVerifier(password);
      await saveConfig(config);
      const session = adminSessions.create();
      setSessionCookie(reply, session.id);
      audit("admin.configured");
      return { csrfToken: session.csrfToken, ok: true };
    },
  );

  admin.post<{ Body: { password?: string } }>("/admin/login", async (request, reply) => {
    if (!config.adminPassword) {
      return reply.code(409).send({ error: "Complete first-run setup." });
    }
    if (!validAdminOrigin(request)) {
      return reply.code(403).send({ error: "Invalid login request." });
    }
    if (!loginLimiter.allow(request.ip)) {
      return reply.code(429).send({ error: "Too many sign-in attempts. Try again later." });
    }
    if (!(await verifyPassword(request.body?.password ?? "", config.adminPassword))) {
      loginLimiter.recordFailure(request.ip);
      audit("admin.login_failed", { ip: request.ip });
      return reply.code(401).send({ error: "Invalid admin password." });
    }
    loginLimiter.reset(request.ip);
    const session = adminSessions.create();
    setSessionCookie(reply, session.id);
    audit("admin.login_succeeded");
    return { csrfToken: session.csrfToken };
  });

  admin.post("/admin/logout", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    adminSessions.delete(cookieValue(request.headers.cookie, "hap_admin"));
    reply.header("Set-Cookie", "hap_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return reply.code(204).send();
  });

  admin.post<{ Body: { libraryRoots?: string[] } }>("/admin/roots", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!Array.isArray(request.body?.libraryRoots)) {
      return reply.code(400).send({ error: "libraryRoots must be an array." });
    }
    if (request.body.libraryRoots.some((root) => typeof root !== "string")) {
      return reply.code(400).send({ error: "libraryRoots must contain only paths." });
    }
    const canonical = await Promise.all(request.body.libraryRoots.map(directoryEntry));
    if (canonical.some((entry) => !entry)) {
      return reply.code(400).send({ error: "One or more directories are unavailable." });
    }
    config.libraryRoots = canonical
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => entry.path);
    await saveConfig(config);
    try {
      const count = await rescanRoots();
      audit("library.roots_changed", { actor: "admin", rootCount: config.libraryRoots.length });
      return { count };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "Scan failed." });
    }
  });

  admin.post("/admin/pair", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    audit("pairing.code_created");
    return pairing.createCode();
  });

  admin.delete<{ Params: { id: string } }>("/admin/tokens/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const before = config.tokens.length;
    config.tokens = config.tokens.filter((token) => token.id !== request.params.id);
    if (config.tokens.length === before) {
      return reply.code(404).send({ error: "Paired device not found." });
    }
    await saveConfig(config);
    audit("device.admin_revoked", { deviceId: request.params.id });
    return reply.code(204).send();
  });

  admin.delete("/admin/tokens", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const count = config.tokens.length;
    config.tokens = [];
    await saveConfig(config);
    audit("device.all_revoked", { count });
    return reply.code(204).send();
  });

  admin.patch<{ Body: { mode?: string }; Params: { id: string } }>(
    "/admin/tokens/:id/scopes",
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return;
      const token = config.tokens.find((item) => item.id === request.params.id);
      if (!token) return reply.code(404).send({ error: "Paired device not found." });
      if (request.body?.mode !== "read" && request.body?.mode !== "full") {
        return reply.code(400).send({ error: "Mode must be read or full." });
      }
      token.scopes =
        request.body.mode === "full"
          ? [...ALL_TOKEN_SCOPES]
          : ["library:read", "stream:read"];
      await saveConfig(config);
      audit("device.scopes_changed", { deviceId: token.id, mode: request.body.mode });
      return { scopes: token.scopes };
    },
  );

  return { admin, api, index, rescanRoots, watcher };
}
