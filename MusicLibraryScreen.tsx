import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { MetadataEditorModal } from "./MetadataEditorModal";
import { TrackArtwork } from "./TrackArtwork";
import type { EditableTrackMetadata, LocalTrack } from "./useLocalAudioPlayer";
import { type ThemeColors, useTheme } from "./theme";

function splitArtistNames(artist: string) {
  const names = artist
    .split(/\s*;\s*|\s+\/\s+|\s+\b(?:feat(?:uring)?\.?|ft\.?)\s+/i)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? [...new Set(names)] : ["Unknown Artist"];
}

function displayMetadata(value: string | number | undefined, fallback: string) {
  return value === undefined || value === "" ? fallback : String(value);
}

type SortDirection = "ascending" | "descending";
type LibraryView = "songs" | "artists" | "genres";
type LibraryListItem =
  | { key: string; type: "group"; label: string; count: number }
  | { key: string; type: "track"; track: LocalTrack };
type SortField =
  | "name"
  | "artist"
  | "album"
  | "albumArtist"
  | "genre"
  | "year"
  | "track"
  | "extension";

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "name", label: "Title" },
  { field: "artist", label: "Artist" },
  { field: "album", label: "Album" },
  { field: "albumArtist", label: "Album Artist" },
  { field: "genre", label: "Genre" },
  { field: "year", label: "Year" },
  { field: "track", label: "Track Number" },
  { field: "extension", label: "Format" },
];

function compareTracks(
  left: LocalTrack,
  right: LocalTrack,
  field: SortField,
  direction: SortDirection,
) {
  const leftValue = left[field];
  const rightValue = right[field];
  const leftMissing = leftValue === undefined || leftValue === "";
  const rightMissing = rightValue === undefined || rightValue === "";

  if (leftMissing !== rightMissing) {
    return leftMissing ? 1 : -1;
  }

  let result = 0;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    result = leftValue - rightValue;
  } else {
    result = String(leftValue ?? "").localeCompare(
      String(rightValue ?? ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  }

  if (result === 0 && field !== "name") {
    result = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  return direction === "ascending" ? result : -result;
}

type MusicLibraryScreenProps = {
  hasRemoteConnection: boolean;
  library: LocalTrack[];
  onAddAll: (tracks: LocalTrack[]) => number;
  onAddTrack: (track: LocalTrack) => number;
  onBack: () => void;
  onOpenPlaylists: () => void;
  onRemoveTrack: (uri: string) => void;
  onScan: () => void;
  onSyncRemote: () => Promise<number>;
  onUpdateMetadata: (
    uri: string,
    metadata: EditableTrackMetadata,
  ) => Promise<LocalTrack>;
  queuedIds: Set<string>;
  remoteError: string | null;
  remoteStatus: "disconnected" | "connecting" | "connected" | "syncing" | "error";
  remoteToken: string | null;
  showFileType: boolean;
};

export function MusicLibraryScreen({
  hasRemoteConnection,
  library,
  onAddAll,
  onAddTrack,
  onBack,
  onOpenPlaylists,
  onRemoveTrack,
  onScan,
  onSyncRemote,
  onUpdateMetadata,
  queuedIds,
  remoteError,
  remoteStatus,
  remoteToken,
  showFileType,
}: MusicLibraryScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [searchQuery, setSearchQuery] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("songs");
  const [isAdvancedView, setIsAdvancedView] = useState(false);
  const [editingTrack, setEditingTrack] = useState<LocalTrack | null>(null);
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("ascending");
  const [sortField, setSortField] = useState<SortField>("name");
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "remote">(
    "all",
  );
  const listExtraData = useMemo(
    () => ({ isAdvancedView, libraryView, queuedIds, showFileType }),
    [isAdvancedView, libraryView, queuedIds, showFileType],
  );
  const sortLabel =
    SORT_OPTIONS.find((option) => option.field === sortField)?.label ?? "Title";
  const filteredLibrary = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    const sourceTracks =
      sourceFilter === "all"
        ? library
        : library.filter((track) => track.source === sourceFilter);
    const matchingTracks = query
      ? sourceTracks.filter((track) =>
          [
            track.name,
            track.artist,
            track.albumArtist,
            track.album,
            track.genre,
            track.year,
            track.extension,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
        )
      : sourceTracks;

    return [...matchingTracks].sort((left, right) =>
      compareTracks(left, right, sortField, sortDirection),
    );
  }, [library, searchQuery, sortDirection, sortField, sourceFilter]);
  const libraryItems = useMemo<LibraryListItem[]>(() => {
    if (libraryView === "songs") {
      return filteredLibrary.map((track) => ({
        key: `track:${track.id}`,
        track,
        type: "track",
      }));
    }

    const groups = new Map<string, LocalTrack[]>();
    filteredLibrary.forEach((track) => {
      const label =
        libraryView === "artists"
          ? track.artist.trim() || "Unknown Artist"
          : track.genre?.trim() || "Unknown Genre";
      groups.set(label, [...(groups.get(label) ?? []), track]);
    });

    const direction = sortDirection === "ascending" ? 1 : -1;
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right) * direction)
      .flatMap(([label, tracks]) => [
        {
          count: tracks.length,
          key: `group:${libraryView}:${label}`,
          label,
          type: "group" as const,
        },
        ...tracks
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name, undefined, {
                numeric: true,
                sensitivity: "base",
              }) * direction,
          )
          .map((track) => ({
            key: `track:${track.id}`,
            track,
            type: "track" as const,
          })),
      ]);
  }, [filteredLibrary, libraryView, sortDirection]);

  return (
    <View style={styles.screen}>
      {editingTrack && (
        <MetadataEditorModal
          key={editingTrack.uri}
          onClose={() => setEditingTrack(null)}
          onSave={onUpdateMetadata}
          track={editingTrack}
        />
      )}
      <Modal
        animationType="fade"
        onRequestClose={() => setShowSortPicker(false)}
        transparent
        visible={showSortPicker}
      >
        <Pressable
          accessibilityLabel="Close sorting options"
          onPress={() => setShowSortPicker(false)}
          style={styles.modalBackdrop}
        >
          <View style={styles.sortSheet}>
            <Text style={styles.sortSheetTitle}>Sort library by</Text>
            {SORT_OPTIONS.filter(
              (option) => showFileType || option.field !== "extension",
            ).map((option) => {
              const isSelected = option.field === sortField;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={option.field}
                  onPress={() => {
                    setSortField(option.field);
                    setShowSortPicker(false);
                  }}
                  style={({ pressed }) => [
                    styles.sortOption,
                    isSelected && styles.sortOptionSelected,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.sortOptionText,
                      isSelected && styles.sortOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  {isSelected && (
                    <Ionicons
                      color={colors.accent}
                      name="checkmark"
                      size={20}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to player"
          onPress={onBack}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons name="chevron-back" color={colors.accent} size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Library</Text>
        <View style={styles.headerActions}>
          {hasRemoteConnection && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sync PC library"
              onPress={() =>
                void onSyncRemote().catch((error) =>
                  Alert.alert(
                    "Sync failed",
                    error instanceof Error
                      ? error.message
                      : "The PC could not be reached.",
                  ),
                )
              }
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="sync-outline" color={colors.accent} size={22} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open saved playlists"
            onPress={onOpenPlaylists}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="albums-outline" color={colors.accent} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan folders for audio"
            onPress={onScan}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons
              name="folder-open-outline"
              color={colors.accent}
              size={23}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Music Library</Text>
          <Text style={styles.subtitle}>
            {library.length
              ? `${library.length} ${library.length === 1 ? "track" : "tracks"} found`
              : "Scan this device or connect a PC."}
          </Text>
        </View>
        {library.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add all ${filteredLibrary.length} displayed tracks to queue`}
            disabled={filteredLibrary.length === 0}
            onPress={() => onAddAll(filteredLibrary)}
            style={({ pressed }) => [
              styles.addAllButton,
              pressed && styles.addAllButtonPressed,
              filteredLibrary.length === 0 && styles.disabled,
            ]}
          >
            <Ionicons name="add" color={colors.accent} size={18} />
            <Text style={styles.addAllText}>
              Add All ({filteredLibrary.length})
            </Text>
          </Pressable>
        )}
      </View>

      {hasRemoteConnection && (
        <View
          accessibilityRole={remoteStatus === "syncing" ? "progressbar" : "text"}
          style={[
            styles.remoteStatusCard,
            remoteStatus === "error" && styles.remoteStatusCardError,
          ]}
        >
          {remoteStatus === "syncing" || remoteStatus === "connecting" ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Ionicons
              name={
                remoteStatus === "error"
                  ? "cloud-offline-outline"
                  : "cloud-done-outline"
              }
              color={remoteStatus === "error" ? "#d92d20" : "#22a447"}
              size={19}
            />
          )}
          <View style={styles.remoteStatusText}>
            <Text style={styles.remoteStatusTitle}>
              {remoteStatus === "syncing"
                ? "Syncing PC library"
                : remoteStatus === "connecting"
                  ? "Connecting to PC"
                  : remoteStatus === "error"
                    ? "PC library offline"
                    : "PC library synced"}
            </Text>
            <Text numberOfLines={1} style={styles.remoteStatusDescription}>
              {remoteStatus === "error"
                ? remoteError || "Showing the last synced library."
                : remoteStatus === "connected"
                  ? "Remote songs are up to date."
                  : "Your saved library remains available while this finishes."}
            </Text>
          </View>
          {remoteStatus === "error" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry PC library sync"
              onPress={() => void onSyncRemote().catch(() => undefined)}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="refresh" color={colors.accent} size={16} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}

      {library.length > 0 && (
        <View style={styles.libraryToolbar}>
          <View style={styles.toolbarTopRow}>
            <View style={styles.searchContainer}>
              <Ionicons name="search" color={colors.secondaryText} size={18} />
              <TextInput
                accessibilityLabel="Search music library"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setSearchQuery}
                placeholder="Search title, artist, album, genre or year"
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={styles.searchInput}
                value={searchQuery}
              />
              {!!searchQuery && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                  onPress={() => setSearchQuery("")}
                >
                  <Ionicons
                    name="close-circle"
                    color={colors.muted}
                    size={19}
                  />
                </Pressable>
              )}
            </View>
            <Pressable
              accessibilityLabel={
                isAdvancedView
                  ? "Switch to simplified library view"
                  : "Switch to advanced library view"
              }
              accessibilityRole="switch"
              accessibilityState={{ checked: isAdvancedView }}
              onPress={() => setIsAdvancedView((advanced) => !advanced)}
              style={({ pressed }) => [
                styles.viewToggle,
                isAdvancedView && styles.viewToggleActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons
                color={isAdvancedView ? "#fff" : colors.accent}
                name={isAdvancedView ? "list" : "options-outline"}
                size={17}
              />
              <Text
                style={[
                  styles.viewToggleText,
                  isAdvancedView && styles.viewToggleTextActive,
                ]}
              >
                {isAdvancedView ? "Simple" : "Advanced"}
              </Text>
            </Pressable>
          </View>
          <View accessibilityRole="radiogroup" style={styles.viewFilters}>
            {(
              [
                ["songs", "Songs"],
                ["artists", "Artists"],
                ["genres", "Genres"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: libraryView === value }}
                key={value}
                onPress={() => setLibraryView(value)}
                style={[
                  styles.viewFilter,
                  libraryView === value && styles.viewFilterActive,
                ]}
              >
                <Text
                  style={[
                    styles.viewFilterText,
                    libraryView === value && styles.viewFilterTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sortRow}>
            <Text style={styles.sortByLabel}>
              {libraryView === "songs" ? "SORT BY" : "GROUP ORDER"}
            </Text>
            {libraryView === "songs" && (
              <Pressable
                accessibilityLabel={`Sort library by ${sortLabel}`}
                accessibilityRole="button"
                onPress={() => setShowSortPicker(true)}
                style={({ pressed }) => [
                  styles.sortFieldButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="funnel-outline" color={colors.accent} size={15} />
                <Text style={styles.sortFieldText}>{sortLabel}</Text>
                <Ionicons
                  name="chevron-down"
                  color={colors.secondaryText}
                  size={15}
                />
              </Pressable>
            )}
            <Pressable
              accessibilityLabel={`Sort ${sortDirection === "ascending" ? "descending" : "ascending"}`}
              accessibilityRole="button"
              onPress={() =>
                setSortDirection((current) =>
                  current === "ascending" ? "descending" : "ascending",
                )
              }
              style={({ pressed }) => [
                styles.sortDirectionButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons
                name={
                  sortDirection === "ascending"
                    ? "arrow-up-outline"
                    : "arrow-down-outline"
                }
                color={colors.accent}
                size={17}
              />
              <Text style={styles.sortDirectionText}>
                {sortDirection === "ascending" ? "Ascending" : "Descending"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.sourceFilters}>
            {(["all", "local", "remote"] as const).map((source) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: sourceFilter === source }}
                key={source}
                onPress={() => setSourceFilter(source)}
                style={[
                  styles.sourceFilter,
                  sourceFilter === source && styles.sourceFilterActive,
                ]}
              >
                <Text
                  style={[
                    styles.sourceFilterText,
                    sourceFilter === source && styles.sourceFilterTextActive,
                  ]}
                >
                  {source === "all" ? "All" : source === "local" ? "Device" : "PC"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          filteredLibrary.length === 0 && styles.emptyList,
        ]}
        data={libraryItems}
        extraData={listExtraData}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={
          isAdvancedView &&
          libraryView === "songs" &&
          filteredLibrary.length > 0 ? (
            <View style={styles.advancedListHeader}>
              <Text style={styles.advancedListHeaderText}>SONG & ARTISTS</Text>
              <Text style={styles.advancedListHeaderText}>METADATA</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          library.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name="library-outline"
                  color={colors.accent}
                  size={34}
                />
              </View>
              <Text style={styles.emptyTitle}>No music found yet</Text>
              <Text style={styles.emptyText}>
                Choose which device folders to scan and your audio collection
                will appear here.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onScan}
                style={({ pressed }) => [
                  styles.scanButton,
                  pressed && styles.scanButtonPressed,
                ]}
              >
                <Ionicons name="search" color="#fff" size={19} />
                <Text style={styles.scanButtonText}>Scan Device</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" color={colors.muted} size={38} />
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                Try searching for another song or artist.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSearchQuery("")}
                style={styles.clearSearchButton}
              >
                <Text style={styles.clearSearchText}>Clear Search</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item: listItem }) => {
          if (listItem.type === "group") {
            return (
              <View style={styles.groupHeader}>
                <Text numberOfLines={1} style={styles.groupHeaderTitle}>
                  {listItem.label}
                </Text>
                <Text style={styles.groupHeaderCount}>
                  {listItem.count} {listItem.count === 1 ? "song" : "songs"}
                </Text>
              </View>
            );
          }
          const item = listItem.track;
          const isQueued = queuedIds.has(item.id);
          const sourceBadge =
            item.source === "local"
              ? "DEVICE"
              : remoteStatus === "syncing"
                ? "SYNCING"
                : remoteStatus === "error"
                  ? "STALE"
                  : "PC";
          if (isAdvancedView) {
            const artists = splitArtistNames(item.artist);
            return (
              <Pressable
                accessibilityHint="Press and hold to edit file metadata"
                accessibilityLabel={`${item.name} by ${item.artist}`}
                delayLongPress={450}
                onLongPress={() => setEditingTrack(item)}
                style={({ pressed }) => [
                  styles.advancedTrackRow,
                  pressed && styles.trackRowPressed,
                ]}
              >
                <View style={styles.advancedTitleRow}>
                  <TrackArtwork
                    borderRadius={7}
                    remoteToken={remoteToken}
                    size={30}
                    track={item}
                  />
                  <Text numberOfLines={1} style={styles.advancedTrackName}>
                    {item.name}
                  </Text>
                  {showFileType && (
                    <Text style={styles.advancedFormat}>{item.extension}</Text>
                  )}
                  <Text style={styles.sourceBadge}>
                    {sourceBadge}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isQueued
                        ? `${item.name} is already queued`
                        : `Add ${item.name} to playlist`
                    }
                    disabled={isQueued}
                    onPress={() => onAddTrack(item)}
                    style={({ pressed }) => [
                      styles.compactRowButton,
                      isQueued && styles.queuedButton,
                      pressed && !isQueued && styles.buttonPressed,
                    ]}
                  >
                    <Ionicons
                      name={isQueued ? "checkmark" : "add"}
                      color={isQueued ? "#34c759" : colors.accent}
                      size={18}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name} from library`}
                    onPress={() => onRemoveTrack(item.id)}
                    style={({ pressed }) => [
                      styles.compactRowButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Ionicons name="close" color={colors.muted} size={17} />
                  </Pressable>
                </View>

                <View
                  accessibilityLabel={`Artists: ${artists.join(", ")}`}
                  style={styles.artistChips}
                >
                  {artists.map((artist) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by artist ${artist}`}
                      key={artist}
                      onPress={() => setSearchQuery(artist)}
                      style={({ pressed }) => [
                        styles.artistChip,
                        pressed && styles.artistChipPressed,
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.artistChipText}>
                        {artist}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text numberOfLines={2} style={styles.metadataLine}>
                  <Text style={styles.metadataLabel}>ALBUM ARTIST </Text>
                  {displayMetadata(item.albumArtist, "Unknown")}
                  <Text style={styles.metadataSeparator}> · </Text>
                  <Text style={styles.metadataLabel}>ALBUM </Text>
                  {displayMetadata(item.album, "Unknown")}
                  <Text style={styles.metadataSeparator}> · </Text>
                  <Text style={styles.metadataLabel}>GENRE </Text>
                  {displayMetadata(item.genre, "Unknown")}
                  <Text style={styles.metadataSeparator}> · </Text>
                  <Text style={styles.metadataLabel}>YEAR </Text>
                  {displayMetadata(item.year, "—")}
                </Text>
              </Pressable>
            );
          }

          return (
            <Pressable
              accessibilityHint="Press and hold to edit file metadata"
              accessibilityLabel={`${item.name} by ${item.artist}`}
              delayLongPress={450}
              onLongPress={() => setEditingTrack(item)}
              style={({ pressed }) => [
                styles.trackRow,
                pressed && styles.trackRowPressed,
              ]}
            >
              <TrackArtwork remoteToken={remoteToken} track={item} />
              <View style={styles.trackDetails}>
                <Text numberOfLines={1} style={styles.trackName}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.artistName}>
                  {item.artist}
                  {item.album ? ` • ${item.album}` : ""}
                </Text>
              </View>
              {showFileType && (
                <Text style={styles.format}>{item.extension}</Text>
              )}
              <Text style={styles.sourceBadge}>
                {sourceBadge}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isQueued
                    ? `${item.name} is already queued`
                    : `Add ${item.name} to playlist`
                }
                disabled={isQueued}
                onPress={() => onAddTrack(item)}
                style={({ pressed }) => [
                  styles.rowButton,
                  isQueued && styles.queuedButton,
                  pressed && !isQueued && styles.buttonPressed,
                ]}
              >
                <Ionicons
                  name={isQueued ? "checkmark" : "add"}
                  color={isQueued ? "#34c759" : colors.accent}
                  size={21}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name} from library`}
                onPress={() => onRemoveTrack(item.id)}
                style={({ pressed }) => [
                  styles.rowButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="close-circle" color={colors.muted} size={21} />
              </Pressable>
            </Pressable>
          );
        }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      backgroundColor: colors.background,
      flex: 1,
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
    buttonPressed: {
      backgroundColor: colors.elevated,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    titleRow: {
      alignItems: "flex-end",
      flexDirection: "row",
      justifyContent: "space-between",
      padding: 22,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.1,
    },
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: -0.7,
      marginTop: 4,
    },
    subtitle: {
      color: colors.secondaryText,
      fontSize: 12,
      marginTop: 3,
    },
    addAllButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 16,
      flexDirection: "row",
      gap: 2,
      height: 34,
      paddingHorizontal: 10,
    },
    addAllButtonPressed: {
      backgroundColor: colors.accentSoft,
    },
    disabled: {
      opacity: 0.45,
    },
    addAllText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "700",
    },
    searchContainer: {
      alignItems: "center",
      backgroundColor: colors.elevated,
      borderRadius: 12,
      flex: 1,
      flexDirection: "row",
      gap: 7,
      height: 42,
      paddingHorizontal: 11,
    },
    libraryToolbar: {
      gap: 8,
      marginBottom: 12,
      marginHorizontal: 14,
    },
    remoteStatusCard: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 9,
      marginBottom: 12,
      marginHorizontal: 14,
      paddingHorizontal: 11,
      paddingVertical: 9,
    },
    remoteStatusCardError: {
      borderColor: "#d92d2066",
    },
    remoteStatusText: {
      flex: 1,
      minWidth: 0,
    },
    remoteStatusTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    remoteStatusDescription: {
      color: colors.secondaryText,
      fontSize: 10,
      marginTop: 2,
    },
    retryButton: {
      alignItems: "center",
      backgroundColor: colors.accentSoft,
      borderRadius: 10,
      flexDirection: "row",
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 7,
    },
    retryButtonText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    toolbarTopRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    viewFilters: {
      backgroundColor: colors.elevated,
      borderRadius: 12,
      flexDirection: "row",
      padding: 3,
    },
    viewFilter: {
      alignItems: "center",
      borderRadius: 9,
      flex: 1,
      paddingVertical: 7,
    },
    viewFilterActive: {
      backgroundColor: colors.surface,
    },
    viewFilterText: {
      color: colors.secondaryText,
      fontSize: 11,
      fontWeight: "700",
    },
    viewFilterTextActive: {
      color: colors.accent,
    },
    sortRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
    },
    sourceFilters: {
      flexDirection: "row",
      gap: 7,
    },
    sourceFilter: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 13,
      paddingVertical: 7,
    },
    sourceFilterActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    sourceFilterText: {
      color: colors.secondaryText,
      fontSize: 11,
      fontWeight: "700",
    },
    sourceFilterTextActive: {
      color: "#fff",
    },
    sortByLabel: {
      color: colors.secondaryText,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 0.6,
    },
    sortFieldButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      flexDirection: "row",
      gap: 6,
      height: 36,
      paddingHorizontal: 10,
    },
    sortFieldText: {
      color: colors.text,
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
    },
    sortDirectionButton: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 4,
      height: 36,
      paddingHorizontal: 9,
    },
    sortDirectionText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    modalBackdrop: {
      backgroundColor: "rgba(0,0,0,0.42)",
      flex: 1,
      justifyContent: "flex-end",
    },
    sortSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingBottom: 24,
      paddingHorizontal: 14,
      paddingTop: 18,
    },
    sortSheetTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
      marginBottom: 10,
      paddingHorizontal: 8,
    },
    sortOption: {
      alignItems: "center",
      borderRadius: 11,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 43,
      paddingHorizontal: 11,
    },
    sortOptionSelected: {
      backgroundColor: colors.accentSoft,
    },
    sortOptionText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
    sortOptionTextSelected: {
      color: colors.accent,
      fontWeight: "700",
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
      height: "100%",
      paddingVertical: 0,
    },
    listContent: {
      gap: 8,
      paddingBottom: 20,
      paddingHorizontal: 14,
    },
    groupHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 6,
      paddingTop: 10,
    },
    groupHeaderTitle: {
      color: colors.text,
      flex: 1,
      fontSize: 17,
      fontWeight: "700",
    },
    groupHeaderCount: {
      color: colors.secondaryText,
      fontSize: 10,
      fontWeight: "600",
    },
    emptyList: {
      flex: 1,
    },
    emptyState: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
      paddingBottom: 50,
      paddingHorizontal: 30,
    },
    emptyIcon: {
      alignItems: "center",
      backgroundColor: colors.accentSoft,
      borderRadius: 36,
      height: 72,
      justifyContent: "center",
      width: 72,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
      marginTop: 14,
    },
    emptyText: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 5,
      maxWidth: 280,
      textAlign: "center",
    },
    clearSearchButton: {
      backgroundColor: colors.accentSoft,
      borderRadius: 15,
      marginTop: 14,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    clearSearchText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: "700",
    },
    scanButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 13,
      flexDirection: "row",
      gap: 6,
      height: 44,
      marginTop: 18,
      paddingHorizontal: 18,
    },
    scanButtonPressed: {
      backgroundColor: colors.accentPressed,
    },
    scanButtonText: {
      color: "#fff",
      fontSize: 14,
      fontWeight: "700",
    },
    trackRow: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: 14,
      flexDirection: "row",
      gap: 9,
      minHeight: 64,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    trackRowPressed: {
      opacity: 0.72,
    },
    artwork: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 9,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
    trackDetails: {
      flex: 1,
      minWidth: 0,
    },
    trackName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    artistName: {
      color: colors.secondaryText,
      fontSize: 11,
      marginTop: 3,
    },
    format: {
      color: colors.muted,
      fontSize: 9,
      fontWeight: "700",
    },
    sourceBadge: {
      color: colors.accent,
      fontSize: 8,
      fontWeight: "800",
      letterSpacing: 0.4,
    },
    rowButton: {
      alignItems: "center",
      borderRadius: 17,
      height: 34,
      justifyContent: "center",
      width: 34,
    },
    queuedButton: {
      backgroundColor: "#effaf1",
    },
    viewToggle: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 4,
      height: 42,
      justifyContent: "center",
      paddingHorizontal: 10,
    },
    viewToggleActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    viewToggleText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: "700",
    },
    viewToggleTextActive: {
      color: "#fff",
    },
    advancedListHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    advancedListHeaderText: {
      color: colors.secondaryText,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 0.7,
    },
    advancedTrackRow: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    advancedTitleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
    },
    advancedTrackName: {
      color: colors.text,
      flex: 1,
      fontSize: 13,
      fontWeight: "700",
      minWidth: 0,
    },
    advancedFormat: {
      color: colors.secondaryText,
      fontSize: 8,
      fontWeight: "700",
      letterSpacing: 0.4,
      marginHorizontal: 3,
    },
    compactRowButton: {
      alignItems: "center",
      borderRadius: 14,
      height: 28,
      justifyContent: "center",
      width: 28,
    },
    artistChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      marginTop: 3,
    },
    artistChip: {
      backgroundColor: colors.accentSoft,
      borderRadius: 8,
      maxWidth: "100%",
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    artistChipPressed: {
      backgroundColor: colors.accentSoft,
    },
    artistChipText: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: "600",
    },
    metadataLine: {
      color: colors.secondaryText,
      fontSize: 9,
      lineHeight: 13,
      marginTop: 5,
    },
    metadataLabel: {
      color: colors.secondaryText,
      fontSize: 8,
      fontWeight: "700",
      letterSpacing: 0.25,
    },
    metadataSeparator: {
      color: colors.muted,
    },
  });
