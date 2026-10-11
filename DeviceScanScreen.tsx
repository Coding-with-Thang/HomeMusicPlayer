import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  type AudioFileInput,
  isSupportedAudioFile,
  type LibraryScanResult,
} from './useLocalAudioPlayer';
import type { RemoteConnection } from './remoteServer';
import { type ThemeColors, useTheme } from './theme';

type ScanDirectory = {
  enabled: boolean;
  name: string;
  uri: string;
};

const SCAN_DIRECTORIES_STORAGE_KEY = 'home-audio-player.scan-directories.v1';

type DeviceScanScreenProps = {
  onAddToLibrary: (
    files: AudioFileInput[],
    scannedRootUris: string[]
  ) => Promise<LibraryScanResult>;
  onBack: () => void;
  onRemoteSync: () => Promise<number>;
  remoteConnection: RemoteConnection | null;
  remoteStatus: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  remoteTrackCount: number;
};

function getDisplayName(directory: Directory) {
  try {
    return decodeURIComponent(directory.name) || 'Selected folder';
  } catch {
    return directory.name || 'Selected folder';
  }
}

function getDisplayUri(uri: string) {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

function getNetworkName(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

function isScanDirectory(value: unknown): value is ScanDirectory {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const directory = value as Partial<ScanDirectory>;
  return (
    typeof directory.enabled === 'boolean' &&
    typeof directory.name === 'string' &&
    typeof directory.uri === 'string'
  );
}

async function collectAudioFiles(root: ScanDirectory) {
  const foundFiles: AudioFileInput[] = [];
  const pendingDirectories = [new Directory(root.uri)];
  const visited = new Set<string>();
  let processedDirectories = 0;

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (!directory || visited.has(directory.uri)) {
      continue;
    }

    visited.add(directory.uri);
    try {
      for (const entry of directory.list()) {
        if (entry instanceof Directory) {
          pendingDirectories.push(entry);
        } else if (entry instanceof File && isSupportedAudioFile(entry.name)) {
          foundFiles.push({ name: entry.name, uri: entry.uri });
        }
      }
    } catch {
      if (directory.uri === root.uri) {
        throw new Error(`The folder ${root.name} is not accessible.`);
      }
      // Skip subdirectories that are no longer readable.
    }

    processedDirectories += 1;
    if (processedDirectories % 40 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return foundFiles;
}

export function DeviceScanScreen({
  onAddToLibrary,
  onBack,
  onRemoteSync,
  remoteConnection,
  remoteStatus,
  remoteTrackCount,
}: DeviceScanScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [directories, setDirectories] = useState<ScanDirectory[]>([]);
  const [hasLoadedDirectories, setHasLoadedDirectories] = useState(false);
  const [isChoosingDirectory, setIsChoosingDirectory] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSyncingRemote, setIsSyncingRemote] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(SCAN_DIRECTORIES_STORAGE_KEY)
      .then((storedDirectories) => {
        if (!isMounted || !storedDirectories) {
          return;
        }

        const parsedDirectories: unknown = JSON.parse(storedDirectories);
        if (Array.isArray(parsedDirectories)) {
          setDirectories(parsedDirectories.filter(isScanDirectory));
        }
      })
      .catch(() => {
        // Start with an empty list if saved folder settings cannot be read.
      })
      .finally(() => {
        if (isMounted) {
          setHasLoadedDirectories(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedDirectories) {
      return;
    }

    AsyncStorage.setItem(
      SCAN_DIRECTORIES_STORAGE_KEY,
      JSON.stringify(directories)
    ).catch(() => {
      // Keep the folder settings available for the current session.
    });
  }, [directories, hasLoadedDirectories]);

  const addDirectory = async () => {
    try {
      setIsChoosingDirectory(true);
      const directory = await Directory.pickDirectoryAsync();
      setDirectories((current) => {
        if (current.some((item) => item.uri === directory.uri)) {
          return current;
        }
        return [
          ...current,
          {
            enabled: true,
            name: getDisplayName(directory),
            uri: directory.uri,
          },
        ];
      });
    } catch (error) {
      if (!(error instanceof Error) || !/cancel/i.test(error.message)) {
        Alert.alert(
          'Could not open folder',
          'The selected folder could not be accessed.'
        );
      }
    } finally {
      setIsChoosingDirectory(false);
    }
  };

  const scanDirectories = async () => {
    const enabledDirectories = directories.filter((directory) => directory.enabled);
    if (enabledDirectories.length === 0) {
      Alert.alert('Choose a folder', 'Enable at least one folder before scanning.');
      return;
    }

    try {
      setIsScanning(true);
      const results = await Promise.all(
        enabledDirectories.map(collectAudioFiles)
      );
      const files = results.flat();
      const { addedCount, removedCount } = await onAddToLibrary(
        files,
        enabledDirectories.map((directory) => directory.uri)
      );

      if (files.length === 0) {
        Alert.alert(
          'No audio found',
          `No supported audio files were found in the selected folders.${
            removedCount > 0
              ? ` ${removedCount} missing ${removedCount === 1 ? 'song was' : 'songs were'} removed from the library.`
              : ''
          }`
        );
        return;
      }

      const duplicateCount = files.length - addedCount;
      Alert.alert(
        'Scan complete',
        `${addedCount} ${addedCount === 1 ? 'song was' : 'songs were'} added to your library.${
          duplicateCount > 0
            ? ` ${duplicateCount} already saved ${duplicateCount === 1 ? 'file was' : 'files were'} skipped.`
            : ''
        }${
          removedCount > 0
            ? ` ${removedCount} missing ${removedCount === 1 ? 'song was' : 'songs were'} removed from the library.`
            : ''
        }`
      );
    } catch {
      Alert.alert(
        'Scan failed',
        'Some selected folders could not be scanned. Check their access and try again.'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const syncRemote = async () => {
    try {
      setIsSyncingRemote(true);
      const count = await onRemoteSync();
      Alert.alert('Network synced', `${count} tracks are available.`);
    } catch (error) {
      Alert.alert(
        'Sync failed',
        error instanceof Error ? error.message : 'The connected network could not be reached.'
      );
    } finally {
      setIsSyncingRemote(false);
    }
  };

  const isRemoteSyncing = isSyncingRemote || remoteStatus === 'syncing';
  const remoteStatusLabel =
    remoteStatus === 'error'
      ? 'Offline · last sync retained'
      : isRemoteSyncing
        ? 'Syncing library'
        : 'Synced';

  return (
    <View style={styles.screen}>
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
        <Text style={styles.headerTitle}>Scan Device</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons name="folder-open" color={colors.accent} size={30} />
        </View>
        <Text style={styles.title}>Choose where to look</Text>
        <Text style={styles.subtitle}>
          Add folders, then enable only the locations you want searched. Audio
          files found there are saved to your music library.
        </Text>
      </View>

      {remoteConnection && (
        <View style={styles.networkSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Connected networks</Text>
              <Text style={styles.sectionSubtitle}>Synced music sources</Text>
            </View>
          </View>
          <View style={styles.networkRow}>
            <View style={styles.networkIcon}>
              <Ionicons name="desktop-outline" color={colors.accent} size={21} />
            </View>
            <View style={styles.directoryDetails}>
              <Text numberOfLines={1} style={styles.directoryName}>
                {getNetworkName(remoteConnection.baseUrl)}
              </Text>
              <Text numberOfLines={1} style={styles.directoryUri}>
                {remoteTrackCount} {remoteTrackCount === 1 ? 'track' : 'tracks'}
                {remoteConnection.lastSyncAt
                  ? ` · Synced ${new Date(remoteConnection.lastSyncAt).toLocaleString()}`
                  : ' · Not synced yet'}
              </Text>
              <View style={styles.networkStatus}>
                <View
                  style={[
                    styles.statusDot,
                    remoteStatus === 'error' && styles.statusDotError,
                  ]}
                />
                <Text style={styles.networkStatusText}>{remoteStatusLabel}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sync ${getNetworkName(remoteConnection.baseUrl)}`}
              disabled={isRemoteSyncing}
              onPress={syncRemote}
              style={({ pressed }) => [
                styles.syncButton,
                pressed && styles.addFolderButtonPressed,
                isRemoteSyncing && styles.scanButtonDisabled,
              ]}
            >
              {isRemoteSyncing ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Ionicons
                  name={remoteStatus === 'error' ? 'refresh' : 'sync'}
                  color={colors.accent}
                  size={19}
                />
              )}
              <Text style={styles.syncButtonText}>
                {isRemoteSyncing
                  ? 'Syncing'
                  : remoteStatus === 'error'
                    ? 'Retry'
                    : 'Sync'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Search folders</Text>
          <Text style={styles.sectionSubtitle}>
            {directories.length
              ? `${directories.filter((item) => item.enabled).length} of ${directories.length} enabled`
              : 'No folders selected'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add search folder"
          disabled={!hasLoadedDirectories || isChoosingDirectory || isScanning}
          onPress={addDirectory}
          style={({ pressed }) => [
            styles.addFolderButton,
            pressed && styles.addFolderButtonPressed,
          ]}
        >
          {isChoosingDirectory ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <>
              <Ionicons name="add" color={colors.accent} size={20} />
              <Text style={styles.addFolderText}>Add Folder</Text>
            </>
          )}
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          directories.length === 0 && styles.emptyList,
        ]}
        data={directories}
        keyExtractor={(item) => item.uri}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {!hasLoadedDirectories ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Ionicons name="folder-outline" color={colors.muted} size={42} />
                <Text style={styles.emptyTitle}>No search folders</Text>
                <Text style={styles.emptyText}>
                  Add a music folder or select a broader location to scan.
                </Text>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.directoryRow}>
            <View style={styles.directoryIcon}>
              <Ionicons name="folder" color={colors.accent} size={21} />
            </View>
            <View style={styles.directoryDetails}>
              <Text numberOfLines={1} style={styles.directoryName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.directoryUri}>
                {getDisplayUri(item.uri)}
              </Text>
            </View>
            <Switch
              accessibilityLabel={`Include ${item.name} in scans`}
              onValueChange={(enabled) =>
                setDirectories((current) =>
                  current.map((directory) =>
                    directory.uri === item.uri
                      ? { ...directory, enabled }
                      : directory
                  )
                )
              }
              trackColor={{ false: colors.border, true: colors.switchTrack }}
              thumbColor={item.enabled ? colors.accent : '#fff'}
              value={item.enabled}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
              hitSlop={8}
              onPress={() =>
                setDirectories((current) =>
                  current.filter((directory) => directory.uri !== item.uri)
                )
              }
              style={({ pressed }) => [
                styles.removeButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="close-circle" color={colors.muted} size={22} />
            </Pressable>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.footer}>
        <Text style={styles.supportedText}>
          MP3, M4A, AAC, WAV, FLAC, OGG and Opus
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan enabled folders and add songs"
          disabled={!hasLoadedDirectories || isScanning}
          onPress={scanDirectories}
          style={({ pressed }) => [
            styles.scanButton,
            pressed && styles.scanButtonPressed,
            (!hasLoadedDirectories || isScanning) && styles.scanButtonDisabled,
          ]}
        >
          {isScanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="search" color="#fff" size={20} />
              <Text style={styles.scanButtonText}>Scan & Update Library</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
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
  buttonPressed: {
    backgroundColor: colors.elevated,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  intro: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 22,
  },
  introIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 10,
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 5,
    textAlign: 'center',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 22,
  },
  networkSection: {
    paddingTop: 2,
  },
  networkRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    minHeight: 76,
    padding: 11,
  },
  networkIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 18,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  networkStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 4,
  },
  statusDot: {
    backgroundColor: '#22a447',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  statusDotError: {
    backgroundColor: '#b42318',
  },
  networkStatusText: {
    color: colors.secondaryText,
    fontSize: 10,
    fontWeight: '600',
  },
  syncButton: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 11,
    flexDirection: 'row',
    gap: 5,
    minHeight: 38,
    minWidth: 72,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  syncButtonText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: colors.secondaryText,
    fontSize: 11,
    marginTop: 2,
  },
  addFolderButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 17,
    flexDirection: 'row',
    gap: 3,
    height: 34,
    justifyContent: 'center',
    minWidth: 104,
    paddingHorizontal: 10,
  },
  addFolderButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  addFolderText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    gap: 8,
    padding: 16,
  },
  emptyList: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },
  emptyText: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 4,
    maxWidth: 240,
    textAlign: 'center',
  },
  directoryRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    minHeight: 66,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  directoryIcon: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 16,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  directoryDetails: {
    flex: 1,
    minWidth: 0,
  },
  directoryName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  directoryUri: {
    color: colors.muted,
    fontSize: 9,
    marginTop: 3,
  },
  removeButton: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  supportedText: {
    color: colors.secondaryText,
    fontSize: 10,
    marginBottom: 8,
    textAlign: 'center',
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 13,
    flexDirection: 'row',
    gap: 7,
    height: 48,
    justifyContent: 'center',
  },
  scanButtonPressed: {
    backgroundColor: colors.accentPressed,
  },
  scanButtonDisabled: {
    opacity: 0.7,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
