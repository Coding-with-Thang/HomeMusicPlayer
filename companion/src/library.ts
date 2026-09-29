import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { parseFile } from "music-metadata";

import type { IndexedTrack, PublicTrack } from "./types.js";

const supportedExtensions = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
]);

export function isPathInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function createTrackId(serverId: string, root: string, filePath: string) {
  const identity = `${serverId}\0${path.relative(root, filePath).replaceAll("\\", "/").toLowerCase()}`;
  return createHash("sha256").update(identity).digest("base64url");
}

function publicTrack(track: IndexedTrack): PublicTrack {
  const { artwork, filePath: _filePath, ...metadata } = track;
  return { ...metadata, hasArtwork: Boolean(artwork) };
}

export class MusicLibraryIndex {
  private tracks = new Map<string, IndexedTrack>();
  private lastScanAt: string | null = null;

  constructor(private readonly serverId: string) {}

  get count() {
    return this.tracks.size;
  }

  get scannedAt() {
    return this.lastScanAt;
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
      items: all.slice(offset, offset + limit).map(publicTrack),
      nextOffset: offset + limit < all.length ? offset + limit : null,
      total: all.length,
    };
  }

  async scan(configuredRoots: string[]) {
    const next = new Map<string, IndexedTrack>();
    const roots: string[] = [];
    for (const configuredRoot of configuredRoots) {
      try {
        const root = await realpath(configuredRoot);
        if ((await stat(root)).isDirectory()) roots.push(root);
      } catch {
        // Ignore unavailable configured folders and keep scanning the others.
      }
    }

    for (const root of roots) {
      await this.scanDirectory(root, root, next);
    }

    this.tracks = next;
    this.lastScanAt = new Date().toISOString();
    return this.tracks.size;
  }

  private async scanDirectory(
    root: string,
    directory: string,
    output: Map<string, IndexedTrack>,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
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
        await this.scanDirectory(root, canonical, output);
        continue;
      }
      if (!entry.isFile() || !supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const fileStats = await stat(canonical);
      const fallbackName = path.basename(entry.name, path.extname(entry.name));
      let metadata: Awaited<ReturnType<typeof parseFile>> | null = null;
      try {
        metadata = await parseFile(canonical, { duration: false });
      } catch {
        // A readable audio stream is still useful when tags are malformed.
      }
      const picture = metadata?.common.picture?.[0];
      const id = createTrackId(this.serverId, root, canonical);
      output.set(id, {
        album: metadata?.common.album || undefined,
        albumArtist: metadata?.common.albumartist || undefined,
        artist: metadata?.common.artist || "Unknown Artist",
        artwork: picture
          ? { data: picture.data, mimeType: picture.format }
          : undefined,
        extension: path.extname(entry.name).slice(1).toUpperCase(),
        filePath: canonical,
        genre: metadata?.common.genre?.join(", ") || undefined,
        id,
        name: metadata?.common.title || fallbackName,
        size: fileStats.size,
        track: metadata?.common.track.no || undefined,
        year: metadata?.common.year || undefined,
      });
    }
  }
}
