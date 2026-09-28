import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';

const SUPPORTED_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'opus',
]);

export type LocalTrack = {
  name: string;
  extension: string;
  uri: string;
};

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function useLocalAudioPlayer() {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [track, setTrack] = useState<LocalTrack | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      // Playback still works with the platform's default audio session.
    });
  }, []);

  const pickTrack = useCallback(async () => {
    try {
      setIsPicking(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const extension = getExtension(asset.name);

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        Alert.alert(
          'Unsupported file',
          'Choose an MP3, M4A, AAC, WAV, FLAC, OGG, or Opus audio file.'
        );
        return;
      }

      player.pause();
      player.replace({ uri: asset.uri, name: asset.name });
      setTrack({
        name: asset.name.replace(/\.[^/.]+$/, ''),
        extension: extension.toUpperCase(),
        uri: asset.uri,
      });
    } catch {
      Alert.alert('Could not open file', 'Please try choosing the audio file again.');
    } finally {
      setIsPicking(false);
    }
  }, [player]);

  const togglePlayback = useCallback(async () => {
    if (!track) {
      await pickTrack();
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
  }, [pickTrack, player, status, track]);

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
      isPicking,
      isPlaying: status.playing,
      isBuffering: status.isBuffering,
      isLoaded: status.isLoaded,
      error: status.error,
      currentTime,
      duration,
      pickTrack,
      seekTo,
      togglePlayback,
    }),
    [
      currentTime,
      duration,
      isPicking,
      pickTrack,
      seekTo,
      status.error,
      status.isBuffering,
      status.isLoaded,
      status.playing,
      togglePlayback,
      track,
    ]
  );
}
