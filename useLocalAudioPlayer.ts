import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAudioMetadata } from '@missingcore/audio-metadata';
import { writeTags } from '@dantheman827/taglib-ts/simpleApi.js';
import {
  clearPreloadedSource,
  preload,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { getLockScreenArtworkUri } from './lockScreenArtwork';
import { addAudioRouteListener } from './modules/audio-route';
import {
  cacheRemoteTrack,
  getCachedTrackUri,
  pruneTrackCache,
} from './playbackCache';
import {
  disconnectRemoteServer,
  fetchRemoteDirectories,
  loadRemoteConnection,
  pairRemoteServer,
  remoteArtworkUrl,
  remoteStreamUrl,
  syncRemoteLibrary,
  testRemoteConnection,
  updateRemoteLibraryRoots,
  updateRemoteTrackMetadata,
  type RemoteConnection,
  type RemoteLibrarySync,
  type RemoteTrackDto,
} from './remoteServer';

const SUPPORTED_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'opus',
]);
const LIBRARY_STORAGE_KEY = 'home-audio-player.library.v2';
const PLAYLISTS_STORAGE_KEY = 'home-audio-player.playlists.v2';
const QUEUE_STORAGE_KEY = 'home-audio-player.queue.v2';
const LEGACY_LIBRARY_STORAGE_KEY = 'home-audio-player.library.v1';
const LEGACY_PLAYLISTS_STORAGE_KEY = 'home-audio-player.playlists.v1';
const LEGACY_QUEUE_STORAGE_KEY = 'home-audio-player.queue.v1';
const PERSISTENCE_DELAY_MS = 300;
const CACHE_AHEAD_TRACK_COUNT = 2;
const STREAM_STALL_FALLBACK_MS = 4000;
const FOREGROUND_SYNC_INTERVAL_MS = 30_000;
const AUTO_RESUME_WINDOW_MS = 10 * 60 * 1000;
const AUTO_RESUME_DELAY_MS = 750;
const NEAR_GAPLESS_HANDOFF_SECONDS = 0.15;
const PRELOAD_MAX_BYTES = 32 * 1024 * 1024;

export type LocalTrack = {
  album?: string;
  albumArtist?: string;
  artist: string;
  artwork?: string;
  genre?: string;
  name: string;
  extension: string;
  id: string;
  isAvailable?: boolean;
  remoteId?: string;
  source: 'local' | 'remote';
  uri: string;
  track?: number;
  year?: number;
};

export type EditableTrackMetadata = {
  album: string;
  artist: string;
  genre: string;
  name: string;
  track?: number;
  year?: number;
};

export type RepeatMode = 'off' | 'all' | 'one';

export type SavedPlaylist = {
  artwork?: string;
  id: string;
  name: string;
  trackIds: string[];
  trackRefs: LocalTrack[];
};

export type AudioFileInput = {
  name: string;
  uri: string;
};

export type LibraryScanResult = {
  addedCount: number;
  removedCount: number;
};

type StoredQueue = {
  currentIndex: number;
  isShuffleEnabled?: boolean;
  repeatMode?: RepeatMode;
  tracks: LocalTrack[];
};

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupportedAudioFile(fileName: string) {
  return SUPPORTED_EXTENSIONS.has(getExtension(fileName));
}

function isLocalTrack(value: unknown): value is LocalTrack {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const track = value as Partial<LocalTrack>;
  return (
    typeof track.artist === 'string' &&
    typeof track.name === 'string' &&
    typeof track.extension === 'string' &&
    typeof track.id === 'string' &&
    (track.source === 'local' || track.source === 'remote') &&
    typeof track.uri === 'string'
  );
}

function migrateTrack(value: unknown): LocalTrack | null {
  if (isLocalTrack(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const legacy = value as Partial<LocalTrack>;
  if (
    typeof legacy.artist !== 'string' ||
    typeof legacy.name !== 'string' ||
    typeof legacy.extension !== 'string' ||
    typeof legacy.uri !== 'string'
  ) {
    return null;
  }
  return {
    ...legacy,
    artist: legacy.artist,
    extension: legacy.extension,
    id: `local:${legacy.uri}`,
    isAvailable: true,
    name: legacy.name,
    source: 'local',
    uri: legacy.uri,
  };
}

function mapRemoteTrack(connection: RemoteConnection, item: RemoteTrackDto): LocalTrack {
  return {
    album: item.album,
    albumArtist: item.albumArtist,
    artist: item.artist,
    artwork: item.hasArtwork ? remoteArtworkUrl(connection, item.id) : undefined,
    extension: item.extension,
    genre: item.genre,
    id: `remote:${connection.serverId}:${item.id}`,
    isAvailable: true,
    name: item.name,
    remoteId: item.id,
    source: 'remote',
    track: item.track,
    uri: `remote://${connection.serverId}/${item.id}`,
    year: item.year,
  };
}

function sortLibrary(tracks: LocalTrack[]) {
  return tracks.sort((left, right) => left.name.localeCompare(right.name));
}

function resolvePlaylistTracks(
  playlist: Pick<SavedPlaylist, 'trackIds' | 'trackRefs'>,
  library: LocalTrack[]
) {
  const libraryById = new Map(library.map((item) => [item.id, item]));
  const refsById = new Map(playlist.trackRefs.map((item) => [item.id, item]));
  return playlist.trackIds
    .map((id) => libraryById.get(id) ?? refsById.get(id))
    .filter((item): item is LocalTrack => Boolean(item));
}

function backfillPlaylistTrackRefs(
  playlists: SavedPlaylist[],
  library: LocalTrack[]
) {
  const libraryById = new Map(library.map((item) => [item.id, item]));
  return playlists.map((playlist) => {
    const knownIds = new Set(playlist.trackRefs.map((item) => item.id));
    const missingRefs = playlist.trackIds
      .filter((id) => !knownIds.has(id))
      .map((id) => libraryById.get(id))
      .filter((item): item is LocalTrack => Boolean(item));
    return missingRefs.length > 0
      ? { ...playlist, trackRefs: [...playlist.trackRefs, ...missingRefs] }
      : playlist;
  });
}

async function createLocalTrack(file: AudioFileInput): Promise<LocalTrack> {
  const extension = getExtension(file.name);
  const fallbackName = file.name.replace(/\.[^/.]+$/, '');
  let album: string | undefined;
  let albumArtist: string | undefined;
  let artist = 'Unknown Artist';
  let artwork: string | undefined;
  let genre: string | undefined;
  let name = fallbackName;
  let track: number | undefined;
  let year: number | undefined;

  if (['mp3', 'm4a', 'flac'].includes(extension)) {
    try {
      const metadata = await getAudioMetadata(file.uri, [
        'album',
        'albumArtist',
        'artist',
        'artwork',
        'genre',
        'name',
        'track',
        'year',
      ]);
      album = metadata.metadata.album?.trim() || undefined;
      albumArtist = metadata.metadata.albumArtist?.trim() || undefined;
      artist = metadata.metadata.artist?.trim() || artist;
      artwork = metadata.metadata.artwork?.trim() || undefined;
      genre = metadata.metadata.genre?.trim() || undefined;
      name = metadata.metadata.name?.trim() || name;
      track = metadata.metadata.track;
      year = metadata.metadata.year;
    } catch {
      // Some files do not contain readable metadata; keep the fallback.
    }
  }

  return {
    album,
    albumArtist,
    artist,
    artwork,
    genre,
    name,
    extension: extension.toUpperCase(),
    id: `local:${file.uri}`,
    isAvailable: true,
    source: 'local',
    uri: file.uri,
    track,
    year,
  };
}

export type HeadsetOptions = {
  pauseOnHeadphoneDisconnect?: boolean;
  resumeOnHeadphoneReconnect?: boolean;
};

export function useLocalAudioPlayer({
  pauseOnHeadphoneDisconnect = true,
  resumeOnHeadphoneReconnect = false,
}: HeadsetOptions = {}) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<LocalTrack[]>([]);
  const [library, setLibrary] = useState<LocalTrack[]>([]);
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]);
  const libraryRef = useRef<LocalTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPicking, setIsPicking] = useState(false);
  const [remoteConnection, setRemoteConnection] =
    useState<RemoteConnection | null>(null);
  const [remoteToken, setRemoteToken] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error'
  >('disconnected');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isPlaybackRequested, setIsPlaybackRequested] = useState(false);
  const hasHandledFinish = useRef(false);
  const hasLoadedLibrary = useRef(false);
  const hasLoadedPlaylists = useRef(false);
  const hasLoadedQueue = useRef(false);
  const hasRestoredRemoteSource = useRef(false);
  const hasAutoSyncedRemote = useRef(false);
  const playbackErrorTrackIdRef = useRef<string | null>(null);
  const recoveredTrackIdRef = useRef<string | null>(null);
  const streamingTrackIdRef = useRef<string | null>(null);
  const cacheWindowRef = useRef<LocalTrack[]>([]);
  const cacheDownloadsRef = useRef(new Map<string, AbortController>());
  const failedCacheIdsRef = useRef(new Set<string>());
  const isCachingRef = useRef(false);
  const preloadedSourceRef = useRef<{ id: string; uri: string } | null>(null);
  const [cacheRevision, setCacheRevision] = useState(0);
  const playbackRequestedRef = useRef(false);
  const nativeWasPlayingRef = useRef(false);
  const unavailableTrackIdsRef = useRef(new Set<string>());
  const notificationPermissionRequest = useRef<Promise<unknown> | null>(null);
  const remoteConnectionRef = useRef<RemoteConnection | null>(null);
  const remoteTokenRef = useRef<string | null>(null);
  const track = queue[currentIndex] ?? null;
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistenceKeysRef = useRef(new Set<string>());
  const persistenceWriteRef = useRef<Promise<void>>(Promise.resolve());
  const persistenceStateRef = useRef({
    currentIndex,
    isShuffleEnabled,
    library,
    queue,
    repeatMode,
    savedPlaylists,
  });

  const autoPausedAtRef = useRef<number | null>(null);
  const headsetOptionsRef = useRef({
    pauseOnHeadphoneDisconnect,
    resumeOnHeadphoneReconnect,
  });
  const remoteCommandHandlersRef = useRef({
    next: () => undefined as void,
    previous: () => undefined as void,
    resume: () => undefined as void,
  });

  useEffect(() => {
    headsetOptionsRef.current = {
      pauseOnHeadphoneDisconnect,
      resumeOnHeadphoneReconnect,
    };
  }, [pauseOnHeadphoneDisconnect, resumeOnHeadphoneReconnect]);

  const setPlaybackIntent = useCallback((shouldPlay: boolean) => {
    playbackRequestedRef.current = shouldPlay;
    if (shouldPlay) {
      autoPausedAtRef.current = null;
    }
    setIsPlaybackRequested(shouldPlay);
  }, []);

  useEffect(() => {
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (nextStatus) => {
        if (nextStatus.playing) {
          nativeWasPlayingRef.current = true;
          setPlaybackIntent(true);
        } else if (
          nativeWasPlayingRef.current &&
          !nextStatus.isBuffering
        ) {
          nativeWasPlayingRef.current = false;
          setPlaybackIntent(false);
        }
      }
    );
    return () => subscription.remove();
  }, [player, setPlaybackIntent]);

  useEffect(() => {
    libraryRef.current = library;
    persistenceStateRef.current = {
      currentIndex,
      isShuffleEnabled,
      library,
      queue,
      repeatMode,
      savedPlaylists,
    };
  }, [
    currentIndex,
    isShuffleEnabled,
    library,
    queue,
    repeatMode,
    savedPlaylists,
  ]);

  const flushPersistence = useCallback(() => {
    if (persistenceTimerRef.current) {
      clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = null;
    }

    const keys = [...pendingPersistenceKeysRef.current];
    if (keys.length === 0) {
      return persistenceWriteRef.current;
    }
    pendingPersistenceKeysRef.current.clear();

    persistenceWriteRef.current = persistenceWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        const latest = persistenceStateRef.current;
        const entries: [string, string][] = keys.map((key) => {
          if (key === LIBRARY_STORAGE_KEY) {
            return [key, JSON.stringify(latest.library)];
          }
          if (key === PLAYLISTS_STORAGE_KEY) {
            return [key, JSON.stringify(latest.savedPlaylists)];
          }
          const storedQueue: StoredQueue = {
            currentIndex: latest.currentIndex,
            isShuffleEnabled: latest.isShuffleEnabled,
            repeatMode: latest.repeatMode,
            tracks: latest.queue,
          };
          return [key, JSON.stringify(storedQueue)];
        });

        try {
          await AsyncStorage.multiSet(entries);
        } catch {
          keys.forEach((key) => pendingPersistenceKeysRef.current.add(key));
          // Keep the latest snapshots pending so a later change or app
          // background transition can retry the write.
        }
      });

    return persistenceWriteRef.current;
  }, []);

  const schedulePersistence = useCallback(
    (key: string) => {
      pendingPersistenceKeysRef.current.add(key);
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
      }
      persistenceTimerRef.current = setTimeout(() => {
        void flushPersistence();
      }, PERSISTENCE_DELAY_MS);
    },
    [flushPersistence]
  );

  const persistImmediately = useCallback(
    (key: string) => {
      pendingPersistenceKeysRef.current.add(key);
      void flushPersistence();
    },
    [flushPersistence]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        void flushPersistence();
      }
    });

    return () => {
      subscription.remove();
      void flushPersistence();
    };
  }, [flushPersistence]);

  useEffect(() => {
    loadRemoteConnection()
      .then(({ connection, token }) => {
        remoteConnectionRef.current = connection;
        remoteTokenRef.current = token;
        setRemoteConnection(connection);
        setRemoteToken(token);
        setRemoteError(null);
        setRemoteStatus(connection && token ? 'connected' : 'disconnected');
      })
      .catch(() => {
        setRemoteStatus('error');
        setRemoteError('Saved PC connection details could not be loaded.');
      });
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      // Playback still works with the platform's default audio session.
    });
  }, []);

  useEffect(() => {
    if (!track) {
      try {
        player.clearLockScreenControls();
      } catch {
        // The hook may release its native player during a fast refresh.
      }
      return;
    }

    let isCurrentTrack = true;
    const remoteToken = remoteTokenRef.current;
    const lockScreenMetadata = {
      title: track.name,
      artist: track.artist,
      ...(track.album ? { albumTitle: track.album } : {}),
    };

    const activateMediaControls = async () => {
      if (Platform.OS === 'android') {
        notificationPermissionRequest.current ??=
          requestNotificationPermissionsAsync().catch(() => undefined);
        await notificationPermissionRequest.current;
      }

      if (!isCurrentTrack) {
        return;
      }

      player.setActiveForLockScreen(
        true,
        {
          ...lockScreenMetadata,
          ...(track.artwork && track.source === 'local'
            ? { artworkUrl: track.artwork }
            : {}),
        },
        {
          showSeekBackward: false,
          showSeekForward: false,
        }
      );

      if (track.source === 'remote' && remoteToken) {
        const artworkUrl = await getLockScreenArtworkUri(track, remoteToken);
        if (artworkUrl && isCurrentTrack) {
          player.updateLockScreenMetadata({ ...lockScreenMetadata, artworkUrl });
        }
      }
    };

    activateMediaControls().catch(() => {
      // Playback remains available if system media controls cannot be enabled.
    });

    return () => {
      isCurrentTrack = false;
    };
  }, [player, track]);

  useEffect(() => {
    let isActive = true;

    AsyncStorage.multiGet([LIBRARY_STORAGE_KEY, LEGACY_LIBRARY_STORAGE_KEY])
      .then((storedValues) => {
        const values = new Map(storedValues);
        const storedLibrary =
          values.get(LIBRARY_STORAGE_KEY) ??
          values.get(LEGACY_LIBRARY_STORAGE_KEY);
        if (!isActive || !storedLibrary) {
          return;
        }

        const parsed = JSON.parse(storedLibrary) as LocalTrack[];
        if (Array.isArray(parsed)) {
          const restoredLibrary = parsed
            .map(migrateTrack)
            .filter((item): item is LocalTrack => Boolean(item));
          libraryRef.current = restoredLibrary;
          setLibrary(restoredLibrary);
          setSavedPlaylists((current) =>
            backfillPlaylistTrackRefs(current, restoredLibrary)
          );
        }
      })
      .catch(() => {
        // Start with an empty library if stored data cannot be read.
      })
      .finally(() => {
        hasLoadedLibrary.current = true;
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (hasLoadedLibrary.current) {
      schedulePersistence(LIBRARY_STORAGE_KEY);
    }
  }, [library, schedulePersistence]);

  useEffect(() => {
    let isActive = true;

    AsyncStorage.multiGet([PLAYLISTS_STORAGE_KEY, LEGACY_PLAYLISTS_STORAGE_KEY])
      .then((storedValues) => {
        const values = new Map(storedValues);
        const storedPlaylists =
          values.get(PLAYLISTS_STORAGE_KEY) ??
          values.get(LEGACY_PLAYLISTS_STORAGE_KEY);
        if (!isActive || !storedPlaylists) {
          return;
        }

        const parsed = JSON.parse(storedPlaylists) as (Partial<SavedPlaylist> & {
          trackUris?: string[];
        })[];
        if (Array.isArray(parsed)) {
          const restoredPlaylists = parsed
            .filter(
              (item) =>
                typeof item?.id === 'string' &&
                typeof item?.name === 'string' &&
                (Array.isArray(item?.trackIds) ||
                  Array.isArray(item?.trackUris))
            )
            .map((item) => ({
              artwork:
                typeof item.artwork === 'string' ? item.artwork : undefined,
              id: item.id!,
              name: item.name!,
              trackIds: Array.isArray(item.trackIds)
                ? item.trackIds
                : (item.trackUris ?? []).map((uri) => `local:${uri}`),
              trackRefs: Array.isArray(item.trackRefs)
                ? item.trackRefs
                    .map(migrateTrack)
                    .filter(
                      (track): track is LocalTrack => Boolean(track)
                    )
                : [],
            }));
          setSavedPlaylists(
            backfillPlaylistTrackRefs(
              restoredPlaylists,
              libraryRef.current
            )
          );
        }
      })
      .catch(() => {
        // Start with no saved playlists if stored data cannot be read.
      })
      .finally(() => {
        hasLoadedPlaylists.current = true;
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (hasLoadedPlaylists.current) {
      persistImmediately(PLAYLISTS_STORAGE_KEY);
    }
  }, [persistImmediately, savedPlaylists]);

  const isTrackSourceAvailable = useCallback((candidate: LocalTrack) => {
    if (candidate.isAvailable === false) {
      return false;
    }
    if (candidate.source === 'local') {
      try {
        return new File(candidate.uri).exists;
      } catch {
        return false;
      }
    }

    if (getCachedTrackUri(candidate)) {
      return true;
    }
    const connection = remoteConnectionRef.current;
    return Boolean(
      connection &&
        remoteTokenRef.current &&
        candidate.remoteId &&
        candidate.id.startsWith(`remote:${connection.serverId}:`)
    );
  }, []);

  const loadTrack = useCallback(
    (nextTrack: LocalTrack, index: number, shouldPlay: boolean) => {
      setPlaybackIntent(false);
      nativeWasPlayingRef.current = false;
      if (recoveredTrackIdRef.current !== nextTrack.id) {
        recoveredTrackIdRef.current = null;
      }
      player.pause();
      if (!isTrackSourceAvailable(nextTrack)) {
        player.replace(null);
        setCurrentIndex(index);
        return false;
      }

      const cachedUri =
        nextTrack.source === 'remote' ? getCachedTrackUri(nextTrack) : null;
      streamingTrackIdRef.current =
        nextTrack.source === 'remote' && !cachedUri ? nextTrack.id : null;
      if (cachedUri) {
        player.replace({ uri: cachedUri, name: nextTrack.name });
      } else if (nextTrack.source === 'remote') {
        const activeConnection = remoteConnectionRef.current;
        const activeToken = remoteTokenRef.current;
        if (!activeConnection || !activeToken || !nextTrack.remoteId) return false;
        player.replace({
          headers: { Authorization: `Bearer ${activeToken}` },
          name: nextTrack.name,
          uri: remoteStreamUrl(activeConnection, nextTrack.remoteId),
        });
      } else {
        player.replace({ uri: nextTrack.uri, name: nextTrack.name });
      }
      setCurrentIndex(index);
      if (shouldPlay) {
        setPlaybackIntent(true);
        player.play();
      }
      return true;
    },
    [isTrackSourceAvailable, player, setPlaybackIntent]
  );

  const loadFirstAvailableTrack = useCallback(
    (
      tracks: LocalTrack[],
      startIndex: number,
      shouldPlay: boolean,
      allowWrap: boolean,
      skippedIds: Set<string> = new Set()
    ) => {
      for (let offset = 0; offset < tracks.length; offset += 1) {
        const candidateIndex = startIndex + offset;
        if (!allowWrap && candidateIndex >= tracks.length) {
          break;
        }
        const index = candidateIndex % tracks.length;
        const candidate = tracks[index];
        if (
          candidate &&
          !skippedIds.has(candidate.id) &&
          loadTrack(candidate, index, shouldPlay)
        ) {
          return true;
        }
      }
      return false;
    },
    [loadTrack]
  );

  const peekNextPlayableTrack = useCallback(
    (fromCompletion: boolean) => {
      if (!track) {
        return null;
      }
      if (fromCompletion && repeatMode === 'one') {
        return { candidate: track, index: currentIndex };
      }
      const skippedIds = fromCompletion
        ? new Set<string>()
        : unavailableTrackIdsRef.current;
      if (isShuffleEnabled && queue.length > 1) {
        const candidates = queue
          .map((candidate, index) => ({ candidate, index }))
          .filter(
            ({ candidate, index }) =>
              index !== currentIndex &&
              !skippedIds.has(candidate.id) &&
              isTrackSourceAvailable(candidate)
          );
        return candidates[0] ?? null;
      }
      for (let offset = 1; offset <= queue.length; offset += 1) {
        const candidateIndex = currentIndex + offset;
        if (repeatMode !== 'all' && candidateIndex >= queue.length) {
          break;
        }
        const index = candidateIndex % queue.length;
        const candidate = queue[index];
        if (
          candidate &&
          !skippedIds.has(candidate.id) &&
          isTrackSourceAvailable(candidate)
        ) {
          return { candidate, index };
        }
      }
      return null;
    },
    [currentIndex, isShuffleEnabled, isTrackSourceAvailable, queue, repeatMode, track]
  );

  const getPlayableSource = useCallback((candidate: LocalTrack) => {
    if (candidate.source === 'local') {
      return { uri: candidate.uri, name: candidate.name };
    }
    const cachedUri = getCachedTrackUri(candidate);
    if (cachedUri) {
      return { uri: cachedUri, name: candidate.name };
    }
    const activeConnection = remoteConnectionRef.current;
    const activeToken = remoteTokenRef.current;
    if (!activeConnection || !activeToken || !candidate.remoteId) {
      return null;
    }
    return {
      headers: { Authorization: `Bearer ${activeToken}` },
      name: candidate.name,
      uri: remoteStreamUrl(activeConnection, candidate.remoteId),
    };
  }, []);

  const releasePreloadedSource = useCallback(() => {
    const previous = preloadedSourceRef.current;
    preloadedSourceRef.current = null;
    if (previous) {
      void clearPreloadedSource({ uri: previous.uri }).catch(() => undefined);
    }
  }, []);

  const runCacheDownloads = useCallback(async () => {
    if (isCachingRef.current) {
      return;
    }
    isCachingRef.current = true;
    try {
      while (true) {
        const connection = remoteConnectionRef.current;
        const token = remoteTokenRef.current;
        const nextTrack = cacheWindowRef.current.find(
          (candidate) =>
            !failedCacheIdsRef.current.has(candidate.id) &&
            !getCachedTrackUri(candidate)
        );
        if (!connection || !token || !nextTrack?.remoteId) {
          return;
        }

        const controller = new AbortController();
        cacheDownloadsRef.current.set(nextTrack.id, controller);
        try {
          await cacheRemoteTrack(
            nextTrack,
            remoteStreamUrl(connection, nextTrack.remoteId),
            token,
            controller.signal
          );
        } catch {
          if (!controller.signal.aborted) {
            failedCacheIdsRef.current.add(nextTrack.id);
          }
        } finally {
          cacheDownloadsRef.current.delete(nextTrack.id);
          if (getCachedTrackUri(nextTrack)) {
            setCacheRevision((current) => current + 1);
          }
        }
      }
    } finally {
      isCachingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const cacheWindow: LocalTrack[] = [];
    if (remoteConnection && remoteToken && currentIndex >= 0) {
      for (let offset = 0; offset <= CACHE_AHEAD_TRACK_COUNT; offset += 1) {
        const index = currentIndex + offset;
        if (offset >= queue.length || (index >= queue.length && repeatMode !== 'all')) {
          break;
        }
        const candidate = queue[index % queue.length];
        if (
          candidate?.source === 'remote' &&
          candidate.remoteId &&
          candidate.isAvailable !== false
        ) {
          cacheWindow.push(candidate);
        }
      }
    }

    const windowIds = new Set(cacheWindow.map((candidate) => candidate.id));
    for (const [trackId, controller] of cacheDownloadsRef.current) {
      if (!windowIds.has(trackId)) controller.abort();
    }
    cacheWindowRef.current = cacheWindow;
    failedCacheIdsRef.current.clear();
    pruneTrackCache(cacheWindow);
    void runCacheDownloads();
  }, [currentIndex, queue, remoteConnection, remoteToken, repeatMode, runCacheDownloads]);

  useEffect(() => {
    const downloads = cacheDownloadsRef.current;
    return () => {
      cacheWindowRef.current = [];
      for (const controller of downloads.values()) controller.abort();
    };
  }, []);

  useEffect(() => {
    if (
      !hasRestoredRemoteSource.current &&
      remoteToken &&
      remoteConnection &&
      track?.source === 'remote'
    ) {
      hasRestoredRemoteSource.current = true;
      loadTrack(track, currentIndex, false);
    }
  }, [currentIndex, loadTrack, remoteConnection, remoteToken, track]);

  useEffect(() => {
    let isActive = true;

    AsyncStorage.multiGet([QUEUE_STORAGE_KEY, LEGACY_QUEUE_STORAGE_KEY])
      .then((storedValues) => {
        const values = new Map(storedValues);
        const storedQueue =
          values.get(QUEUE_STORAGE_KEY) ?? values.get(LEGACY_QUEUE_STORAGE_KEY);
        if (!isActive || !storedQueue) {
          return;
        }

        const parsed = JSON.parse(storedQueue) as Partial<StoredQueue>;
        if (!Array.isArray(parsed.tracks)) {
          return;
        }

        const restoredQueue = parsed.tracks
          .map(migrateTrack)
          .filter((item): item is LocalTrack => Boolean(item));
        if (restoredQueue.length === 0) {
          return;
        }

        const restoredIndex =
          typeof parsed.currentIndex === 'number' &&
          Number.isInteger(parsed.currentIndex)
            ? Math.min(Math.max(parsed.currentIndex, 0), restoredQueue.length - 1)
            : 0;

        setIsShuffleEnabled(parsed.isShuffleEnabled === true);
        if (
          parsed.repeatMode === 'off' ||
          parsed.repeatMode === 'all' ||
          parsed.repeatMode === 'one'
        ) {
          setRepeatMode(parsed.repeatMode);
        }
        setQueue(restoredQueue);
        loadTrack(restoredQueue[restoredIndex], restoredIndex, false);
      })
      .catch(() => {
        // Start with an empty queue if stored data cannot be read.
      })
      .finally(() => {
        hasLoadedQueue.current = true;
      });

    return () => {
      isActive = false;
    };
  }, [loadTrack]);

  useEffect(() => {
    if (hasLoadedQueue.current) {
      persistImmediately(QUEUE_STORAGE_KEY);
    }
  }, [
    currentIndex,
    isShuffleEnabled,
    persistImmediately,
    queue,
    repeatMode,
  ]);

  const addTracksToQueue = useCallback(
    (tracks: LocalTrack[]) => {
      const queuedIds = new Set(queue.map((queuedTrack) => queuedTrack.id));
      const candidateIds = new Set<string>();
      const uniqueTracks: LocalTrack[] = [];
      for (const candidate of tracks) {
        if (!queuedIds.has(candidate.id) && !candidateIds.has(candidate.id)) {
          candidateIds.add(candidate.id);
          uniqueTracks.push(candidate);
        }
      }

      if (uniqueTracks.length === 0) {
        return 0;
      }

      const firstAddedIndex = queue.length;
      setQueue((currentQueue) => [...currentQueue, ...uniqueTracks]);

      if (!track) {
        loadTrack(uniqueTracks[0], firstAddedIndex, false);
      }

      return uniqueTracks.length;
    },
    [loadTrack, queue, track]
  );

  const addFilesToQueue = useCallback(
    async (files: AudioFileInput[]) => {
      const uniqueFiles = files.filter(
        (file, index, allFiles) =>
          isSupportedAudioFile(file.name) &&
          allFiles.findIndex((candidate) => candidate.uri === file.uri) === index
      );
      const addedTracks = await Promise.all(uniqueFiles.map(createLocalTrack));
      return addTracksToQueue(addedTracks);
    },
    [addTracksToQueue]
  );

  const addFilesToLibrary = useCallback(
    async (
      files: AudioFileInput[],
      scannedRootUris: string[] = []
    ): Promise<LibraryScanResult> => {
      const libraryIds = new Set(library.map((item) => item.id));
      const uniqueFiles = files.filter(
        (file, index, allFiles) =>
          isSupportedAudioFile(file.name) &&
          allFiles.findIndex((candidate) => candidate.uri === file.uri) === index
      );
      const scannedTracks = await Promise.all(uniqueFiles.map(createLocalTrack));
      const addedCount = scannedTracks.filter(
        (track) => !libraryIds.has(track.id)
      ).length;
      const scannedById = new Map(
        scannedTracks.map((track) => [track.id, track])
      );
      const normalizedRoots = scannedRootUris.map((uri) =>
        uri.endsWith('/') ? uri : `${uri}/`
      );
      const isInScannedRoot = (track: LocalTrack) =>
        track.source === 'local' &&
        normalizedRoots.some(
          (root) => track.uri === root.slice(0, -1) || track.uri.startsWith(root)
        );
      const missingIds = new Set(
        library
          .filter(
            (track) => isInScannedRoot(track) && !scannedById.has(track.id)
          )
          .map((track) => track.id)
      );

      setLibrary((current) => {
        const merged = new Map(
          current
            .filter((track) => !missingIds.has(track.id))
            .map((track) => [track.id, track])
        );
        scannedTracks.forEach((track) => merged.set(track.id, track));
        return [...merged.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      });
      setQueue((current) =>
        current.map(
          (track) =>
            scannedById.get(track.id) ??
            (missingIds.has(track.id)
              ? { ...track, isAvailable: false }
              : track)
        )
      );
      setSavedPlaylists((current) =>
        current.map((playlist) => ({
          ...playlist,
          trackRefs: playlist.trackRefs.map(
            (track) =>
              scannedById.get(track.id) ??
              (missingIds.has(track.id)
                ? { ...track, isAvailable: false }
                : track)
          ),
        }))
      );

      return { addedCount, removedCount: missingIds.size };
    },
    [library]
  );

  const addLibraryTrackToQueue = useCallback(
    (libraryTrack: LocalTrack) => addTracksToQueue([libraryTrack]),
    [addTracksToQueue]
  );

  const addLibraryToQueue = useCallback(
    (tracks: LocalTrack[] = library) => addTracksToQueue(tracks),
    [addTracksToQueue, library]
  );

  const removeLibraryTrack = useCallback((id: string) => {
    setLibrary((current) => current.filter((item) => item.id !== id));
  }, []);

  const updateTrackMetadata = useCallback(
    async (uri: string, metadata: EditableTrackMetadata) => {
      const existingTrack = library.find((item) => item.uri === uri);
      if (!existingTrack) {
        throw new Error('This song is no longer in the library.');
      }
      if (existingTrack.source === 'remote') {
        const connection = remoteConnectionRef.current;
        const token = remoteTokenRef.current;
        if (!connection || !token || !existingTrack.remoteId) {
          throw new Error('Connect to the PC before editing this track.');
        }
        const isCurrentTrack = track?.id === existingTrack.id;
        const wasPlaying = isCurrentTrack && status.playing;
        const resumeTime = isCurrentTrack ? status.currentTime : 0;
        if (isCurrentTrack) {
          player.pause();
          player.replace(null);
        }
        try {
          const response = await updateRemoteTrackMetadata(
            connection,
            token,
            existingTrack.remoteId,
            metadata
          );
          const updatedTrack: LocalTrack = {
            ...existingTrack,
            album: response.track.album,
            albumArtist: response.track.albumArtist,
            artist: response.track.artist,
            genre: response.track.genre,
            name: response.track.name,
            track: response.track.track,
            year: response.track.year,
          };
          setLibrary((current) =>
            current
              .map((item) => (item.id === updatedTrack.id ? updatedTrack : item))
              .sort((left, right) => left.name.localeCompare(right.name))
          );
          setQueue((current) =>
            current.map((item) =>
              item.id === updatedTrack.id ? updatedTrack : item
            )
          );
          setSavedPlaylists((current) =>
            current.map((playlist) => ({
              ...playlist,
              trackRefs: playlist.trackRefs.map((item) =>
                item.id === updatedTrack.id ? updatedTrack : item
              ),
            }))
          );
          if (isCurrentTrack) {
            loadTrack(updatedTrack, currentIndex, false);
            await player.seekTo(resumeTime);
            if (wasPlaying) player.play();
          }
          return updatedTrack;
        } catch (error) {
          if (isCurrentTrack) {
            loadTrack(existingTrack, currentIndex, false);
            await player.seekTo(resumeTime).catch(() => undefined);
            if (wasPlaying) player.play();
          }
          throw error;
        }
      }

      const sourceFile = new File(uri);
      const originalBytes = await sourceFile.bytes();
      const modifiedBytes = await writeTags(
        {
          data: originalBytes,
          filename: sourceFile.name,
        },
        {
          album: metadata.album,
          artist: metadata.artist,
          genre: metadata.genre,
          title: metadata.name,
          track: metadata.track ?? 0,
          year: metadata.year ?? 0,
        }
      );

      if (!modifiedBytes) {
        throw new Error(
          `${existingTrack.extension} metadata could not be updated.`
        );
      }

      const isCurrentTrack = track?.uri === uri;
      const wasPlaying = isCurrentTrack && status.playing;
      const resumeTime = isCurrentTrack ? status.currentTime : 0;

      if (isCurrentTrack) {
        player.pause();
      }

      try {
        sourceFile.write(modifiedBytes);
      } catch (error) {
        try {
          sourceFile.write(originalBytes);
        } catch {
          throw new Error(
            'The file could not be restored after the metadata write failed.'
          );
        } finally {
          if (wasPlaying) {
            player.play();
          }
        }
        throw error;
      }

      const fallbackName = sourceFile.name.replace(/\.[^/.]+$/, '');
      const updatedTrack: LocalTrack = {
        ...existingTrack,
        album: metadata.album.trim() || undefined,
        artist: metadata.artist.trim() || 'Unknown Artist',
        genre: metadata.genre.trim() || undefined,
        name: metadata.name.trim() || fallbackName,
        track: metadata.track,
        year: metadata.year,
      };

      setLibrary((current) =>
        current
          .map((item) => (item.uri === uri ? updatedTrack : item))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setQueue((current) =>
        current.map((item) => (item.uri === uri ? updatedTrack : item))
      );
      setSavedPlaylists((current) =>
        current.map((playlist) => ({
          ...playlist,
          trackRefs: playlist.trackRefs.map((item) =>
            item.id === updatedTrack.id ? updatedTrack : item
          ),
        }))
      );

      if (isCurrentTrack) {
        player.replace({ uri, name: updatedTrack.name });
        await player.seekTo(resumeTime);
        if (wasPlaying) {
          player.play();
        }
      }

      return updatedTrack;
    },
    [
      currentIndex,
      library,
      loadTrack,
      player,
      status.currentTime,
      status.playing,
      track,
    ]
  );

  const createSavedPlaylist = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (
        !trimmedName ||
        savedPlaylists.some(
          (playlist) =>
            playlist.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
        )
      ) {
        return null;
      }

      const playlist: SavedPlaylist = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        trackIds: [],
        trackRefs: [],
      };
      setSavedPlaylists((current) => [...current, playlist]);
      return playlist.id;
    },
    [savedPlaylists]
  );

  const renameSavedPlaylist = useCallback(
    (playlistId: string, name: string) => {
      const trimmedName = name.trim();
      if (
        !trimmedName ||
        savedPlaylists.some(
          (playlist) =>
            playlist.id !== playlistId &&
            playlist.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
        )
      ) {
        return false;
      }

      setSavedPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId
            ? { ...playlist, name: trimmedName }
            : playlist
        )
      );
      return true;
    },
    [savedPlaylists]
  );

  const updateSavedPlaylistArtwork = useCallback(
    (playlistId: string, artwork?: string) => {
      setSavedPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId ? { ...playlist, artwork } : playlist
        )
      );
    },
    []
  );

  const deleteSavedPlaylist = useCallback((playlistId: string) => {
    setSavedPlaylists((current) =>
      current.filter((playlist) => playlist.id !== playlistId)
    );
  }, []);

  const addTrackToSavedPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      const trackRef = library.find((item) => item.id === trackId);
      if (!trackRef) {
        return;
      }
      setSavedPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId &&
          !playlist.trackIds.includes(trackId)
            ? {
                ...playlist,
                trackIds: [...playlist.trackIds, trackId],
                trackRefs: [...playlist.trackRefs, trackRef],
              }
            : playlist
        )
      );
    },
    [library]
  );

  const addTracksToSavedPlaylist = useCallback(
    (playlistId: string, trackIds: string[]) => {
      if (trackIds.length === 0) {
        return;
      }

      setSavedPlaylists((current) =>
        current.map((playlist) => {
          if (playlist.id !== playlistId) {
            return playlist;
          }

          const existingIds = new Set(playlist.trackIds);
          const additions: string[] = [];
          const addedRefs: LocalTrack[] = [];
          for (const trackId of trackIds) {
            const trackRef = library.find((item) => item.id === trackId);
            if (!existingIds.has(trackId) && trackRef) {
              existingIds.add(trackId);
              additions.push(trackId);
              addedRefs.push(trackRef);
            }
          }

          return additions.length > 0
            ? {
                ...playlist,
                trackIds: [...playlist.trackIds, ...additions],
                trackRefs: [...playlist.trackRefs, ...addedRefs],
              }
            : playlist;
        })
      );
    },
    [library]
  );

  const removeTrackFromSavedPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setSavedPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId
            ? {
                ...playlist,
                trackIds: playlist.trackIds.filter(
                  (candidate) => candidate !== trackId
                ),
                trackRefs: playlist.trackRefs.filter(
                  (candidate) => candidate.id !== trackId
                ),
              }
            : playlist
        )
      );
    },
    []
  );

  const moveTrackInSavedPlaylist = useCallback(
    (playlistId: string, trackId: string, direction: -1 | 1) => {
      setSavedPlaylists((current) =>
        current.map((playlist) => {
          if (playlist.id !== playlistId) {
            return playlist;
          }
          const fromIndex = playlist.trackIds.indexOf(trackId);
          const toIndex = fromIndex + direction;
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            toIndex >= playlist.trackIds.length
          ) {
            return playlist;
          }
          const trackIds = [...playlist.trackIds];
          [trackIds[fromIndex], trackIds[toIndex]] = [
            trackIds[toIndex],
            trackIds[fromIndex],
          ];
          return { ...playlist, trackIds };
        })
      );
    },
    []
  );

  const addSavedPlaylistToQueue = useCallback(
    (playlistId: string) => {
      const playlist = savedPlaylists.find((item) => item.id === playlistId);
      if (!playlist) {
        return 0;
      }
      const tracks = resolvePlaylistTracks(playlist, library);
      return addTracksToQueue(tracks);
    },
    [addTracksToQueue, library, savedPlaylists]
  );

  const playSavedPlaylist = useCallback(
    (playlistId: string, shuffle = false) => {
      const playlist = savedPlaylists.find((item) => item.id === playlistId);
      if (!playlist) {
        return 0;
      }

      const tracks = resolvePlaylistTracks(playlist, library);
      if (shuffle) {
        for (let index = tracks.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [tracks[index], tracks[swapIndex]] = [tracks[swapIndex], tracks[index]];
        }
      }
      if (tracks.length === 0) {
        return 0;
      }

      setQueue(tracks);
      unavailableTrackIdsRef.current.clear();
      loadFirstAvailableTrack(tracks, 0, true, false);
      return tracks.length;
    },
    [library, loadFirstAvailableTrack, savedPlaylists]
  );

  const pickTracks = useCallback(async () => {
    try {
      setIsPicking(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled) {
        return;
      }

      const supportedAssets = result.assets.filter((asset) =>
        isSupportedAudioFile(asset.name)
      );

      if (supportedAssets.length === 0) {
        Alert.alert(
          'No supported audio',
          'Choose an MP3, M4A, AAC, WAV, FLAC, OGG, or Opus audio file.'
        );
        return;
      }

      await addFilesToQueue(supportedAssets);

      const skippedCount = result.assets.length - supportedAssets.length;
      if (skippedCount > 0) {
        Alert.alert(
          'Some files were skipped',
          `${skippedCount} unsupported ${skippedCount === 1 ? 'file was' : 'files were'} not added.`
        );
      }
    } catch {
      Alert.alert('Could not open files', 'Please try choosing the audio files again.');
    } finally {
      setIsPicking(false);
    }
  }, [addFilesToQueue]);

  const updateRemoteRefs = useCallback(
    (resolve: (item: LocalTrack) => LocalTrack) => {
      const update = (item: LocalTrack) =>
        item.source === 'remote' ? resolve(item) : item;
      setQueue((current) => current.map(update));
      setSavedPlaylists((current) =>
        current.map((playlist) => ({
          ...playlist,
          trackRefs: playlist.trackRefs.map(update),
        }))
      );
    },
    []
  );

  const mergeRemoteTracks = useCallback(
    (connection: RemoteConnection, remoteTracks: RemoteTrackDto[]) => {
      const mapped = remoteTracks.map((item) => mapRemoteTrack(connection, item));
      const byId = new Map(mapped.map((item) => [item.id, item]));
      const nextLibrary = sortLibrary([
        ...libraryRef.current.filter((item) => item.source === 'local'),
        ...mapped,
      ]);
      libraryRef.current = nextLibrary;
      setLibrary(nextLibrary);
      updateRemoteRefs(
        (item) => byId.get(item.id) ?? { ...item, isAvailable: false }
      );
      return mapped.length;
    },
    [updateRemoteRefs]
  );

  const applyRemoteDelta = useCallback(
    (connection: RemoteConnection, upserts: RemoteTrackDto[], deletes: string[]) => {
      const mapped = upserts.map((item) => mapRemoteTrack(connection, item));
      const upsertById = new Map(mapped.map((item) => [item.id, item]));
      const deletedIds = new Set(
        deletes.map((id) => `remote:${connection.serverId}:${id}`)
      );
      const nextLibrary =
        mapped.length === 0 && deletedIds.size === 0
          ? libraryRef.current
          : sortLibrary([
              ...libraryRef.current.filter(
                (item) => !deletedIds.has(item.id) && !upsertById.has(item.id)
              ),
              ...mapped,
            ]);
      if (nextLibrary !== libraryRef.current) {
        libraryRef.current = nextLibrary;
        setLibrary(nextLibrary);
        updateRemoteRefs(
          (item) =>
            upsertById.get(item.id) ??
            (deletedIds.has(item.id) ? { ...item, isAvailable: false } : item)
        );
      }
      return nextLibrary.filter((item) => item.source === 'remote').length;
    },
    [updateRemoteRefs]
  );

  const applyRemoteSync = useCallback(
    (synced: RemoteLibrarySync) => {
      remoteConnectionRef.current = synced.connection;
      setRemoteConnection(synced.connection);
      return synced.mode === 'full'
        ? mergeRemoteTracks(synced.connection, synced.tracks)
        : applyRemoteDelta(synced.connection, synced.upserts, synced.deletes);
    },
    [applyRemoteDelta, mergeRemoteTracks]
  );

  const runRemoteSync = useCallback(
    (connection: RemoteConnection, token: string) => {
      const hasRemoteTracks = libraryRef.current.some(
        (item) =>
          item.source === 'remote' &&
          item.id.startsWith(`remote:${connection.serverId}:`)
      );
      return syncRemoteLibrary(connection, token, { forceFull: !hasRemoteTracks });
    },
    []
  );

  const connectRemote = useCallback(
    async (baseUrl: string, code: string) => {
      setRemoteStatus('connecting');
      setRemoteError(null);
      try {
        const paired = await pairRemoteServer(baseUrl, code);
        hasAutoSyncedRemote.current = true;
        remoteConnectionRef.current = paired.connection;
        remoteTokenRef.current = paired.token;
        setRemoteConnection(paired.connection);
        setRemoteToken(paired.token);
        const synced = await syncRemoteLibrary(paired.connection, paired.token, {
          forceFull: true,
        });
        const count = applyRemoteSync(synced);
        setRemoteStatus('connected');
        return count;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not connect to the PC.';
        setRemoteError(message);
        setRemoteStatus('error');
        throw error;
      }
    },
    [applyRemoteSync]
  );

  const syncRemote = useCallback(async () => {
    const connection = remoteConnectionRef.current;
    const token = remoteTokenRef.current;
    if (!connection || !token) {
      throw new Error('Connect to a PC first.');
    }
    setRemoteStatus('syncing');
    setRemoteError(null);
    try {
      const count = applyRemoteSync(await runRemoteSync(connection, token));
      setRemoteStatus('connected');
      return count;
    } catch (error) {
      setRemoteError(
        error instanceof Error ? error.message : 'Could not sync the PC library.'
      );
      setRemoteStatus('error');
      throw error;
    }
  }, [applyRemoteSync, runRemoteSync]);

  useEffect(() => {
    if (
      hasAutoSyncedRemote.current ||
      !remoteConnection ||
      !remoteToken
    ) {
      return;
    }
    hasAutoSyncedRemote.current = true;
    void syncRemote().catch(() => {
      // Keep the last synced library and expose the connection error in the UI.
    });
  }, [remoteConnection, remoteToken, syncRemote]);

  useEffect(() => {
    let isSyncing = false;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const connection = remoteConnectionRef.current;
      if (
        nextState !== 'active' ||
        isSyncing ||
        !connection ||
        !remoteTokenRef.current ||
        !hasAutoSyncedRemote.current
      ) {
        return;
      }
      const lastSyncAt = connection.lastSyncAt ? Date.parse(connection.lastSyncAt) : 0;
      if (Date.now() - lastSyncAt < FOREGROUND_SYNC_INTERVAL_MS) {
        return;
      }
      isSyncing = true;
      void syncRemote()
        .catch(() => {
          // The header shows the error and a retry control.
        })
        .finally(() => {
          isSyncing = false;
        });
    });
    return () => subscription.remove();
  }, [syncRemote]);

  const checkRemoteConnection = useCallback(async () => {
    const connection = remoteConnectionRef.current;
    const token = remoteTokenRef.current;
    if (!connection || !token) {
      throw new Error('Connect to a PC first.');
    }
    await testRemoteConnection(connection, token);
    setRemoteError(null);
    setRemoteStatus('connected');
  }, []);

  const browseRemoteDirectories = useCallback(async (directoryPath?: string) => {
    const connection = remoteConnectionRef.current;
    const token = remoteTokenRef.current;
    if (!connection || !token) {
      throw new Error('Connect to a PC first.');
    }
    return fetchRemoteDirectories(connection, token, directoryPath);
  }, []);

  const saveRemoteDirectories = useCallback(
    async (paths: string[]) => {
      const connection = remoteConnectionRef.current;
      const token = remoteTokenRef.current;
      if (!connection || !token) {
        throw new Error('Connect to a PC first.');
      }
      setRemoteStatus('syncing');
      setRemoteError(null);
      try {
        await updateRemoteLibraryRoots(connection, token, paths);
        const count = applyRemoteSync(await runRemoteSync(connection, token));
        setRemoteStatus('connected');
        return count;
      } catch (error) {
        setRemoteError(
          error instanceof Error
            ? error.message
            : 'The selected PC folders could not be saved.'
        );
        setRemoteStatus('error');
        throw error;
      }
    },
    [applyRemoteSync, runRemoteSync]
  );

  const removeRemoteConnection = useCallback(async (localOnly = false) => {
    const connection = remoteConnectionRef.current;
    const token = remoteTokenRef.current;
    if (connection && token) {
      await disconnectRemoteServer(connection, token, localOnly);
    }
    remoteConnectionRef.current = null;
    remoteTokenRef.current = null;
    setRemoteConnection(null);
    setRemoteToken(null);
    setRemoteStatus('disconnected');
    setRemoteError(null);
    setLibrary((current) => current.filter((item) => item.source === 'local'));
    if (track?.source === 'remote') {
      setPlaybackIntent(false);
      nativeWasPlayingRef.current = false;
      player.pause();
      player.replace(null);
    }
  }, [player, setPlaybackIntent, track]);

  const playTrack = useCallback(
    (index: number) => {
      unavailableTrackIdsRef.current.clear();
      loadFirstAvailableTrack(queue, index, true, false);
    },
    [loadFirstAvailableTrack, queue]
  );

  const removeTrack = useCallback(
    (index: number) => {
      if (!queue[index]) {
        return;
      }

      const nextQueue = queue.filter((_, queueIndex) => queueIndex !== index);
      setQueue(nextQueue);

      if (nextQueue.length === 0) {
        setPlaybackIntent(false);
        nativeWasPlayingRef.current = false;
        player.pause();
        player.replace(null);
        setCurrentIndex(-1);
        return;
      }

      if (index < currentIndex) {
        setCurrentIndex((current) => current - 1);
        return;
      }

      if (index === currentIndex) {
        const replacementIndex = Math.min(index, nextQueue.length - 1);
        loadTrack(nextQueue[replacementIndex], replacementIndex, status.playing);
      }
    },
    [
      currentIndex,
      loadTrack,
      player,
      queue,
      setPlaybackIntent,
      status.playing,
    ]
  );

  const moveQueueTrack = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= queue.length ||
        toIndex >= queue.length
      ) {
        return;
      }
      const nextQueue = [...queue];
      [nextQueue[fromIndex], nextQueue[toIndex]] = [
        nextQueue[toIndex],
        nextQueue[fromIndex],
      ];
      setQueue(nextQueue);
      setCurrentIndex((current) => {
        if (current === fromIndex) return toIndex;
        if (current === toIndex) return fromIndex;
        return current;
      });
    },
    [queue]
  );

  const clearQueue = useCallback(() => {
    setPlaybackIntent(false);
    nativeWasPlayingRef.current = false;
    player.pause();
    player.replace(null);
    setQueue([]);
    setCurrentIndex(-1);
  }, [player, setPlaybackIntent]);

  const advanceTrack = useCallback(
    (fromCompletion: boolean) => {
      if (!track) {
        return;
      }

      if (fromCompletion && repeatMode === 'one') {
        setPlaybackIntent(true);
        player.seekTo(0).then(() => player.play());
        return;
      }

      if (fromCompletion) {
        unavailableTrackIdsRef.current.clear();
      }

      if (isShuffleEnabled && queue.length > 1) {
        const candidates = queue
          .map((candidate, index) => ({ candidate, index }))
          .filter(
            ({ candidate, index }) =>
              index !== currentIndex &&
              !unavailableTrackIdsRef.current.has(candidate.id) &&
              isTrackSourceAvailable(candidate)
          );
        const selected =
          candidates[Math.floor(Math.random() * candidates.length)];
        if (selected) {
          loadTrack(selected.candidate, selected.index, true);
        }
        return;
      }

      const nextIndex = currentIndex + 1;
      loadFirstAvailableTrack(
        queue,
        nextIndex,
        true,
        repeatMode === 'all',
        unavailableTrackIdsRef.current
      );
    },
    [
      currentIndex,
      isShuffleEnabled,
      isTrackSourceAvailable,
      loadFirstAvailableTrack,
      loadTrack,
      player,
      queue,
      repeatMode,
      setPlaybackIntent,
      track,
    ]
  );

  const nextTrack = useCallback(() => {
    unavailableTrackIdsRef.current.clear();
    advanceTrack(false);
  }, [advanceTrack]);

  const toggleShuffle = useCallback(() => {
    setIsShuffleEnabled((enabled) => !enabled);
  }, []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((current) => {
      if (current === 'off') {
        return 'all';
      }
      if (current === 'all') {
        return 'one';
      }
      return 'off';
    });
  }, []);

  const canGoNext =
    !!track &&
    (currentIndex < queue.length - 1 ||
      (isShuffleEnabled && queue.length > 1) ||
      repeatMode === 'all');

  const previousTrack = useCallback(async () => {
    if (!track) {
      return;
    }

    if (status.currentTime > 3 || currentIndex === 0) {
      await player.seekTo(0);
      return;
    }

    const previousIndex = currentIndex - 1;
    const previous = queue[previousIndex];
    if (previous) {
      loadTrack(previous, previousIndex, true);
    }
  }, [currentIndex, loadTrack, player, queue, status.currentTime, track]);

  useEffect(() => {
    if (!status.didJustFinish) {
      hasHandledFinish.current = false;
      return;
    }

    if (track && !hasHandledFinish.current) {
      hasHandledFinish.current = true;
      advanceTrack(true);
    }
  }, [advanceTrack, status.didJustFinish, track]);

  useEffect(() => {
    if (
      !track ||
      !isPlaybackRequested ||
      status.didJustFinish ||
      hasHandledFinish.current ||
      !Number.isFinite(status.duration) ||
      status.duration <= 0 ||
      status.currentTime < status.duration - NEAR_GAPLESS_HANDOFF_SECONDS
    ) {
      return;
    }
    hasHandledFinish.current = true;
    advanceTrack(true);
  }, [
    advanceTrack,
    isPlaybackRequested,
    status.currentTime,
    status.didJustFinish,
    status.duration,
    track,
  ]);

  useEffect(() => {
    if (!track || !isPlaybackRequested) {
      releasePreloadedSource();
      return;
    }
    const next = peekNextPlayableTrack(true);
    if (!next || next.candidate.id === track.id) {
      releasePreloadedSource();
      return;
    }

    const source = getPlayableSource(next.candidate);
    if (!source || source.uri.startsWith('http')) {
      releasePreloadedSource();
      return;
    }

    if (preloadedSourceRef.current?.id === next.candidate.id) {
      return;
    }
    releasePreloadedSource();

    let cancelled = false;
    try {
      const file = new File(source.uri);
      if (!file.exists || (file.size ?? 0) > PRELOAD_MAX_BYTES) {
        return;
      }
    } catch {
      return;
    }

    preloadedSourceRef.current = { id: next.candidate.id, uri: source.uri };
    void preload(source)
      .then(() => {
        if (cancelled) {
          void clearPreloadedSource({ uri: source.uri }).catch(() => undefined);
        }
      })
      .catch(() => {
        if (preloadedSourceRef.current?.id === next.candidate.id) {
          preloadedSourceRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    cacheRevision,
    getPlayableSource,
    isPlaybackRequested,
    peekNextPlayableTrack,
    releasePreloadedSource,
    track,
  ]);

  useEffect(() => {
    if (!status.error || !track) {
      playbackErrorTrackIdRef.current = null;
      return;
    }
    if (playbackErrorTrackIdRef.current !== null) {
      return;
    }

    playbackErrorTrackIdRef.current = track.id;
    if (
      track.source === 'remote' &&
      recoveredTrackIdRef.current !== track.id &&
      getCachedTrackUri(track)
    ) {
      const resumePosition = player.currentTime;
      recoveredTrackIdRef.current = track.id;
      if (loadTrack(track, currentIndex, true) && resumePosition > 0) {
        void player.seekTo(resumePosition).catch(() => undefined);
      }
      return;
    }
    unavailableTrackIdsRef.current.add(track.id);
    loadFirstAvailableTrack(
      queue,
      currentIndex + 1,
      true,
      repeatMode === 'all',
      unavailableTrackIdsRef.current
    );
  }, [
    currentIndex,
    loadFirstAvailableTrack,
    loadTrack,
    player,
    queue,
    repeatMode,
    status.error,
    track,
  ]);

  useEffect(() => {
    if (
      !track ||
      track.source !== 'remote' ||
      !isPlaybackRequested ||
      !status.isBuffering
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      if (streamingTrackIdRef.current !== track.id || !getCachedTrackUri(track)) {
        return;
      }
      const resumePosition = player.currentTime;
      if (loadTrack(track, currentIndex, true) && resumePosition > 0) {
        void player.seekTo(resumePosition).catch(() => undefined);
      }
    }, STREAM_STALL_FALLBACK_MS);
    return () => clearTimeout(timeout);
  }, [currentIndex, isPlaybackRequested, loadTrack, player, status.isBuffering, track]);

  const togglePlayback = useCallback(async () => {
    if (!track) {
      return;
    }

    if (status.playing || playbackRequestedRef.current) {
      setPlaybackIntent(false);
      nativeWasPlayingRef.current = false;
      player.pause();
      return;
    }

    if (status.didJustFinish || status.currentTime >= status.duration) {
      await player.seekTo(0);
    }
    unavailableTrackIdsRef.current.clear();
    if (!isTrackSourceAvailable(track)) {
      loadFirstAvailableTrack(queue, currentIndex, true, false);
      return;
    }
    setPlaybackIntent(true);
    player.play();
  }, [
    currentIndex,
    isTrackSourceAvailable,
    loadFirstAvailableTrack,
    player,
    queue,
    setPlaybackIntent,
    status,
    track,
  ]);

  useEffect(() => {
    remoteCommandHandlersRef.current = {
      next: nextTrack,
      previous: () => {
        void previousTrack();
      },
      resume: () => {
        if (!playbackRequestedRef.current) {
          void togglePlayback();
        }
      },
    };
  }, [nextTrack, previousTrack, togglePlayback]);

  useEffect(() => {
    const emitter = player as unknown as {
      addListener: (
        eventName: 'remoteCommand',
        listener: (event: { command?: string }) => void
      ) => { remove: () => void };
    };
    const subscription = emitter.addListener('remoteCommand', ({ command }) => {
      if (command === 'next') {
        remoteCommandHandlersRef.current.next();
      } else if (command === 'previous') {
        remoteCommandHandlersRef.current.previous();
      }
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const noisy = addAudioRouteListener('becomingNoisy', () => {
      if (
        !headsetOptionsRef.current.pauseOnHeadphoneDisconnect ||
        !playbackRequestedRef.current
      ) {
        return;
      }
      setPlaybackIntent(false);
      nativeWasPlayingRef.current = false;
      player.pause();
      autoPausedAtRef.current = Date.now();
    });
    const connected = addAudioRouteListener('outputConnected', () => {
      const autoPausedAt = autoPausedAtRef.current;
      if (
        autoPausedAt === null ||
        !headsetOptionsRef.current.resumeOnHeadphoneReconnect ||
        Date.now() - autoPausedAt > AUTO_RESUME_WINDOW_MS
      ) {
        return;
      }
      autoPausedAtRef.current = null;
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(
        () => remoteCommandHandlersRef.current.resume(),
        AUTO_RESUME_DELAY_MS
      );
    });
    return () => {
      noisy.remove();
      connected.remove();
      if (resumeTimer) clearTimeout(resumeTimer);
    };
  }, [player, setPlaybackIntent]);

  const seekTo = useCallback(
    async (seconds: number) => {
      if (track) {
        await player.seekTo(seconds);
      }
    },
    [player, track]
  );

  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const currentTime = Math.min(
    Number.isFinite(status.currentTime) ? status.currentTime : 0,
    duration || Number.MAX_SAFE_INTEGER
  );

  return useMemo(
    () => ({
      track,
      queue,
      library,
      savedPlaylists,
      remoteConnection,
      remoteToken,
      remoteStatus,
      remoteError,
      currentIndex,
      canGoNext,
      isPicking,
      isPlaying: isPlaybackRequested,
      isBuffering: status.isBuffering,
      isLoaded: status.isLoaded,
      isShuffleEnabled,
      repeatMode,
      error: status.error,
      currentTime,
      duration,
      addFilesToLibrary,
      addFilesToQueue,
      addLibraryTrackToQueue,
      addLibraryToQueue,
      removeLibraryTrack,
      updateTrackMetadata,
      createSavedPlaylist,
      renameSavedPlaylist,
      updateSavedPlaylistArtwork,
      deleteSavedPlaylist,
      addTrackToSavedPlaylist,
      addTracksToSavedPlaylist,
      removeTrackFromSavedPlaylist,
      moveTrackInSavedPlaylist,
      addSavedPlaylistToQueue,
      playSavedPlaylist,
      connectRemote,
      syncRemote,
      checkRemoteConnection,
      browseRemoteDirectories,
      saveRemoteDirectories,
      removeRemoteConnection,
      pickTracks,
      playTrack,
      removeTrack,
      moveQueueTrack,
      clearQueue,
      previousTrack,
      nextTrack,
      toggleShuffle,
      cycleRepeatMode,
      seekTo,
      togglePlayback,
    }),
    [
      currentIndex,
      canGoNext,
      currentTime,
      duration,
      addFilesToLibrary,
      addFilesToQueue,
      addLibraryToQueue,
      addLibraryTrackToQueue,
      addSavedPlaylistToQueue,
      addTrackToSavedPlaylist,
      addTracksToSavedPlaylist,
      checkRemoteConnection,
      browseRemoteDirectories,
      connectRemote,
      createSavedPlaylist,
      renameSavedPlaylist,
      updateSavedPlaylistArtwork,
      clearQueue,
      deleteSavedPlaylist,
      isPicking,
      isPlaybackRequested,
      isShuffleEnabled,
      library,
      nextTrack,
      pickTracks,
      playTrack,
      playSavedPlaylist,
      removeTrack,
      moveQueueTrack,
      previousTrack,
      queue,
      repeatMode,
      removeLibraryTrack,
      removeRemoteConnection,
      remoteConnection,
      remoteError,
      remoteStatus,
      remoteToken,
      updateTrackMetadata,
      removeTrackFromSavedPlaylist,
      moveTrackInSavedPlaylist,
      savedPlaylists,
      saveRemoteDirectories,
      syncRemote,
      seekTo,
      status.error,
      status.isBuffering,
      status.isLoaded,
      togglePlayback,
      toggleShuffle,
      cycleRepeatMode,
      track,
    ]
  );
}
