import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseFile } from "music-metadata";

import type { IndexedTrack, LibraryChanges, PublicTrack, TrackArtwork } from "./types.js";

const supportedExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
]);

const INDEX_FORMAT_VERSION = 1;
const MAX_TOMBSTONES = 10_000;
const ARTWORK_CACHE_SIZE = 64;
const PERSIST_DELAY_MS = 1000;

type PersistedIndex = {
  epoch: string;
  minRevision: number;
  revision: number;
  serverId: string;
  tombstones: [string, number][];
  tracks: IndexedTrack[];
  version: number;
};

export function isSupportedAudioPath(filePath: string) {
  return supportedExtensions.has(path.extname(filePath).toLowerCase());
}

export function isPathInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function createTrackId(serverId: string, root: string, filePath: string) {
  const identity = `${serverId}\0${path.relative(root, filePath).replaceAll("\\", "/").toLowerCase()}`;
  return createHash("sha256").update(identity).digest("base64url");
}

function publicTrack(track: IndexedTrack): PublicTrack {
  const { filePath: _filePath, mtimeMs: _mtimeMs, ...metadata } = track;
  return metadata;
}

function isIndexedTrack(value: unknown): value is IndexedTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<IndexedTrack>;
  return (
    typeof track.id === "string" &&
    typeof track.filePath === "string" &&
    typeof track.name === "string" &&
    typeof track.artist === "string" &&
    typeof track.extension === "string" &&
    typeof track.size === "number" &&
    typeof track.mtimeMs === "number" &&
    typeof track.revision === "number" &&
    typeof track.hasArtwork === "boolean"
  );
}

function sameMetadata(left: IndexedTrack, right: IndexedTrack) {
  return (
    left.album === right.album &&
    left.albumArtist === right.albumArtist &&
    left.artist === right.artist &&
    left.extension === right.extension &&
    left.filePath === right.filePath &&
    left.genre === right.genre &&
    left.hasArtwork === right.hasArtwork &&
    left.name === right.name &&
    left.size === right.size &&
    left.track === right.track &&
    left.year === right.year
  );
}

export class MusicLibraryIndex {
  private tracks = new Map<string, IndexedTrack>();
  private tombstones = new Map<string, number>();
  private roots: string[] = [];
  private lastScanAt: string | null = null;
  private currentEpoch: string = randomUUID();
  private currentRevision = 0;
  private minRevision = 0;
  private work: Promise<unknown> = Promise.resolve();
  private persistTimer: NodeJS.Timeout | null = null;
  private persistWrite: Promise<void> = Promise.resolve();
  private artworkCache = new Map<string, TrackArtwork | null>();
  private listeners = new Set<(revision: number) => void>();

  constructor(
    private readonly serverId: string,
    private readonly storagePath?: string,
  ) {}

  get count() {
    return this.tracks.size;
  }

  get scannedAt() {
    return this.lastScanAt;
  }

  get revision() {
    return this.currentRevision;
  }

  get epoch() {
    return this.currentEpoch;
  }

  onChange(listener: (revision: number) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getTrack(id: string) {
    return this.tracks.get(id);
  }

  getPublicTrack(id: string) {
    const track = this.tracks.get(id);
    return track ? publicTrack(track) : null;
  }

  list(offset: number, limit: number) {
    const all = [...this.tracks.values()].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return {
      epoch: this.currentEpoch,
      items: all.slice(offset, offset + limit).map(publicTrack),
      nextOffset: offset + limit < all.length ? offset + limit : null,
      revision: this.currentRevision,
      total: all.length,
    };
  }

  changesSince(since: number, epoch: string | undefined, limit: number): LibraryChanges {
    if (epoch !== this.currentEpoch || since < this.minRevision || since > this.currentRevision) {
      return {
        deletes: [],
        epoch: this.currentEpoch,
        nextSince: null,
        resetRequired: true,
        revision: this.currentRevision,
        upserts: [],
      };
    }

    const changes: { id: string; revision: number; track?: IndexedTrack }[] = [];
    for (const track of this.tracks.values()) {
      if (track.revision > since) changes.push({ id: track.id, revision: track.revision, track });
    }
    for (const [id, revision] of this.tombstones) {
      if (revision > since) changes.push({ id, revision });
    }
    changes.sort((left, right) => left.revision - right.revision);
    const page = changes.slice(0, limit);
    const hasMore = changes.length > limit;
    return {
      deletes: page.filter((change) => !change.track).map((change) => change.id),
      epoch: this.currentEpoch,
      nextSince: hasMore ? (page.at(-1)?.revision ?? null) : null,
      resetRequired: false,
      revision: hasMore ? (page.at(-1)?.revision ?? this.currentRevision) : this.currentRevision,
      upserts: page.flatMap((change) => (change.track ? [publicTrack(change.track)] : [])),
    };
  }

  async getArtwork(id: string): Promise<TrackArtwork | null> {
    const track = this.tracks.get(id);
    if (!track?.hasArtwork) return null;
    const cacheKey = `${id}:${track.revision}`;
    if (this.artworkCache.has(cacheKey)) return this.artworkCache.get(cacheKey) ?? null;
    let artwork: TrackArtwork | null = null;
    try {
      const metadata = await parseFile(track.filePath, { duration: false });
      const picture = metadata.common.picture?.[0];
      artwork = picture ? { data: picture.data, mimeType: picture.format } : null;
    } catch {
      artwork = null;
    }
    this.artworkCache.set(cacheKey, artwork);
    while (this.artworkCache.size > ARTWORK_CACHE_SIZE) {
      const oldest = this.artworkCache.keys().next().value;
      if (oldest === undefined) break;
      this.artworkCache.delete(oldest);
    }
    return artwork;
  }

  async load() {
    if (!this.storagePath) return false;
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, "utf8")) as Partial<PersistedIndex>;
      if (
        parsed.version !== INDEX_FORMAT_VERSION ||
        parsed.serverId !== this.serverId ||
        typeof parsed.epoch !== "string" ||
        typeof parsed.revision !== "number" ||
        typeof parsed.minRevision !== "number" ||
        !Array.isArray(parsed.tracks) ||
        !parsed.tracks.every(isIndexedTrack) ||
        !Array.isArray(parsed.tombstones)
      ) {
        return false;
      }
      this.tracks = new Map(parsed.tracks.map((track) => [track.id, track]));
      this.tombstones = new Map(
        parsed.tombstones.filter(
          (entry): entry is [string, number] =>
            Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number",
        ),
      );
      this.currentEpoch = parsed.epoch;
      this.currentRevision = parsed.revision;
      this.minRevision = parsed.minRevision;
      return true;
    } catch {
      // A missing or corrupt index starts a new epoch so phones run one full sync.
      return false;
    }
  }

  async flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.persistWrite = this.persistWrite.then(() => this.writeIndex());
    }
    await this.persistWrite;
  }

  scan(configuredRoots: string[]) {
    return this.enqueue(async () => {
      const roots: string[] = [];
      for (const configuredRoot of configuredRoots) {
        try {
          const root = await realpath(configuredRoot);
          if ((await stat(root)).isDirectory()) roots.push(root);
        } catch {
          // Ignore unavailable configured folders and keep scanning the others.
        }
      }
      this.roots = roots;

      const seen = new Set<string>();
      for (const root of roots) {
        await this.scanDirectory(root, root, seen);
      }
      for (const id of [...this.tracks.keys()]) {
        if (!seen.has(id)) this.removeTrack(id);
      }

      this.lastScanAt = new Date().toISOString();
      this.afterChange();
      return this.tracks.size;
    });
  }

  reindexPaths(paths: string[]) {
    return this.enqueue(async () => {
      for (const changedPath of new Set(paths.map((item) => path.resolve(item)))) {
        const root = this.roots.find((candidate) => isPathInsideRoot(candidate, changedPath));
        if (!root) continue;

        let fileStats: Stats | null = null;
        try {
          fileStats = await stat(changedPath);
        } catch {
          fileStats = null;
        }

        if (!fileStats) {
          this.removePathsUnder(changedPath);
        } else if (fileStats.isDirectory()) {
          const seen = new Set<string>();
          await this.scanDirectory(root, changedPath, seen);
          for (const track of [...this.tracks.values()]) {
            if (isPathInsideRoot(changedPath, track.filePath) && !seen.has(track.id)) {
              this.removeTrack(track.id);
            }
          }
        } else if (fileStats.isFile() && isSupportedAudioPath(changedPath)) {
          await this.indexFile(root, changedPath, fileStats);
        }
      }
      this.afterChange();
      return this.tracks.size;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.work.then(task, task);
    this.work = next.catch(() => undefined);
    return next;
  }

  private nextRevision() {
    this.currentRevision += 1;
    return this.currentRevision;
  }

  private removeTrack(id: string) {
    if (!this.tracks.delete(id)) return;
    this.tombstones.set(id, this.nextRevision());
  }

  private removePathsUnder(target: string) {
    for (const track of [...this.tracks.values()]) {
      if (track.filePath === target || isPathInsideRoot(target, track.filePath)) {
        this.removeTrack(track.id);
      }
    }
  }

  private afterChange() {
    if (this.tombstones.size > MAX_TOMBSTONES) {
      const ordered = [...this.tombstones].sort((left, right) => left[1] - right[1]);
      const dropped = ordered.slice(0, this.tombstones.size - MAX_TOMBSTONES);
      for (const [id, revision] of dropped) {
        this.tombstones.delete(id);
        this.minRevision = Math.max(this.minRevision, revision);
      }
    }
    this.schedulePersist();
    for (const listener of this.listeners) listener(this.currentRevision);
  }

  private schedulePersist() {
    if (!this.storagePath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistWrite = this.persistWrite.then(() => this.writeIndex());
    }, PERSIST_DELAY_MS);
  }

  private async writeIndex() {
    if (!this.storagePath) return;
    const snapshot: PersistedIndex = {
      epoch: this.currentEpoch,
      minRevision: this.minRevision,
      revision: this.currentRevision,
      serverId: this.serverId,
      tombstones: [...this.tombstones],
      tracks: [...this.tracks.values()],
      version: INDEX_FORMAT_VERSION,
    };
    try {
      await mkdir(path.dirname(this.storagePath), { recursive: true });
      const temporaryPath = `${this.storagePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.storagePath);
    } catch (error) {
      console.error("Could not save the library index.", error);
    }
  }

  private async scanDirectory(root: string, directory: string, seen: Set<string>): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const joined = path.join(directory, entry.name);
      let canonical: string;
      try {
        canonical = await realpath(joined);
      } catch {
        continue;
      }
      if (!isPathInsideRoot(root, canonical)) continue;
      if (entry.isDirectory()) {
        await this.scanDirectory(root, canonical, seen);
        continue;
      }
      if (!entry.isFile() || !isSupportedAudioPath(entry.name)) continue;

      try {
        const id = await this.indexFile(root, canonical, await stat(canonical));
        seen.add(id);
      } catch {
        // The file disappeared or is locked; the watcher or next scan picks it up.
      }
    }
  }

  private async indexFile(root: string, filePath: string, fileStats: Stats) {
    const canonical = await realpath(filePath).catch(() => filePath);
    const id = createTrackId(this.serverId, root, canonical);
    const existing = this.tracks.get(id);
    if (
      existing &&
      existing.filePath === canonical &&
      existing.mtimeMs === fileStats.mtimeMs &&
      existing.size === fileStats.size
    ) {
      return id;
    }

    const extension = path.extname(canonical);
    const fallbackName = path.basename(canonical, extension);
    let metadata: Awaited<ReturnType<typeof parseFile>> | null = null;
    try {
      metadata = await parseFile(canonical, { duration: false, skipCovers: false });
    } catch {
      // A readable audio stream is still useful when tags are malformed.
    }
    const next: IndexedTrack = {
      album: metadata?.common.album || undefined,
      albumArtist: metadata?.common.albumartist || undefined,
      artist: metadata?.common.artist || "Unknown Artist",
      extension: extension.slice(1).toUpperCase(),
      filePath: canonical,
      genre: metadata?.common.genre?.join(", ") || undefined,
      hasArtwork: Boolean(metadata?.common.picture?.length),
      id,
      mtimeMs: fileStats.mtimeMs,
      name: metadata?.common.title || fallbackName,
      revision: existing?.revision ?? 0,
      size: fileStats.size,
      track: metadata?.common.track.no || undefined,
      year: metadata?.common.year || undefined,
    };

    if (existing && sameMetadata(existing, next)) {
      this.tracks.set(id, { ...existing, mtimeMs: next.mtimeMs });
      return id;
    }
    next.revision = this.nextRevision();
    this.tracks.set(id, next);
    this.tombstones.delete(id);
    return id;
  }
}
