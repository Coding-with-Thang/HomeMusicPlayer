import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useLocalAudioPlayer } from './useLocalAudioPlayer';

const ACCENT = '#fa2d48';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return '0:00';
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function App() {
  const {
    track,
    isPicking,
    isPlaying,
    isBuffering,
    error,
    currentTime,
    duration,
    pickTrack,
    seekTo,
    togglePlayback,
  } = useLocalAudioPlayer();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="musical-note" size={17} color="#fff" />
          </View>
          <Text style={styles.brandName}>Home Music</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose an audio file"
          disabled={isPicking}
          onPress={pickTrack}
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.buttonPressed,
          ]}
        >
          {isPicking ? (
            <ActivityIndicator color={ACCENT} size="small" />
          ) : (
            <>
              <Ionicons name="add" size={20} color={ACCENT} />
              <Text style={styles.addButtonText}>Add Music</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>NOW PLAYING</Text>
          <Text style={styles.pageTitle}>
            {track ? 'Listen now' : 'Your music, at home'}
          </Text>
          <Text style={styles.subtitle}>
            {track
              ? 'Playing directly from your device'
              : 'Choose a local audio file to get started.'}
          </Text>
        </View>

        <View style={styles.playerCard}>
          <View style={styles.artwork}>
            <View style={[styles.orb, styles.orbTop]} />
            <View style={[styles.orb, styles.orbBottom]} />
            <View style={styles.noteDisc}>
              <Ionicons name="musical-notes" size={68} color="#fff" />
            </View>
          </View>

          <View style={styles.trackInfo}>
            <View style={styles.trackText}>
              <Text numberOfLines={1} style={styles.trackTitle}>
                {track?.name ?? 'No song selected'}
              </Text>
              <Text numberOfLines={1} style={styles.artistName}>
                {track ? 'Local audio' : 'Choose a song from your device'}
              </Text>
            </View>
            {track && (
              <View style={styles.formatBadge}>
                <Text style={styles.formatText}>{track.extension}</Text>
              </View>
            )}
          </View>

          <View style={styles.progressBlock}>
            <Slider
              accessibilityLabel="Playback position"
              disabled={!track || duration <= 0}
              maximumTrackTintColor="#dedee3"
              maximumValue={duration || 1}
              minimumTrackTintColor={ACCENT}
              minimumValue={0}
              onSlidingComplete={seekTo}
              step={0.1}
              style={styles.slider}
              thumbTintColor={track ? ACCENT : '#c7c7cc'}
              value={track ? currentTime : 0}
            />
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatTime(currentTime)}</Text>
              <Text style={styles.time}>
                -{formatTime(Math.max(duration - currentTime, 0))}
              </Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back 15 seconds"
              disabled={!track}
              onPress={() => seekTo(Math.max(currentTime - 15, 0))}
              style={({ pressed }) => [
                styles.sideControl,
                !track && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons name="play-back" size={32} color="#1d1d1f" />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              onPress={togglePlayback}
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.playButtonPressed,
              ]}
            >
              {isBuffering && track ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={36}
                  color="#fff"
                  style={!isPlaying && styles.playIcon}
                />
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go forward 15 seconds"
              disabled={!track}
              onPress={() => seekTo(Math.min(currentTime + 15, duration))}
              style={({ pressed }) => [
                styles.sideControl,
                !track && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons name="play-forward" size={32} color="#1d1d1f" />
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={17} color="#b42318" />
              <Text style={styles.errorText}>
                This file could not be played on your device.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed" size={14} color="#86868b" />
          <Text style={styles.privacyText}>
            Your audio stays on this device.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f7',
    paddingTop: Platform.OS === 'android' ? 30 : 0,
  },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderBottomColor: '#e5e5ea',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  brandIcon: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    width: 32,
  },
  brandName: {
    color: '#1d1d1f',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  addButton: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 3,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 112,
    paddingHorizontal: 10,
  },
  addButtonText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '600',
  },
  buttonPressed: {
    backgroundColor: '#fff0f2',
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 560,
    paddingHorizontal: 22,
    paddingTop: 28,
    width: '100%',
  },
  titleBlock: {
    marginBottom: 22,
  },
  eyebrow: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  pageTitle: {
    color: '#1d1d1f',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.9,
  },
  subtitle: {
    color: '#6e6e73',
    fontSize: 15,
    marginTop: 5,
  },
  playerCard: {
    backgroundColor: '#fff',
    borderColor: 'rgba(0,0,0,0.04)',
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
  },
  artwork: {
    alignSelf: 'center',
    aspectRatio: 1.45,
    backgroundColor: '#e83656',
    borderRadius: 18,
    justifyContent: 'center',
    maxHeight: 240,
    overflow: 'hidden',
    width: '100%',
  },
  orb: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 140,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  orbTop: {
    right: -55,
    top: -110,
  },
  orbBottom: {
    bottom: -130,
    left: -40,
  },
  noteDisc: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(116,0,31,0.24)',
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 58,
    borderWidth: 1,
    height: 116,
    justifyContent: 'center',
    width: 116,
  },
  trackInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 18,
  },
  trackText: {
    flex: 1,
  },
  trackTitle: {
    color: '#1d1d1f',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  artistName: {
    color: '#86868b',
    fontSize: 14,
    marginTop: 3,
  },
  formatBadge: {
    backgroundColor: '#f2f2f7',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  formatText: {
    color: '#6e6e73',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  progressBlock: {
    marginTop: 16,
  },
  slider: {
    height: 30,
    marginHorizontal: -3,
    width: 'auto',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  time: {
    color: '#86868b',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 6,
    marginTop: 12,
  },
  sideControl: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    marginHorizontal: 18,
    width: 56,
  },
  controlPressed: {
    backgroundColor: '#f2f2f7',
    transform: [{ scale: 0.96 }],
  },
  controlDisabled: {
    opacity: 0.25,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 35,
    height: 70,
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.27,
    shadowRadius: 16,
    width: 70,
  },
  playButtonPressed: {
    backgroundColor: '#e51f3b',
    transform: [{ scale: 0.96 }],
  },
  playIcon: {
    marginLeft: 4,
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: '#fff2f0',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
    padding: 11,
  },
  errorText: {
    color: '#b42318',
    flex: 1,
    fontSize: 12,
  },
  privacyNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 18,
  },
  privacyText: {
    color: '#86868b',
    fontSize: 12,
  },
});
