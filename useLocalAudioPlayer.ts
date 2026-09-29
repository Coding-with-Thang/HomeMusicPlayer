import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAudioMetadata } from '@missingcore/audio-metadata';
import { writeTags } from '@dantheman827/taglib-ts/simpleApi.js';
import {
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  disconnectRemoteServer,
  fetchRemoteDirectories,
  fetchRemoteLibrary,
  loadRemoteConnection,
  pairRemoteServer,
  remoteArtworkUrl,
  remoteStreamUrl,
  testRemoteConnection,
  updateRemoteLibraryRoots,
  updateRemoteTrackMetadata,
  type RemoteConnection,
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

export type LocalTrack = {
  album?: string;
  albumArtist?: string;
  artist: string;
  artwork?: string;
  genre?: string;
  name: string;
  extension: string;
  id: string;
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
  id: string;
  name: string;
  trackIds: string[];
};

export type AudioFileInput = {
  name: string;
  uri: string;
};

type StoredQueue = {
  currentIndex: number;
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
    name: legacy.name,
    source: 'local',
    uri: legacy.uri,
  };
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
    source: 'local',
    uri: file.uri,
    track,
    year,
  };
}

export function useLocalAudioPlayer() {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [queue, setQueue] = useState<LocalTrack[]>([]);
  const [library, setLibrary] = useState<LocalTrack[]>([]);
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>([]);
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
  const hasHandledFinish = useRef(false);
  const hasLoadedLibrary = useRef(false);
  const hasLoadedPlaylists = useRef(false);
  const hasLoadedQueue = useRef(false);
  const hasRestoredRemoteSource = useRef(false);
  const notificationPermissionRequest = useRef<Promise<unknown> | null>(null);
  const remoteConnectionRef = useRef<RemoteConnection | null>(null);
  const remoteTokenRef = useRef<string | null>(null);
  const track = queue[currentIndex] ?? null;

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
          title: track.name,
          artist: track.artist,
          ...(track.album ? { albumTitle: track.album } : {}),
        },
        {
          showSeekBackward: true,
          showSeekForward: true,
        }
      );
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
          setLibrary(parsed.map(migrateTrack).filter((item): item is LocalTrack => Boolean(item)));
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
      AsyncStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library)).catch(
        () => {
          // Keep the in-memory library available if persistence fails.
        }
      );
    }
  }, [library]);

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
          setSavedPlaylists(
            parsed
              .filter(
                (item) =>
                typeof item?.id === 'string' &&
                typeof item?.name === 'string' &&
                  (Array.isArray(item?.trackIds) || Array.isArray(item?.trackUris))
              )
              .map((item) => ({
                id: item.id!,
                name: item.name!,
                trackIds: Array.isArray(item.trackIds)
                  ? item.trackIds
                  : (item.trackUris ?? []).map((uri) => `local:${uri}`),
              }))
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
      AsyncStorage.setItem(
        PLAYLISTS_STORAGE_KEY,
        JSON.stringify(savedPlaylists)
      ).catch(() => {
        // Keep playlists available in memory if persistence fails.
      });
    }
  }, [savedPlaylists]);

  const loadTrack = useCallback(
    (nextTrack: LocalTrack, index: number, shouldPlay: boolean) => {
      player.pause();
      if (nextTrack.source === 'remote') {
        const activeConnection = remoteConnectionRef.current;
        const activeToken = remoteTokenRef.current;
        if (!activeConnection || !activeToken || !nextTrack.remoteId) {
          player.replace(null);
          setRemoteError('Connect to the PC before playing this track.');
          setRemoteStatus('error');
          setCurrentIndex(index);
          return;
        }
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
        player.play();
      }
    },
    [player]
  );

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
      const storedQueue: StoredQueue = {
        currentIndex,
        tracks: queue,
      };
      AsyncStorage.setItem(
        QUEUE_STORAGE_KEY,
        JSON.stringify(storedQueue)
      ).catch(() => {
        // Keep the live queue available in memory if persistence fails.
      });
    }
  }, [currentIndex, queue]);

  const addTracksToQueue = useCallback(
    (tracks: LocalTrack[]) => {
      const queuedIds = new Set(queue.map((queuedTrack) => queuedTrack.id));
      const uniqueTracks = tracks.filter(
        (candidate, index, allTracks) =>
          !queuedIds.has(candidate.id) &&
          allTracks.findIndex((item) => item.id === candidate.id) === index
      );

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
    async (files: AudioFileInput[]) => {
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

      if (scannedTracks.length > 0) {
        setLibrary((current) => {
          const merged = new Map(current.map((track) => [track.id, track]));
          scannedTracks.forEach((track) => merged.set(track.id, track));
          return [...merged.values()].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
        });
      }

      return addedCount;
    },
    [library]
  );

  const addLibraryTrackToQueue = useCallback(
    (libraryTrack: LocalTrack) => addTracksToQueue([libraryTrack]),
    [addTracksToQueue]
  );

  const addLibraryToQueue = useCallback(
    () => addTracksToQueue(library),
    [addTracksToQueue, library]
  );

  const removeLibraryTrack = useCallback((id: string) => {
    setLibrary((current) => current.filter((item) => item.id !== id));
    setSavedPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        trackIds: playlist.trackIds.filter((trackId) => trackId !== id),
      }))
    );
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

  const deleteSavedPlaylist = useCallback((playlistId: string) => {
    setSavedPlaylists((current) =>
      current.filter((playlist) => playlist.id !== playlistId)
    );
  }, []);

  const addTrackToSavedPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setSavedPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId &&
          !playlist.trackIds.includes(trackId)
            ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
            : playlist
        )
      );
    },
    []
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
              }
            : playlist
        )
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
      const tracks = playlist.trackIds
        .map((id) => library.find((item) => item.id === id))
        .filter((item): item is LocalTrack => Boolean(item));
      return addTracksToQueue(tracks);
    },
    [addTracksToQueue, library, savedPlaylists]
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

  const mergeRemoteTracks = useCallback(
    (
      connection: RemoteConnection,
      remoteTracks: Awaited<ReturnType<typeof fetchRemoteLibrary>>['tracks']
    ) => {
      const mapped: LocalTrack[] = remoteTracks.map((item) => ({
        album: item.album,
        albumArtist: item.albumArtist,
        artist: item.artist,
        artwork: item.hasArtwork
          ? remoteArtworkUrl(connection, item.id)
          : undefined,
        extension: item.extension,
        genre: item.genre,
        id: `remote:${connection.serverId}:${item.id}`,
        name: item.name,
        remoteId: item.id,
        source: 'remote',
        track: item.track,
        uri: `remote://${connection.serverId}/${item.id}`,
        year: item.year,
      }));
      const byId = new Map(mapped.map((item) => [item.id, item]));
      setLibrary((current) =>
        [...current.filter((item) => item.source === 'local'), ...mapped].sort(
          (left, right) => left.name.localeCompare(right.name)
        )
      );
      setQueue((current) =>
        current.map((item) =>
          item.source === 'remote' ? (byId.get(item.id) ?? item) : item
        )
      );
      return mapped.length;
    },
    []
  );

  const connectRemote = useCallback(
    async (baseUrl: string, code: string) => {
      setRemoteStatus('connecting');
      setRemoteError(null);
      try {
        const paired = await pairRemoteServer(baseUrl, code);
        remoteConnectionRef.current = paired.connection;
        remoteTokenRef.current = paired.token;
        setRemoteConnection(paired.connection);
        setRemoteToken(paired.token);
        const synced = await fetchRemoteLibrary(
          paired.connection,
          paired.token
        );
        remoteConnectionRef.current = synced.connection;
        setRemoteConnection(synced.connection);
        const count = mergeRemoteTracks(synced.connection, synced.tracks);
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
    [mergeRemoteTracks]
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
      const synced = await fetchRemoteLibrary(connection, token);
      remoteConnectionRef.current = synced.connection;
      setRemoteConnection(synced.connection);
      const count = mergeRemoteTracks(synced.connection, synced.tracks);
      setRemoteStatus('connected');
      return count;
    } catch (error) {
      setRemoteError(
        error instanceof Error ? error.message : 'Could not sync the PC library.'
      );
      setRemoteStatus('error');
      throw error;
    }
  }, [mergeRemoteTracks]);

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
        const synced = await fetchRemoteLibrary(connection, token);
        remoteConnectionRef.current = synced.connection;
        setRemoteConnection(synced.connection);
        const count = mergeRemoteTracks(synced.connection, synced.tracks);
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
    [mergeRemoteTracks]
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
    const remoteIds = new Set(
      library.filter((item) => item.source === 'remote').map((item) => item.id)
    );
    setLibrary((current) => current.filter((item) => item.source === 'local'));
    setQueue((current) => current.filter((item) => item.source === 'local'));
    setSavedPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        trackIds: playlist.trackIds.filter((id) => !remoteIds.has(id)),
      }))
    );
    if (track?.source === 'remote') {
      player.pause();
      player.replace(null);
      setCurrentIndex(-1);
    }
  }, [library, player, track]);

  const playTrack = useCallback(
    (index: number) => {
      const selectedTrack = queue[index];
      if (selectedTrack) {
        loadTrack(selectedTrack, index, true);
      }
    },
    [loadTrack, queue]
  );

  const removeTrack = useCallback(
    (index: number) => {
      if (!queue[index]) {
        return;
      }

      const nextQueue = queue.filter((_, queueIndex) => queueIndex !== index);
      setQueue(nextQueue);

      if (nextQueue.length === 0) {
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
    [currentIndex, loadTrack, player, queue, status.playing]
  );

  const clearQueue = useCallback(() => {
    player.pause();
    player.replace(null);
    setQueue([]);
    setCurrentIndex(-1);
  }, [player]);

  const advanceTrack = useCallback(
    (fromCompletion: boolean) => {
      if (!track) {
        return;
      }

      if (fromCompletion && repeatMode === 'one') {
        player.seekTo(0).then(() => player.play());
        return;
      }

      if (isShuffleEnabled && queue.length > 1) {
        let nextIndex = Math.floor(Math.random() * (queue.length - 1));
        if (nextIndex >= currentIndex) {
          nextIndex += 1;
        }
        loadTrack(queue[nextIndex], nextIndex, true);
        return;
      }

      const nextIndex = currentIndex + 1;
      const next = queue[nextIndex];
      if (next) {
        loadTrack(next, nextIndex, true);
        return;
      }

      if (repeatMode === 'all' && queue.length > 0) {
        loadTrack(queue[0], 0, true);
      }
    },
    [
      currentIndex,
      isShuffleEnabled,
      loadTrack,
      player,
      queue,
      repeatMode,
      track,
    ]
  );

  const nextTrack = useCallback(() => {
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

  const togglePlayback = useCallback(async () => {
    if (!track) {
      return;
    }

    if (status.playing) {
      player.pause();
      return;
    }

    if (status.didJustFinish || status.currentTime >= status.duration) {
      await player.seekTo(0);
    }
    player.play();
  }, [player, status, track]);

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
      isPlaying: status.playing,
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
      deleteSavedPlaylist,
      addTrackToSavedPlaylist,
      removeTrackFromSavedPlaylist,
      addSavedPlaylistToQueue,
      connectRemote,
      syncRemote,
      checkRemoteConnection,
      browseRemoteDirectories,
      saveRemoteDirectories,
      removeRemoteConnection,
      pickTracks,
      playTrack,
      removeTrack,
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
      checkRemoteConnection,
      browseRemoteDirectories,
      connectRemote,
      createSavedPlaylist,
      renameSavedPlaylist,
      clearQueue,
      deleteSavedPlaylist,
      isPicking,
      isShuffleEnabled,
      library,
      nextTrack,
      pickTracks,
      playTrack,
      removeTrack,
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
      savedPlaylists,
      saveRemoteDirectories,
      syncRemote,
      seekTo,
      status.error,
      status.isBuffering,
      status.isLoaded,
      status.playing,
      togglePlayback,
      toggleShuffle,
      cycleRepeatMode,
      track,
    ]
  );
}
