import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { memo, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { PlaylistPlayerPosition } from "./SettingsScreen";
import { type ThemeColors, useTheme } from "./theme";
import type { LocalTrack, RepeatMode } from "./useLocalAudioPlayer";

type QueueTrackRowProps = {
  index: number;
  isCurrent: boolean;
  onPlayTrack: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  showFileType: boolean;
  track: LocalTrack;
};

export const QueueTrackRow = memo(function QueueTrackRow({
  index,
  isCurrent,
  onPlayTrack,
  onRemoveTrack,
  showFileType,
  track,
}: QueueTrackRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${track.name} by ${track.artist}`}
      onPress={() => onPlayTrack(index)}
      style={({ pressed }) => [
        styles.trackRow,
        isCurrent && styles.currentTrackRow,
        pressed && styles.trackRowPressed,
      ]}
    >
      <View
        style={[styles.trackNumber, isCurrent && styles.currentTrackNumber]}
      >
        {isCurrent ? (
          <Ionicons name="volume-high" color="#fff" size={13} />
        ) : (
          <Text style={styles.trackNumberText}>{index + 1}</Text>
        )}
      </View>
      <View style={styles.trackDetails}>
        <Text
          numberOfLines={1}
          style={[styles.trackName, isCurrent && styles.currentTrackText]}
        >
          {track.name}
        </Text>
        <Text numberOfLines={1} style={styles.artistName}>
          {track.artist}
        </Text>
      </View>
      {showFileType && <Text style={styles.format}>{track.extension}</Text>}
      {track.source === "remote" && <Text style={styles.sourceBadge}>PC</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${track.name} from playlist`}
        hitSlop={8}
        onPress={() => onRemoveTrack(index)}
        style={({ pressed }) => [
          styles.removeButton,
          pressed && styles.removeButtonPressed,
        ]}
      >
        <Ionicons name="close-circle" color={colors.muted} size={21} />
      </Pressable>
    </Pressable>
  );
});

type PlaylistScreenProps = {
  canGoNext: boolean;
  currentIndex: number;
  currentTime: number;
  duration: number;
  isBuffering: boolean;
  isPlaying: boolean;
  isShuffleEnabled: boolean;
  onBack: () => void;
  onClear: () => void;
  onCycleRepeat: () => void;
  onNext: () => void;
  onPlayTrack: (index: number) => void;
  onPrevious: () => void;
  onRemoveTrack: (index: number) => void;
  onOpenLibrary: () => void;
  onSeek: (seconds: number) => void;
  onTogglePlayback: () => void;
  onToggleShuffle: () => void;
  playerPosition: PlaylistPlayerPosition;
  queue: LocalTrack[];
  repeatMode: RepeatMode;
  showFileType: boolean;
  track: LocalTrack | null;
};

export function PlaylistScreen({
  canGoNext,
  currentIndex,
  currentTime,
  duration,
  isBuffering,
  isPlaying,
  isShuffleEnabled,
  onBack,
  onClear,
  onCycleRepeat,
  onNext,
  onPlayTrack,
  onPrevious,
  onRemoveTrack,
  onOpenLibrary,
  onSeek,
  onTogglePlayback,
  onToggleShuffle,
  playerPosition,
  queue,
  repeatMode,
  showFileType,
  track,
}: PlaylistScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const listExtraData = useMemo(
    () => ({ currentIndex, showFileType }),
    [currentIndex, showFileType],
  );
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to player"
          onPress={onBack}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.headerButtonPressed,
          ]}
        >
          <Ionicons name="chevron-back" color={colors.accent} size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Playlist</Text>
        <View style={styles.headerActions}>
          {queue.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear live queue"
              onPress={onClear}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.headerButtonPressed,
              ]}
            >
              <Ionicons name="trash-outline" color={colors.muted} size={21} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open music library"
            onPress={onOpenLibrary}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.headerButtonPressed,
            ]}
          >
            <Ionicons name="library-outline" color={colors.accent} size={22} />
          </Pressable>
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>PLAYING NEXT</Text>
        <Text style={styles.title}>Your live queue</Text>
        <Text style={styles.subtitle}>
          {queue.length
            ? `${queue.length} ${queue.length === 1 ? "song" : "songs"} queued`
            : "Add songs to build your queue."}
        </Text>
      </View>

      <View
        style={[
          styles.playlistBody,
          playerPosition === "top" && styles.playlistBodyPlayerTop,
        ]}
      >
      <FlatList
        contentContainerStyle={[
          styles.listContent,
          queue.length === 0 && styles.emptyListContent,
        ]}
        data={queue}
        extraData={listExtraData}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="musical-notes" color={colors.accent} size={32} />
            </View>
            <Text style={styles.emptyTitle}>Your queue is empty</Text>
            <Text style={styles.emptyText}>
              Choose music from your library to start a queue.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open music library"
              onPress={onOpenLibrary}
              style={({ pressed }) => [
                styles.openLibraryButton,
                pressed && styles.openLibraryButtonPressed,
              ]}
            >
              <Ionicons name="library-outline" color="#fff" size={18} />
              <Text style={styles.openLibraryText}>Open Library</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => (
          <QueueTrackRow
            index={index}
            isCurrent={index === currentIndex}
            onPlayTrack={onPlayTrack}
            onRemoveTrack={onRemoveTrack}
            showFileType={showFileType}
            track={item}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />

      <View style={styles.miniPlayer}>
        <Slider
          accessibilityLabel="Playback position"
          disabled={!track || duration <= 0}
          maximumTrackTintColor={colors.progressTrack}
          maximumValue={duration || 1}
          minimumTrackTintColor={colors.accent}
          minimumValue={0}
          onSlidingComplete={onSeek}
          step={0.1}
          style={styles.miniSlider}
          thumbTintColor={track ? colors.accent : colors.muted}
          value={track ? currentTime : 0}
        />
        <View style={styles.miniPlayerRow}>
          <View style={styles.miniArtwork}>
            <Ionicons name="musical-note" color="#fff" size={20} />
          </View>
          <View style={styles.miniTrackDetails}>
            <Text numberOfLines={1} style={styles.miniTrackName}>
              {track?.name ?? "No song selected"}
            </Text>
            <Text numberOfLines={1} style={styles.miniArtist}>
              {track?.artist ?? "Add music to begin"}
            </Text>
          </View>
        </View>
        <View style={styles.miniModeRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isShuffleEnabled ? "Turn shuffle off" : "Turn shuffle on"
            }
            accessibilityState={{ selected: isShuffleEnabled }}
            onPress={onToggleShuffle}
            style={({ pressed }) => [
              styles.miniModeButton,
              isShuffleEnabled && styles.miniModeButtonActive,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons
              name="shuffle"
              color={isShuffleEnabled ? colors.accent : colors.secondaryText}
              size={18}
            />
            <Text
              style={[
                styles.miniModeText,
                isShuffleEnabled && styles.miniModeTextActive,
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
            onPress={onCycleRepeat}
            style={({ pressed }) => [
              styles.miniModeButton,
              repeatMode !== "off" && styles.miniModeButtonActive,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons
              name="repeat"
              color={
                repeatMode !== "off" ? colors.accent : colors.secondaryText
              }
              size={18}
            />
            <Text
              style={[
                styles.miniModeText,
                repeatMode !== "off" && styles.miniModeTextActive,
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
        <View style={styles.miniControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous track"
            disabled={!track}
            onPress={onPrevious}
            style={({ pressed }) => [
              styles.miniControl,
              !track && styles.disabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="play-skip-back" color={colors.text} size={24} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back 5 seconds"
            disabled={!track}
            onPress={() => onSeek(Math.max(currentTime - 5, 0))}
            style={({ pressed }) => [
              styles.miniSeekControl,
              !track && styles.disabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons
              name="play-back"
              color={colors.secondaryText}
              size={20}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              track ? (isPlaying ? "Pause" : "Play") : "Open music library"
            }
            onPress={track ? onTogglePlayback : onOpenLibrary}
            style={({ pressed }) => [
              styles.miniPlayButton,
              pressed && styles.miniPlayButtonPressed,
            ]}
          >
            {isBuffering && track ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                color="#fff"
                size={22}
                style={!isPlaying && styles.playIcon}
              />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go forward 5 seconds"
            disabled={!track}
            onPress={() => onSeek(Math.min(currentTime + 5, duration))}
            style={({ pressed }) => [
              styles.miniSeekControl,
              !track && styles.disabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons
              name="play-forward"
              color={colors.secondaryText}
              size={20}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next track"
            disabled={!canGoNext}
            onPress={onNext}
            style={({ pressed }) => [
              styles.miniControl,
              !canGoNext && styles.disabled,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="play-skip-forward" color={colors.text} size={24} />
          </Pressable>
        </View>
      </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: {
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
    paddingHorizontal: 14,
  },
  headerButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
  },
  headerButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  titleBlock: {
    paddingBottom: 18,
    paddingHorizontal: 22,
    paddingTop: 26,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.8,
    marginTop: 5,
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: 14,
    marginTop: 4,
  },
  playlistBody: {
    flex: 1,
  },
  playlistBodyPlayerTop: {
    flexDirection: "column-reverse",
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  trackRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexDirection: "row",
    gap: 12,
    minHeight: 66,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  currentTrackRow: {
    backgroundColor: colors.accentSoft,
  },
  trackRowPressed: {
    opacity: 0.7,
  },
  trackNumber: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  currentTrackNumber: {
    backgroundColor: colors.accent,
  },
  trackNumberText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: "600",
  },
  trackDetails: {
    flex: 1,
  },
  trackName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  currentTrackText: {
    color: colors.accent,
  },
  artistName: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 3,
  },
  format: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "700",
  },
  sourceBadge: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 17,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  removeButtonPressed: {
    backgroundColor: colors.elevated,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingBottom: 30,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 34,
    height: 68,
    justifyContent: "center",
    width: 68,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginTop: 14,
  },
  emptyText: {
    color: colors.secondaryText,
    fontSize: 13,
    marginTop: 5,
  },
  openLibraryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 13,
    flexDirection: "row",
    gap: 6,
    height: 42,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  openLibraryButtonPressed: {
    backgroundColor: colors.accentPressed,
  },
  openLibraryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  miniPlayer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: 10,
    paddingHorizontal: 14,
  },
  miniSlider: {
    height: 24,
    marginHorizontal: -14,
  },
  miniPlayerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    paddingVertical: 3,
  },
  miniControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 15,
    justifyContent: "center",
    marginTop: 7,
  },
  miniArtwork: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 9,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  miniTrackDetails: {
    flex: 1,
    minWidth: 0,
  },
  miniTrackName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  miniArtist: {
    color: colors.secondaryText,
    fontSize: 11,
    marginTop: 2,
  },
  miniModeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 5,
  },
  miniModeButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
  },
  miniModeButtonActive: {
    backgroundColor: colors.accentSoft,
  },
  miniModeText: {
    color: colors.secondaryText,
    fontSize: 11,
    fontWeight: "600",
  },
  miniModeTextActive: {
    color: colors.accent,
  },
  miniControl: {
    alignItems: "center",
    backgroundColor: colors.playbackControlBackground,
    borderColor: colors.playbackControlBorder,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  miniSeekControl: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderColor: colors.playbackControlBorder,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  miniPlayButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  miniPlayButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.95 }],
  },
  controlPressed: {
    backgroundColor: colors.elevated,
  },
  disabled: {
    opacity: 0.25,
  },
  playIcon: {
    marginLeft: 2,
  },
});
