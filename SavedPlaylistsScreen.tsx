import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LocalTrack, SavedPlaylist } from './useLocalAudioPlayer';
import { type ThemeColors, useTheme } from './theme';
import { TrackArtwork } from './TrackArtwork';

type SavedPlaylistsScreenProps = {
  library: LocalTrack[];
  onAddPlaylistToQueue: (playlistId: string) => number;
  onAddTrack: (playlistId: string, trackId: string) => void;
  onAddTracks: (playlistId: string, trackIds: string[]) => void;
  onBack: () => void;
  onChooseArtwork: (playlistId: string) => Promise<void>;
  onCreate: (name: string) => string | null;
  onDelete: (playlistId: string) => void;
  onOpenLibrary: () => void;
  onPlayPlaylist: (playlistId: string, shuffle?: boolean) => void;
  onMoveTrack: (
    playlistId: string,
    trackId: string,
    direction: -1 | 1
  ) => void;
  onRemoveTrack: (playlistId: string, trackId: string) => void;
  onRemoveArtwork: (playlistId: string) => void;
  onRename: (playlistId: string, name: string) => boolean;
  playlists: SavedPlaylist[];
  remoteStatus: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  remoteToken: string | null;
};

export function SavedPlaylistsScreen({
  library,
  onAddPlaylistToQueue,
  onAddTrack,
  onAddTracks,
  onBack,
  onChooseArtwork,
  onCreate,
  onDelete,
  onOpenLibrary,
  onPlayPlaylist,
  onMoveTrack,
  onRemoveTrack,
  onRemoveArtwork,
  onRename,
  playlists,
  remoteStatus,
  remoteToken,
}: SavedPlaylistsScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [configPlaylistId, setConfigPlaylistId] = useState<string | null>(null);
  const [isTrackPickerOpen, setIsTrackPickerOpen] = useState(false);
  const [trackSearchQuery, setTrackSearchQuery] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [nameError, setNameError] = useState('');
  const longPressedPlaylistId = useRef<string | null>(null);

  const selectedPlaylist = playlists.find(
    (playlist) => playlist.id === selectedPlaylistId
  );
  const configPlaylist = playlists.find(
    (playlist) => playlist.id === configPlaylistId
  );
  const libraryById = useMemo(
    () => new Map(library.map((track) => [track.id, track])),
    [library]
  );
  const selectedTracks = useMemo(
    () => {
      if (!selectedPlaylist) {
        return [];
      }
      const refsById = new Map(
        selectedPlaylist.trackRefs.map((track) => [track.id, track])
      );
      return selectedPlaylist.trackIds
        .map((id) => libraryById.get(id) ?? refsById.get(id))
        .filter((track): track is LocalTrack => Boolean(track));
    },
    [libraryById, selectedPlaylist]
  );
  const selectedTrackIds = useMemo(
    () => new Set(selectedPlaylist?.trackIds ?? []),
    [selectedPlaylist]
  );
  const filteredPickerTracks = useMemo(() => {
    const query = trackSearchQuery.trim().toLocaleLowerCase();
    if (!query) {
      return library;
    }
    return library.filter((track) =>
      [
        track.name,
        track.artist,
        track.albumArtist,
        track.album,
        track.genre,
        track.year,
        track.extension,
      ]
        .filter((value) => value !== undefined && value !== '')
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [library, trackSearchQuery]);
  const filteredTracksToAdd = useMemo(
    () =>
      selectedPlaylist
        ? filteredPickerTracks.filter((track) => !selectedTrackIds.has(track.id))
        : [],
    [filteredPickerTracks, selectedPlaylist, selectedTrackIds]
  );

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setPlaylistName('');
    setNameError('');
  };

  const createPlaylist = () => {
    const id = onCreate(playlistName);
    if (!id) {
      setNameError(
        playlistName.trim()
          ? 'A playlist with this name already exists.'
          : 'Enter a playlist name.'
      );
      return;
    }
    closeCreateModal();
    setSelectedPlaylistId(id);
  };

  const openPlaylistConfig = (playlist: SavedPlaylist) => {
    setConfigPlaylistId(playlist.id);
    setPlaylistName(playlist.name);
    setNameError('');
  };

  const closePlaylistConfig = () => {
    longPressedPlaylistId.current = null;
    setConfigPlaylistId(null);
    setPlaylistName('');
    setNameError('');
  };

  const savePlaylistConfig = () => {
    if (!configPlaylist || !onRename(configPlaylist.id, playlistName)) {
      setNameError(
        playlistName.trim()
          ? 'A playlist with this name already exists.'
          : 'Enter a playlist name.'
      );
      return;
    }
    closePlaylistConfig();
  };

  const closeTrackPicker = () => {
    setIsTrackPickerOpen(false);
    setTrackSearchQuery('');
  };

  const addAllFilteredTracks = () => {
    if (!selectedPlaylist) {
      return;
    }
    onAddTracks(
      selectedPlaylist.id,
      filteredTracksToAdd.map((track) => track.id)
    );
  };

  const handleBack = useCallback(() => {
    if (selectedPlaylist) {
      setSelectedPlaylistId(null);
    } else {
      onBack();
    }
  }, [onBack, selectedPlaylist]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleBack();
        return true;
      }
    );

    return () => subscription.remove();
  }, [handleBack]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedPlaylist ? 'Back to playlists' : 'Back to player'}
          onPress={handleBack}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons name="chevron-back" color={colors.accent} size={24} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {selectedPlaylist ? '' : 'Playlists'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            selectedPlaylist ? 'Playlist settings' : 'Create playlist'
          }
          onPress={() =>
            selectedPlaylist
              ? openPlaylistConfig(selectedPlaylist)
              : setIsCreateOpen(true)
          }
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons
            name={selectedPlaylist ? 'ellipsis-vertical' : 'add'}
            color={colors.accent}
            size={26}
          />
        </Pressable>
      </View>

      {selectedPlaylist ? (
        <>
          <View style={styles.detailHero}>
            <Pressable
              accessibilityLabel={
                selectedPlaylist.artwork
                  ? 'Change playlist image'
                  : 'Add playlist image'
              }
              onPress={() => void onChooseArtwork(selectedPlaylist.id)}
              style={({ pressed }) => [
                styles.playlistArtwork,
                pressed && styles.playlistRowPressed,
              ]}
            >
              {selectedPlaylist.artwork ? (
                <Image
                  accessibilityLabel={`Cover for ${selectedPlaylist.name}`}
                  source={{ uri: selectedPlaylist.artwork }}
                  style={styles.playlistArtworkImage}
                />
              ) : (
                <Ionicons name="image-outline" color="#fff" size={46} />
              )}
              <View style={styles.artworkEditBadge}>
                <Ionicons name="camera" color="#fff" size={15} />
              </View>
            </Pressable>
            <Text numberOfLines={2} style={styles.detailTitle}>
              {selectedPlaylist.name}
            </Text>
            <Text style={styles.detailCount}>
              {selectedTracks.length}{' '}
              {selectedTracks.length === 1 ? 'song' : 'songs'}
            </Text>
            <View style={styles.detailActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Shuffle ${selectedPlaylist.name}`}
                disabled={selectedTracks.length === 0}
                onPress={() => onPlayPlaylist(selectedPlaylist.id, true)}
                style={({ pressed }) => [
                  styles.heroActionButton,
                  selectedTracks.length === 0 && styles.disabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="shuffle" color={colors.text} size={17} />
                <Text style={styles.heroActionText}>Shuffle</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Play ${selectedPlaylist.name}`}
                disabled={selectedTracks.length === 0}
                onPress={() => onPlayPlaylist(selectedPlaylist.id)}
                style={({ pressed }) => [
                  styles.heroActionButton,
                  selectedTracks.length === 0 && styles.disabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="play" color={colors.text} size={17} />
                <Text style={styles.heroActionText}>Play</Text>
              </Pressable>
            </View>
            <View style={styles.detailSecondaryActions}>
              <Pressable
                onPress={() => setIsTrackPickerOpen(true)}
                style={styles.detailTextButton}
              >
                <Ionicons name="add" color={colors.accent} size={18} />
                <Text style={styles.detailTextButtonLabel}>Add songs</Text>
              </Pressable>
              <Pressable
                disabled={selectedTracks.length === 0}
                onPress={() => onAddPlaylistToQueue(selectedPlaylist.id)}
                style={styles.detailTextButton}
              >
                <Ionicons name="list" color={colors.accent} size={17} />
                <Text style={styles.detailTextButtonLabel}>Add to queue</Text>
              </Pressable>
            </View>
          </View>

          <FlatList
            contentContainerStyle={[
              styles.trackList,
              selectedTracks.length === 0 && styles.emptyList,
            ]}
            data={selectedTracks}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No songs in this playlist</Text>
                <Text style={styles.emptyText}>
                  Add songs from your device library.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsTrackPickerOpen(true)}
                  style={({ pressed }) => [
                    styles.emptyAction,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.emptyActionText}>Choose Songs</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item, index }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name} by ${item.artist}`}
                accessibilityHint="Long press to move this song"
                delayLongPress={400}
                onLongPress={() =>
                  Alert.alert(
                    'Move song',
                    `Choose a new position for “${item.name}”.`,
                    [
                      ...(index > 0
                        ? [
                            {
                              text: 'Move up',
                              onPress: () =>
                                onMoveTrack(selectedPlaylist.id, item.id, -1),
                            },
                          ]
                        : []),
                      ...(index < selectedTracks.length - 1
                        ? [
                            {
                              text: 'Move down',
                              onPress: () =>
                                onMoveTrack(selectedPlaylist.id, item.id, 1),
                            },
                          ]
                        : []),
                      { text: 'Cancel', style: 'cancel' as const },
                    ]
                  )
                }
                style={({ pressed }) => [
                  styles.trackRow,
                  pressed && styles.playlistRowPressed,
                ]}
              >
                <TrackArtwork
                  borderRadius={8}
                  remoteToken={remoteToken}
                  size={40}
                  track={item}
                />
                <View style={styles.trackDetails}>
                  <Text numberOfLines={1} style={styles.trackName}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.artistName}>
                    {item.artist}
                  </Text>
                </View>
                {item.isAvailable === false && (
                  <Text style={styles.unavailableBadge}>
                    {item.source === 'remote' ? 'OFFLINE' : 'MISSING'}
                  </Text>
                )}
                {item.source === 'remote' && item.isAvailable !== false && (
                  <Text style={styles.sourceBadge}>
                    {remoteStatus === 'syncing'
                      ? 'SYNCING'
                      : remoteStatus === 'error'
                        ? 'STALE'
                        : 'PC'}
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name} from playlist`}
                  onPress={() =>
                    onRemoveTrack(selectedPlaylist.id, item.id)
                  }
                  style={({ pressed }) => [
                    styles.rowButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons name="remove-circle" color={colors.muted} size={22} />
                </Pressable>
              </Pressable>
            )}
            showsVerticalScrollIndicator={false}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${selectedPlaylist.name}`}
            onPress={() => {
              onDelete(selectedPlaylist.id);
              setSelectedPlaylistId(null);
            }}
            style={({ pressed }) => [
              styles.deletePlaylistButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="trash-outline" color="#d92d20" size={18} />
            <Text style={styles.deletePlaylistText}>Delete Playlist</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.eyebrow}>YOUR COLLECTIONS</Text>
              <Text style={styles.title}>Playlists</Text>
              <Text style={styles.subtitle}>
                {playlists.length
                  ? `${playlists.length} saved ${playlists.length === 1 ? 'playlist' : 'playlists'}`
                  : 'Create a playlist from your library.'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open music library"
              onPress={onOpenLibrary}
              style={({ pressed }) => [
                styles.libraryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="library-outline" color={colors.accent} size={19} />
              <Text style={styles.libraryButtonText}>Library</Text>
            </Pressable>
          </View>

          <FlatList
            contentContainerStyle={[
              styles.playlistList,
              playlists.length === 0 && styles.emptyList,
            ]}
            data={playlists}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="albums-outline" color={colors.accent} size={35} />
                </View>
                <Text style={styles.emptyTitle}>Create your first playlist</Text>
                <Text style={styles.emptyText}>
                  Group songs from your device library into collections.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsCreateOpen(true)}
                  style={({ pressed }) => [
                    styles.createButton,
                    pressed && styles.primaryButtonPressed,
                  ]}
                >
                  <Ionicons name="add" color="#fff" size={20} />
                  <Text style={styles.createButtonText}>New Playlist</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.playlistRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.name}`}
                  accessibilityHint="Long press to edit playlist settings"
                  delayLongPress={450}
                  onLongPress={() => {
                    longPressedPlaylistId.current = item.id;
                    openPlaylistConfig(item);
                  }}
                  onPress={() => {
                    if (longPressedPlaylistId.current === item.id) {
                      longPressedPlaylistId.current = null;
                      return;
                    }
                    setSelectedPlaylistId(item.id);
                  }}
                  style={({ pressed }) => [
                    styles.playlistMainAction,
                    pressed && styles.playlistRowPressed,
                  ]}
                >
                  <View style={styles.rowArtwork}>
                    {item.artwork ? (
                      <Image
                        accessibilityLabel={`Cover for ${item.name}`}
                        source={{ uri: item.artwork }}
                        style={styles.rowArtworkImage}
                      />
                    ) : (
                      <Ionicons name="musical-notes" color="#fff" size={30} />
                    )}
                  </View>
                  <View style={styles.playlistDetails}>
                    <Text numberOfLines={1} style={styles.playlistName}>
                      {item.name}
                    </Text>
                    <Text style={styles.playlistCount}>
                      {item.trackIds.length}{' '}
                      {item.trackIds.length === 1 ? 'song' : 'songs'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Configure ${item.name}`}
                  onPress={() => openPlaylistConfig(item)}
                  style={({ pressed }) => [
                    styles.configButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    color={colors.secondaryText}
                    size={20}
                  />
                </Pressable>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}

      <Modal
        animationType="fade"
        onRequestClose={closeCreateModal}
        transparent
        visible={isCreateOpen}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.createModal}>
            <Text style={styles.modalTitle}>New Playlist</Text>
            <Text style={styles.modalSubtitle}>
              Give your playlist a memorable name.
            </Text>
            <TextInput
              autoFocus
              maxLength={60}
              onChangeText={(value) => {
                setPlaylistName(value);
                setNameError('');
              }}
              onSubmitEditing={createPlaylist}
              placeholder="Playlist name"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.nameInput}
              value={playlistName}
            />
            {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closeCreateModal}
                style={({ pressed }) => [
                  styles.modalButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={createPlaylist}
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.saveButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.saveText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closePlaylistConfig}
        transparent
        visible={Boolean(configPlaylist)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.createModal}>
            <Text style={styles.modalTitle}>Playlist Settings</Text>
            <Text style={styles.modalSubtitle}>
              Change the name or cover shown for this playlist.
            </Text>
            <View style={styles.coverActions}>
              <Pressable
                onPress={() => void onChooseArtwork(configPlaylist!.id)}
                style={({ pressed }) => [
                  styles.coverButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Ionicons name="image-outline" color={colors.accent} size={19} />
                <Text style={styles.coverButtonText}>
                  {configPlaylist?.artwork ? 'Change image' : 'Add image'}
                </Text>
              </Pressable>
              {configPlaylist?.artwork && (
                <Pressable
                  onPress={() => onRemoveArtwork(configPlaylist.id)}
                  style={({ pressed }) => [
                    styles.coverButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons name="trash-outline" color="#d92d20" size={18} />
                  <Text style={styles.removeCoverText}>Remove image</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.fieldLabel}>PLAYLIST NAME</Text>
            <TextInput
              autoFocus
              maxLength={60}
              onChangeText={(value) => {
                setPlaylistName(value);
                setNameError('');
              }}
              onSubmitEditing={savePlaylistConfig}
              placeholder="Playlist name"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              selectTextOnFocus
              style={[styles.nameInput, styles.configNameInput]}
              value={playlistName}
            />
            {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closePlaylistConfig}
                style={({ pressed }) => [
                  styles.modalButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={savePlaylistConfig}
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.saveButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={closeTrackPicker}
        presentationStyle="pageSheet"
        visible={isTrackPickerOpen}
      >
        <SafeAreaView style={styles.pickerScreen}>
          <View style={styles.pickerHeader}>
            <Pressable
              accessibilityRole="button"
              onPress={closeTrackPicker}
              style={styles.pickerHeaderButton}
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
            <Text style={styles.pickerTitle}>Add Songs</Text>
            <View style={styles.pickerHeaderButton} />
          </View>
          <View style={styles.pickerToolbar}>
            <View style={styles.pickerSearch}>
              <Ionicons name="search" color={colors.secondaryText} size={18} />
              <TextInput
                accessibilityLabel="Search songs to add"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setTrackSearchQuery}
                placeholder="Search songs, artists, albums or genres"
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={styles.pickerSearchInput}
                value={trackSearchQuery}
              />
              {!!trackSearchQuery && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear song search"
                  hitSlop={8}
                  onPress={() => setTrackSearchQuery('')}
                >
                  <Ionicons name="close-circle" color={colors.muted} size={19} />
                </Pressable>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                filteredPickerTracks.length === 0
                  ? 'No songs match the current search'
                  : filteredTracksToAdd.length === 0
                    ? 'All matching songs are already added'
                    : `Add all ${filteredTracksToAdd.length} matching songs`
              }
              disabled={filteredTracksToAdd.length === 0}
              onPress={addAllFilteredTracks}
              style={({ pressed }) => [
                styles.pickerAddAllButton,
                filteredTracksToAdd.length === 0 && styles.disabled,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Ionicons name="add" color="#fff" size={17} />
              <Text style={styles.pickerAddAllText}>
                {filteredTracksToAdd.length > 0
                  ? `Add All (${filteredTracksToAdd.length})`
                  : filteredPickerTracks.length > 0
                    ? 'All Added'
                    : 'No Matches'}
              </Text>
            </Pressable>
          </View>
          <FlatList
            contentContainerStyle={[
              styles.pickerList,
              library.length === 0 && styles.emptyList,
            ]}
            data={filteredPickerTracks}
            extraData={selectedTrackIds}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  {library.length === 0
                    ? 'Your library is empty'
                    : 'No matching songs'}
                </Text>
                <Text style={styles.emptyText}>
                  {library.length === 0
                    ? 'Scan your device before adding songs.'
                    : 'Try a different song, artist, album, or genre.'}
                </Text>
                {library.length === 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      closeTrackPicker();
                      onOpenLibrary();
                    }}
                    style={styles.emptyAction}
                  >
                    <Text style={styles.emptyActionText}>Open Library</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setTrackSearchQuery('')}
                    style={styles.emptyAction}
                  >
                    <Text style={styles.emptyActionText}>Clear Search</Text>
                  </Pressable>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const isAdded = selectedTrackIds.has(item.id);
              return (
                <View style={styles.pickerRow}>
                  <View style={styles.trackDetails}>
                    <Text numberOfLines={1} style={styles.trackName}>
                      {item.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.artistName}>
                      {item.artist}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      isAdded
                        ? `Remove ${item.name} from playlist`
                        : `Add ${item.name} to playlist`
                    }
                    onPress={() => {
                      if (!selectedPlaylist) {
                        return;
                      }
                      if (isAdded) {
                        onRemoveTrack(selectedPlaylist.id, item.id);
                      } else {
                        onAddTrack(selectedPlaylist.id, item.id);
                      }
                    }}
                    style={[
                      styles.pickerAddButton,
                      isAdded && styles.pickerAddedButton,
                    ]}
                  >
                    <Ionicons
                      name={isAdded ? 'checkmark' : 'add'}
                      color={isAdded ? '#34c759' : colors.accent}
                      size={22}
                    />
                  </Pressable>
                </View>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.header,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 8,
    textAlign: 'center',
  },
  buttonPressed: { backgroundColor: colors.elevated },
  titleRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 22,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 4,
  },
  subtitle: { color: colors.secondaryText, fontSize: 12, marginTop: 3 },
  libraryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 17,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    paddingHorizontal: 11,
  },
  libraryButtonText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  playlistList: { gap: 4, paddingHorizontal: 18, paddingBottom: 20 },
  emptyList: { flex: 1 },
  playlistRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 96,
    overflow: 'hidden',
  },
  playlistMainAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    minHeight: 96,
    paddingVertical: 10,
  },
  playlistRowPressed: { opacity: 0.7 },
  rowArtwork: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    height: 76,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 76,
  },
  rowArtworkImage: { height: '100%', width: '100%' },
  playlistDetails: { flex: 1 },
  playlistName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  playlistCount: { color: colors.secondaryText, fontSize: 12, marginTop: 6 },
  configButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 44,
    justifyContent: 'center',
    width: 38,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 13,
  },
  emptyText: {
    color: colors.secondaryText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
    textAlign: 'center',
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 13,
    flexDirection: 'row',
    gap: 5,
    height: 44,
    marginTop: 18,
    paddingHorizontal: 17,
  },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  createButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  detailHero: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    paddingBottom: 18,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  playlistArtwork: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 22,
    height: 138,
    justifyContent: 'center',
    marginBottom: 18,
    overflow: 'hidden',
    width: 138,
  },
  playlistArtworkImage: { height: '100%', width: '100%' },
  artworkEditBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    bottom: 8,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 30,
  },
  detailTitle: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  detailCount: { color: colors.secondaryText, fontSize: 12, marginTop: 4 },
  detailActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    width: '100%',
  },
  heroActionButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    height: 44,
    justifyContent: 'center',
  },
  heroActionText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  detailSecondaryActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'center',
    marginTop: 13,
  },
  detailTextButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
  },
  detailTextButtonLabel: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  trackList: { gap: 7, padding: 12 },
  trackRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  trackIndex: { color: colors.muted, fontSize: 11, textAlign: 'center', width: 22 },
  trackDetails: { flex: 1, minWidth: 0 },
  trackName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artistName: { color: colors.secondaryText, fontSize: 11, marginTop: 3 },
  rowButton: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  emptyAction: {
    backgroundColor: colors.accentSoft,
    borderRadius: 15,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  emptyActionText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  deletePlaylistButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
  },
  deletePlaylistText: { color: '#d92d20', fontSize: 13, fontWeight: '600' },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  createModal: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    maxWidth: 380,
    padding: 20,
    width: '100%',
  },
  modalTitle: { color: colors.text, fontSize: 21, fontWeight: '700' },
  modalSubtitle: { color: colors.secondaryText, fontSize: 12, marginTop: 4 },
  fieldLabel: {
    color: colors.secondaryText,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 16,
  },
  nameInput: {
    backgroundColor: colors.elevated,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    height: 46,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  configNameInput: { marginTop: 7 },
  coverActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  coverButton: {
    alignItems: 'center',
    backgroundColor: colors.elevated,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  coverButtonText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  removeCoverText: { color: '#d92d20', fontSize: 12, fontWeight: '700' },
  errorText: { color: '#d92d20', fontSize: 11, marginTop: 6 },
  unavailableBadge: {
    color: '#d92d20',
    fontSize: 8,
    fontWeight: '800',
  },
  sourceBadge: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  modalButton: {
    alignItems: 'center',
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 14,
  },
  saveButton: { backgroundColor: colors.accent },
  cancelText: { color: colors.secondaryText, fontSize: 14, fontWeight: '600' },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pickerScreen: { backgroundColor: colors.background, flex: 1 },
  pickerHeader: {
    alignItems: 'center',
    backgroundColor: colors.header,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  pickerHeaderButton: { minWidth: 60, padding: 10 },
  pickerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  doneText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  pickerToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  pickerSearch: {
    alignItems: 'center',
    backgroundColor: colors.elevated,
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    height: 40,
    paddingHorizontal: 10,
  },
  pickerSearchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    height: '100%',
    paddingVertical: 0,
  },
  pickerAddAllButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 2,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pickerAddAllText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pickerList: { gap: 7, padding: 12 },
  pickerRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pickerAddButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pickerAddedButton: { backgroundColor: '#effaf1' },
});
