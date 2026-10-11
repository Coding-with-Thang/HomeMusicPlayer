import { Directory, File, Paths } from 'expo-file-system';

import type { LocalTrack } from './useLocalAudioPlayer';

const ARTWORK_DIRECTORY = new Directory(Paths.cache, 'lockscreen-artwork');
const MAX_ARTWORK_FILES = 20;

function artworkFile(track: LocalTrack) {
  return new File(ARTWORK_DIRECTORY, `${track.id.replace(/[^a-z0-9_-]/gi, '_')}.img`);
}

function pruneArtwork() {
  const files = ARTWORK_DIRECTORY.list().filter(
    (entry): entry is File => entry instanceof File && !entry.name.endsWith('.part')
  );
  if (files.length <= MAX_ARTWORK_FILES) {
    return;
  }
  files
    .sort((left, right) => (left.modificationTime ?? 0) - (right.modificationTime ?? 0))
    .slice(0, files.length - MAX_ARTWORK_FILES)
    .forEach((file) => file.delete());
}

export async function getLockScreenArtworkUri(track: LocalTrack, token: string) {
  if (track.source !== 'remote' || !track.artwork) {
    return null;
  }
  const file = artworkFile(track);
  if (file.exists) {
    return file.uri;
  }

  ARTWORK_DIRECTORY.create({ idempotent: true, intermediates: true });
  const partial = new File(ARTWORK_DIRECTORY, `${file.name}.part`);
  try {
    await File.downloadFileAsync(track.artwork, partial, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
    });
    await partial.move(file);
  } catch {
    if (partial.exists) partial.delete();
    return null;
  }
  try {
    pruneArtwork();
  } catch {
    // The OS can also reclaim the cache directory when storage is low.
  }
  return artworkFile(track).uri;
}
