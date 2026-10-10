import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { copyAsync } from "expo-file-system/legacy";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AudioVisualizer,
  type VisualizationEffect,
} from "./AudioVisualizer";
import { DeviceScanScreen } from "./DeviceScanScreen";
import { MusicLibraryScreen } from "./MusicLibraryScreen";
import { PcConnectionGuideScreen } from "./PcConnectionGuideScreen";
import { PlaylistScreen, QueueTrackRow } from "./PlaylistScreen";
import { SavedPlaylistsScreen } from "./SavedPlaylistsScreen";
import {
  type PlaylistPlayerPosition,
  SettingsScreen,
} from "./SettingsScreen";
import { ThemeProvider, type ThemeColors, useTheme } from "./theme";
import { useLocalAudioPlayer } from "./useLocalAudioPlayer";

const PLAYER_POSITION_STORAGE_KEY =
  "home-audio-player.playlist-player-position.v1";
const SHOW_FILE_TYPE_STORAGE_KEY =
  "home-audio-player.show-file-type.v1";
const VISUALIZATION_STORAGE_KEY =
  "home-audio-player.visualization-enabled.v1";
const VISUALIZATION_EFFECT_STORAGE_KEY =
  "home-audio-player.visualization-effect.v1";
const VISUALIZATION_PRIMARY_COLOR_STORAGE_KEY =
  "home-audio-player.visualization-primary-color.v1";
const VISUALIZATION_SECONDARY_COLOR_STORAGE_KEY =
  "home-audio-player.visualization-secondary-color.v1";
const VISUALIZATION_BACKGROUND_STORAGE_KEY =
  "home-audio-player.visualization-background.v1";

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
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
    isPlaying,
    isBuffering,
    isShuffleEnabled,
    repeatMode,
    error,
    currentTime,
    duration,
    addFilesToLibrary,
    addLibraryTrackToQueue,
    addLibraryToQueue,
    removeLibraryTrack,
    updateTrackMetadata,
    createSavedPlaylist,
    renameSavedPlaylist,
    deleteSavedPlaylist,
    addTrackToSavedPlaylist,
    addTracksToSavedPlaylist,
    removeTrackFromSavedPlaylist,
    addSavedPlaylistToQueue,
    playSavedPlaylist,
    connectRemote,
    syncRemote,
    checkRemoteConnection,
    browseRemoteDirectories,
    saveRemoteDirectories,
    removeRemoteConnection,
    playTrack,
    removeTrack,
    clearQueue,
    previousTrack,
    nextTrack,
    toggleShuffle,
    cycleRepeatMode,
    seekTo,
    togglePlayback,
  } = useLocalAudioPlayer();
  const [showQueue, setShowQueue] = useState(true);
  const [showFileType, setShowFileType] = useState(false);
  const [playlistPlayerPosition, setPlaylistPlayerPosition] =
    useState<PlaylistPlayerPosition>("bottom");
  const [visualizationEnabled, setVisualizationEnabled] = useState(false);
  const [visualizationEffect, setVisualizationEffect] =
    useState<VisualizationEffect>("bars");
  const [visualizationPrimaryColor, setVisualizationPrimaryColor] =
    useState("#ffffff");
  const [visualizationSecondaryColor, setVisualizationSecondaryColor] =
    useState("#ffd60a");
  const [visualizationBackgroundImage, setVisualizationBackgroundImage] =
    useState<string | null>(null);
  const [screen, setScreen] = useState<
    | "player"
    | "playlist"
    | "library"
    | "savedPlaylists"
    | "scan"
    | "settings"
    | "pcConnectionGuide"
  >("player");
  const queuedIds = useMemo(
    () => new Set(queue.map((item) => item.id)),
    [queue],
  );
  const remoteTrackCount = useMemo(
    () => library.filter((item) => item.source === "remote").length,
    [library],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (screen === "player") {
          return false;
        }

        setScreen(
          screen === "scan" || screen === "savedPlaylists"
            ? "library"
            : screen === "pcConnectionGuide"
              ? "settings"
              : "player",
        );
        return true;
      },
    );

    return () => subscription.remove();
  }, [screen]);

  useEffect(() => {
    AsyncStorage.getItem(PLAYER_POSITION_STORAGE_KEY)
      .then((storedPosition) => {
        if (storedPosition === "top" || storedPosition === "bottom") {
          setPlaylistPlayerPosition(storedPosition);
        }
      })
      .catch(() => {
        // Keep the default position when settings cannot be loaded.
      });
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([
      SHOW_FILE_TYPE_STORAGE_KEY,
      VISUALIZATION_STORAGE_KEY,
      VISUALIZATION_EFFECT_STORAGE_KEY,
      VISUALIZATION_PRIMARY_COLOR_STORAGE_KEY,
      VISUALIZATION_SECONDARY_COLOR_STORAGE_KEY,
      VISUALIZATION_BACKGROUND_STORAGE_KEY,
    ])
      .then((storedSettings) => {
        const settings = new Map(storedSettings);
        setShowFileType(
          settings.get(SHOW_FILE_TYPE_STORAGE_KEY) === "true",
        );
        setVisualizationEnabled(
          settings.get(VISUALIZATION_STORAGE_KEY) === "true",
        );

        const storedEffect = settings.get(VISUALIZATION_EFFECT_STORAGE_KEY);
        if (
          storedEffect === "bars" ||
          storedEffect === "pulse" ||
          storedEffect === "wave" ||
          storedEffect === "spectrum" ||
          storedEffect === "orbit" ||
          storedEffect === "kaleidoscope"
        ) {
          setVisualizationEffect(storedEffect);
        }

        const storedPrimaryColor = settings.get(
          VISUALIZATION_PRIMARY_COLOR_STORAGE_KEY,
        );
        if (storedPrimaryColor) {
          setVisualizationPrimaryColor(storedPrimaryColor);
        }

        const storedSecondaryColor = settings.get(
          VISUALIZATION_SECONDARY_COLOR_STORAGE_KEY,
        );
        if (storedSecondaryColor) {
          setVisualizationSecondaryColor(storedSecondaryColor);
        }

        setVisualizationBackgroundImage(
          settings.get(VISUALIZATION_BACKGROUND_STORAGE_KEY) ?? null,
        );
      })
      .catch(() => {
        // Keep default settings when saved preferences cannot be loaded.
      });
  }, []);

  const updatePlaylistPlayerPosition = (
    position: PlaylistPlayerPosition,
  ) => {
    setPlaylistPlayerPosition(position);
    AsyncStorage.setItem(PLAYER_POSITION_STORAGE_KEY, position).catch(() => {
      // The in-memory setting still applies for the current session.
    });
  };
  const updateShowFileType = (enabled: boolean) => {
    setShowFileType(enabled);
    AsyncStorage.setItem(SHOW_FILE_TYPE_STORAGE_KEY, String(enabled)).catch(
      () => {
        // The in-memory setting still applies for the current session.
      },
    );
  };
  const updateVisualizationEnabled = (enabled: boolean) => {
    setVisualizationEnabled(enabled);
    AsyncStorage.setItem(VISUALIZATION_STORAGE_KEY, String(enabled)).catch(
      () => {
        // The in-memory setting still applies for the current session.
      },
    );
  };
  const updateVisualizationEffect = (effect: VisualizationEffect) => {
    setVisualizationEffect(effect);
    AsyncStorage.setItem(VISUALIZATION_EFFECT_STORAGE_KEY, effect).catch(
      () => {
        // The in-memory setting still applies for the current session.
      },
    );
  };
  const updateVisualizationPrimaryColor = (color: string) => {
    setVisualizationPrimaryColor(color);
    AsyncStorage.setItem(VISUALIZATION_PRIMARY_COLOR_STORAGE_KEY, color).catch(
      () => {
        // The in-memory setting still applies for the current session.
      },
    );
  };
  const updateVisualizationSecondaryColor = (color: string) => {
    setVisualizationSecondaryColor(color);
    AsyncStorage.setItem(
      VISUALIZATION_SECONDARY_COLOR_STORAGE_KEY,
      color,
    ).catch(() => {
      // The in-memory setting still applies for the current session.
    });
  };
  const chooseVisualizationBackgroundImage = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: false,
        type: "image/*",
      });
      if (result.canceled) {
        return;
      }

      const selectedImage = result.assets[0];
      const extension =
        selectedImage.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") ||
        "jpg";
      const destination = new File(
        Paths.document,
        `visualization-background-${Date.now()}.${extension}`,
      );
      await copyAsync({
        from: selectedImage.uri,
        to: destination.uri,
      });

      const previousImage = visualizationBackgroundImage;
      setVisualizationBackgroundImage(destination.uri);
      await AsyncStorage.setItem(
        VISUALIZATION_BACKGROUND_STORAGE_KEY,
        destination.uri,
      );

      if (previousImage) {
        try {
          new File(previousImage).delete();
        } catch {
          // Keep the old file if it is no longer accessible.
        }
      }
    } catch {
      Alert.alert(
        "Could not use image",
        "Choose another image and try again.",
      );
    }
  };
  const removeVisualizationBackgroundImage = () => {
    const previousImage = visualizationBackgroundImage;
    setVisualizationBackgroundImage(null);
    AsyncStorage.removeItem(VISUALIZATION_BACKGROUND_STORAGE_KEY).catch(() => {
      // The in-memory setting still applies for the current session.
    });
    if (previousImage) {
      try {
        new File(previousImage).delete();
      } catch {
        // The setting can still be cleared if the file is unavailable.
      }
    }
  };
  const confirmClearQueue = () => {
    if (queue.length === 0) {
      return;
    }

    Alert.alert(
      "Clear live queue?",
      "This stops playback and removes every song from the queue.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear Queue", style: "destructive", onPress: clearQueue },
      ],
    );
  };

  if (screen === "scan") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <DeviceScanScreen
          onAddToLibrary={addFilesToLibrary}
          onBack={() => setScreen("library")}
          onRemoteSync={syncRemote}
          remoteConnection={remoteConnection}
          remoteStatus={remoteStatus}
          remoteTrackCount={remoteTrackCount}
        />
      </SafeAreaView>
    );
  }

  if (screen === "library") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <MusicLibraryScreen
          library={library}
          onAddAll={addLibraryToQueue}
          onAddTrack={addLibraryTrackToQueue}
          onBack={() => setScreen("player")}
          onOpenPlaylists={() => setScreen("savedPlaylists")}
          onRemoveTrack={removeLibraryTrack}
          onScan={() => setScreen("scan")}
          onUpdateMetadata={updateTrackMetadata}
          queuedIds={queuedIds}
          onSyncRemote={syncRemote}
          hasRemoteConnection={Boolean(remoteConnection)}
          showFileType={showFileType}
        />
      </SafeAreaView>
    );
  }

  if (screen === "savedPlaylists") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <SavedPlaylistsScreen
          library={library}
          onAddPlaylistToQueue={addSavedPlaylistToQueue}
          onAddTrack={addTrackToSavedPlaylist}
          onAddTracks={addTracksToSavedPlaylist}
          onBack={() => setScreen("library")}
          onCreate={createSavedPlaylist}
          onDelete={deleteSavedPlaylist}
          onOpenLibrary={() => setScreen("library")}
          onPlayPlaylist={(playlistId) => {
            if (playSavedPlaylist(playlistId) > 0) {
              setScreen("playlist");
            }
          }}
          onRemoveTrack={removeTrackFromSavedPlaylist}
          onRename={renameSavedPlaylist}
          playlists={savedPlaylists}
        />
      </SafeAreaView>
    );
  }

  if (screen === "playlist") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <PlaylistScreen
          currentIndex={currentIndex}
          currentTime={currentTime}
          canGoNext={canGoNext}
          duration={duration}
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          isShuffleEnabled={isShuffleEnabled}
          onBack={() => setScreen("player")}
          onCycleRepeat={cycleRepeatMode}
          onClear={confirmClearQueue}
          onNext={nextTrack}
          onPlayTrack={playTrack}
          onPrevious={previousTrack}
          onRemoveTrack={removeTrack}
          onOpenLibrary={() => setScreen("library")}
          onSeek={seekTo}
          onTogglePlayback={togglePlayback}
          onToggleShuffle={toggleShuffle}
          playerPosition={playlistPlayerPosition}
          queue={queue}
          repeatMode={repeatMode}
          showFileType={showFileType}
          track={track}
        />
      </SafeAreaView>
    );
  }

  if (screen === "settings") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <SettingsScreen
          onBack={() => setScreen("player")}
          onRemoteConnect={connectRemote}
          onRemoteBrowse={browseRemoteDirectories}
          onRemoteDisconnect={removeRemoteConnection}
          onRemoteFoldersSave={saveRemoteDirectories}
          onRemoteSync={syncRemote}
          onRemoteTest={checkRemoteConnection}
          onOpenPcConnectionGuide={() => setScreen("pcConnectionGuide")}
          onPlayerPositionChange={updatePlaylistPlayerPosition}
          onShowFileTypeChange={updateShowFileType}
          onVisualizationEffectChange={updateVisualizationEffect}
          onVisualizationEnabledChange={updateVisualizationEnabled}
          onVisualizationBackgroundImageChoose={
            chooseVisualizationBackgroundImage
          }
          onVisualizationBackgroundImageRemove={
            removeVisualizationBackgroundImage
          }
          onVisualizationPrimaryColorChange={
            updateVisualizationPrimaryColor
          }
          onVisualizationSecondaryColorChange={
            updateVisualizationSecondaryColor
          }
          playerPosition={playlistPlayerPosition}
          remoteConnection={remoteConnection}
          remoteError={remoteError}
          remoteStatus={remoteStatus}
          showFileType={showFileType}
          visualizationEffect={visualizationEffect}
          visualizationEnabled={visualizationEnabled}
          visualizationBackgroundImage={visualizationBackgroundImage}
          visualizationPrimaryColor={visualizationPrimaryColor}
          visualizationSecondaryColor={visualizationSecondaryColor}
        />
      </SafeAreaView>
    );
  }

  if (screen === "pcConnectionGuide") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <PcConnectionGuideScreen onBack={() => setScreen("settings")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />

      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="musical-note" size={17} color="#fff" />
          </View>
          <Text style={styles.brandName}>HomeMusicPlayer</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => setScreen("settings")}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons
            name="settings-outline"
            size={23}
            color={colors.secondaryText}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.playerCard}>
          <View
            style={[
              styles.artwork,
              !track?.artwork &&
                visualizationEnabled &&
                isPlaying &&
                !visualizationBackgroundImage && {
                  backgroundColor: colors.accent,
                },
            ]}
          >
            <View style={[styles.orb, styles.orbTop]} />
            <View style={[styles.orb, styles.orbBottom]} />
            {track?.artwork ? (
              <>
                <Image
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  source={{
                    uri: track.artwork,
                    ...(track.source === "remote" && remoteToken
                      ? { headers: { Authorization: `Bearer ${remoteToken}` } }
                      : {}),
                  }}
                  style={styles.albumArtworkBackdrop}
                />
                <View style={styles.albumArtworkBackdropOverlay} />
                <Image
                  accessibilityLabel={`Album artwork for ${track.name}`}
                  resizeMode="contain"
                  source={{
                    uri: track.artwork,
                    ...(track.source === "remote" && remoteToken
                      ? { headers: { Authorization: `Bearer ${remoteToken}` } }
                      : {}),
                  }}
                  style={styles.albumArtwork}
                />
              </>
            ) : visualizationEnabled && visualizationBackgroundImage ? (
              <>
                <Image
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  source={{ uri: visualizationBackgroundImage }}
                  style={styles.visualizationBackground}
                />
                <View style={styles.visualizationBackgroundOverlay} />
              </>
            ) : !visualizationEnabled || !isPlaying ? (
              <View style={styles.noteDisc}>
                <Ionicons name="musical-notes" size={68} color="#fff" />
              </View>
            ) : null}
            {visualizationEnabled && isPlaying && (
              <View pointerEvents="none" style={styles.visualizerOverlay}>
                <AudioVisualizer
                  effect={visualizationEffect}
                  primaryColor={visualizationPrimaryColor}
                  secondaryColor={visualizationSecondaryColor}
                />
              </View>
            )}
          </View>

          <View style={styles.trackInfo}>
            <View style={styles.trackText}>
              <Text numberOfLines={1} style={styles.trackTitle}>
                {track?.name ?? "No song selected"}
              </Text>
              <Text numberOfLines={1} style={styles.artistName}>
                {track?.artist ?? "Choose a song from your device"}
              </Text>
            </View>
            {track && showFileType && (
              <View style={styles.formatBadge}>
                <Text style={styles.formatText}>{track.extension}</Text>
              </View>
            )}
          </View>

          <View style={styles.progressBlock}>
            <Slider
              accessibilityLabel="Playback position"
              disabled={!track || duration <= 0}
              maximumTrackTintColor={colors.progressTrack}
              maximumValue={duration || 1}
              minimumTrackTintColor={colors.accent}
              minimumValue={0}
              onSlidingComplete={seekTo}
              step={0.1}
              style={styles.slider}
              thumbTintColor={track ? colors.accent : colors.muted}
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
              accessibilityLabel="Previous track"
              disabled={!track}
              onPress={previousTrack}
              style={({ pressed }) => [
                styles.sideControl,
                !track && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons name="play-skip-back" size={32} color={colors.text} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back 5 seconds"
              disabled={!track}
              onPress={() => seekTo(Math.max(currentTime - 5, 0))}
              style={({ pressed }) => [
                styles.seekControl,
                !track && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons
                name="play-back"
                size={22}
                color={colors.secondaryText}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                track ? (isPlaying ? "Pause" : "Play") : "Open music library"
              }
              onPress={
                track ? togglePlayback : () => setScreen("library")
              }
              style={({ pressed }) => [
                styles.playButton,
                pressed && styles.playButtonPressed,
              ]}
            >
              {isBuffering && track ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={36}
                  color="#fff"
                  style={!isPlaying && styles.playIcon}
                />
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go forward 5 seconds"
              disabled={!track}
              onPress={() => seekTo(Math.min(currentTime + 5, duration))}
              style={({ pressed }) => [
                styles.seekControl,
                !track && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons
                name="play-forward"
                size={22}
                color={colors.secondaryText}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next track"
              disabled={!canGoNext}
              onPress={nextTrack}
              style={({ pressed }) => [
                styles.sideControl,
                !canGoNext && styles.controlDisabled,
                pressed && track && styles.controlPressed,
              ]}
            >
              <Ionicons
                name="play-skip-forward"
                size={32}
                color={colors.text}
              />
            </Pressable>
          </View>

          <View style={styles.playModeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isShuffleEnabled ? "Turn shuffle off" : "Turn shuffle on"
              }
              accessibilityState={{ selected: isShuffleEnabled }}
              onPress={toggleShuffle}
              style={({ pressed }) => [
                styles.playModeButton,
                isShuffleEnabled && styles.playModeButtonActive,
                pressed && styles.controlPressed,
              ]}
            >
              <Ionicons
                name="shuffle"
                size={20}
                color={isShuffleEnabled ? colors.accent : colors.secondaryText}
              />
              <Text
                style={[
                  styles.playModeText,
                  isShuffleEnabled && styles.playModeTextActive,
                ]}
              >
                Shuffle
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                repeatMode === "one"
                  ? "Repeat one enabled"
                  : repeatMode === "all"
                    ? "Repeat playlist enabled"
                    : "Repeat off"
              }
              accessibilityState={{ selected: repeatMode !== "off" }}
              onPress={cycleRepeatMode}
              style={({ pressed }) => [
                styles.playModeButton,
                repeatMode !== "off" && styles.playModeButtonActive,
                pressed && styles.controlPressed,
              ]}
            >
              <View>
                <Ionicons
                  name="repeat"
                  size={20}
                  color={
                    repeatMode !== "off"
                      ? colors.accent
                      : colors.secondaryText
                  }
                />
                {repeatMode === "one" && (
                  <View style={styles.repeatOneBadge}>
                    <Text style={styles.repeatOneText}>1</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.playModeText,
                  repeatMode !== "off" && styles.playModeTextActive,
                ]}
              >
                {repeatMode === "one"
                  ? "Repeat One"
                  : repeatMode === "all"
                    ? "Repeat All"
                    : "Repeat"}
              </Text>
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

        <View style={styles.queuePanel}>
          <View style={styles.queuePanelHeader}>
            <View style={styles.queuePanelTitleGroup}>
              <View>
                <Text style={[styles.queuePanelTitle, styles.accentText]}>
                  Playlist
                </Text>
                <Text style={styles.queuePanelSubtitle}>
                  {queue.length
                    ? `${queue.length} ${queue.length === 1 ? "song" : "songs"} queued`
                    : "No songs queued"}
                </Text>
              </View>
            </View>
            <View style={styles.queuePanelActions}>
              {queue.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear live queue"
                  onPress={confirmClearQueue}
                  style={({ pressed }) => [
                    styles.smallIconButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={colors.muted}
                  />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open music library"
                onPress={() => setScreen("library")}
                style={({ pressed }) => [
                  styles.smallIconButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons
                  name="library-outline"
                  size={21}
                  color={colors.accent}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open full playlist"
                onPress={() => setScreen("playlist")}
                style={({ pressed }) => [
                  styles.smallIconButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons
                  name="list-outline"
                  size={21}
                  color={colors.accent}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  showQueue ? "Hide playlist" : "Show playlist"
                }
                onPress={() => setShowQueue((visible) => !visible)}
                style={({ pressed }) => [
                  styles.smallIconButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons
                  name={showQueue ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={colors.secondaryText}
                />
              </Pressable>
            </View>
          </View>

          {showQueue && (
            <View style={styles.compactQueue}>
              {queue.length === 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open music library"
                  onPress={() => setScreen("library")}
                  style={({ pressed }) => [
                    styles.emptyQueue,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={24}
                    color={colors.accent}
                  />
                  <Text style={styles.emptyQueueText}>
                    Choose songs from your library
                  </Text>
                </Pressable>
              ) : (
                <>
                  {queue.slice(0, 4).map((item, index) => (
                    <QueueTrackRow
                      index={index}
                      isCurrent={index === currentIndex}
                      key={item.id}
                      onPlayTrack={playTrack}
                      onRemoveTrack={removeTrack}
                      showFileType={showFileType}
                      track={item}
                    />
                  ))}
                  {queue.length > 4 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setScreen("playlist")}
                      style={styles.moreSongsButton}
                    >
                      <Text style={styles.moreSongsText}>
                        View {queue.length - 4} more
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.accent}
                      />
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.header,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 64,
    justifyContent: "space-between",
    paddingHorizontal: 22,
  },
  brand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  brandIcon: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 9,
    height: 32,
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    width: 32,
  },
  brandName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  settingsButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  queueButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 38,
    justifyContent: "center",
    position: "relative",
    width: 42,
  },
  queueBadge: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderColor: "#fff",
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    justifyContent: "center",
    minWidth: 16,
    paddingHorizontal: 3,
    position: "absolute",
    right: 2,
    top: 2,
  },
  queueBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
  },
  addButton: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 112,
    paddingHorizontal: 10,
  },
  addButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "600",
  },
  buttonPressed: {
    backgroundColor: colors.accentSoft,
  },
  content: {
    alignSelf: "center",
    maxWidth: 560,
    paddingBottom: 28,
    paddingHorizontal: 22,
    paddingTop: 28,
    width: "100%",
  },
  titleBlock: {
    marginBottom: 22,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  pageTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.9,
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: 15,
    marginTop: 5,
  },
  playerCard: {
    backgroundColor: colors.surface,
    borderColor: "rgba(0,0,0,0.04)",
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
  },
  artwork: {
    alignSelf: "center",
    aspectRatio: 1.45,
    backgroundColor: colors.accent,
    borderRadius: 18,
    justifyContent: "center",
    maxHeight: 240,
    overflow: "hidden",
    width: "100%",
  },
  albumArtwork: {
    height: "100%",
    width: "100%",
  },
  albumArtworkBackdrop: {
    bottom: 0,
    left: 0,
    opacity: 0.5,
    position: "absolute",
    right: 0,
    top: 0,
  },
  albumArtworkBackdropOverlay: {
    backgroundColor: "rgba(0,0,0,0.28)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  visualizationBackground: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  visualizationBackgroundOverlay: {
    backgroundColor: "rgba(0,0,0,0.3)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  visualizerOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  orb: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 140,
    height: 220,
    position: "absolute",
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
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(116,0,31,0.24)",
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: 58,
    borderWidth: 1,
    height: 116,
    justifyContent: "center",
    width: 116,
  },
  trackInfo: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingTop: 18,
  },
  trackText: {
    flex: 1,
  },
  trackTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  artistName: {
    color: colors.secondaryText,
    fontSize: 14,
    marginTop: 3,
  },
  formatBadge: {
    backgroundColor: colors.elevated,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  formatText: {
    color: colors.secondaryText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  progressBlock: {
    marginTop: 16,
  },
  slider: {
    height: 30,
    marginHorizontal: -3,
    width: "auto",
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  time: {
    color: colors.secondaryText,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-evenly",
    marginBottom: 6,
    marginTop: 12,
  },
  sideControl: {
    alignItems: "center",
    backgroundColor: colors.playbackControlBackground,
    borderColor: colors.playbackControlBorder,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  seekControl: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.playbackControlBorder,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  controlPressed: {
    backgroundColor: colors.elevated,
    transform: [{ scale: 0.96 }],
  },
  controlDisabled: {
    opacity: 0.25,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 35,
    height: 70,
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.27,
    shadowRadius: 16,
    width: 70,
  },
  playButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.96 }],
  },
  playIcon: {
    marginLeft: 4,
  },
  playModeRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginTop: 8,
    paddingTop: 12,
  },
  playModeButton: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 12,
  },
  playModeButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  playModeText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: "600",
  },
  playModeTextActive: {
    color: colors.accent,
  },
  repeatOneBadge: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderColor: "#fff",
    borderRadius: 6,
    borderWidth: 1,
    bottom: -3,
    height: 12,
    justifyContent: "center",
    position: "absolute",
    right: -5,
    width: 12,
  },
  repeatOneText: {
    color: "#fff",
    fontSize: 7,
    fontWeight: "800",
  },
  errorBanner: {
    alignItems: "center",
    backgroundColor: "#fff2f0",
    borderRadius: 10,
    flexDirection: "row",
    gap: 7,
    marginTop: 10,
    padding: 11,
  },
  errorText: {
    color: "#b42318",
    flex: 1,
    fontSize: 12,
  },
  queuePanel: {
    backgroundColor: colors.surface,
    borderColor: "rgba(0,0,0,0.04)",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    overflow: "hidden",
  },
  queuePanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  queuePanelTitleGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  queuePanelIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  queuePanelTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  accentText: {
    color: colors.accent,
  },
  queuePanelSubtitle: {
    color: colors.secondaryText,
    fontSize: 11,
    marginTop: 2,
  },
  queuePanelActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
  },
  smallIconButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  compactQueue: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 7,
    padding: 9,
  },
  emptyQueue: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    padding: 18,
  },
  emptyQueueText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "600",
  },
  moreSongsButton: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 10,
  },
  moreSongsText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "600",
  },
  privacyNote: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: 18,
  },
  privacyText: {
    color: colors.secondaryText,
    fontSize: 12,
  },
});
