import { Directory, File, Paths } from 'expo-file-system';

import type { LocalTrack } from './useLocalAudioPlayer';

const CACHE_DIRECTORY = new Directory(Paths.cache, 'playback-cache');
const PARTIAL_SUFFIX = '.part';

function cacheFileName(track: LocalTrack) {
  const safeId = track.id.replace(/[^a-z0-9_-]/gi, '_');
  const extension = track.extension.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${safeId}.${extension || 'audio'}`;
}

export function getCachedTrackUri(track: LocalTrack) {
  try {
    const file = new File(CACHE_DIRECTORY, cacheFileName(track));
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export async function cacheRemoteTrack(
  track: LocalTrack,
  url: string,
  token: string,
  signal: AbortSignal
) {
  if (getCachedTrackUri(track)) {
    return;
  }

  CACHE_DIRECTORY.create({ idempotent: true, intermediates: true });
  const fileName = cacheFileName(track);
  const partial = new File(CACHE_DIRECTORY, `${fileName}${PARTIAL_SUFFIX}`);
  try {
    await File.downloadFileAsync(url, partial, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
      signal,
    });
    await partial.move(new File(CACHE_DIRECTORY, fileName));
  } catch (error) {
    try {
      if (partial.exists) partial.delete();
    } catch {
      // A leftover partial file is removed by the next prune.
    }
    throw error;
  }
}

export function pruneTrackCache(keepTracks: LocalTrack[]) {
  try {
    if (!CACHE_DIRECTORY.exists) {
      return;
    }
    const keepNames = new Set(keepTracks.map(cacheFileName));
    for (const entry of CACHE_DIRECTORY.list()) {
      if (!(entry instanceof File)) continue;
      const baseName = entry.name.endsWith(PARTIAL_SUFFIX)
        ? entry.name.slice(0, -PARTIAL_SUFFIX.length)
        : entry.name;
      if (!keepNames.has(baseName)) {
        entry.delete();
      }
    }
  } catch {
    // The OS can also reclaim the cache directory when storage is low.
  }
}
