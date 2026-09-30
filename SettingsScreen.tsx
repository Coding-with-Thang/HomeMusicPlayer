import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import type { VisualizationEffect } from "./AudioVisualizer";
import type {
  RemoteConnection,
  RemoteDirectoryListing,
} from "./remoteServer";
import {
  ACCENT_COLORS,
  type AccentColor,
  type ThemeColors,
  type ThemeMode,
  useTheme,
} from "./theme";

export type PlaylistPlayerPosition = "top" | "bottom";

type SettingsScreenProps = {
  onRemoteBrowse: (path?: string) => Promise<RemoteDirectoryListing>;
  onRemoteConnect: (baseUrl: string, code: string) => Promise<number>;
  onRemoteDisconnect: (localOnly?: boolean) => Promise<void>;
  onRemoteSync: () => Promise<number>;
  onRemoteTest: () => Promise<void>;
  onRemoteFoldersSave: (paths: string[]) => Promise<number>;
  onBack: () => void;
  onOpenPcConnectionGuide: () => void;
  onPlayerPositionChange: (position: PlaylistPlayerPosition) => void;
  onShowFileTypeChange: (enabled: boolean) => void;
  onVisualizationBackgroundImageChoose: () => void;
  onVisualizationBackgroundImageRemove: () => void;
  onVisualizationEffectChange: (effect: VisualizationEffect) => void;
  onVisualizationEnabledChange: (enabled: boolean) => void;
  onVisualizationPrimaryColorChange: (color: string) => void;
  onVisualizationSecondaryColorChange: (color: string) => void;
  playerPosition: PlaylistPlayerPosition;
  remoteConnection: RemoteConnection | null;
  remoteError: string | null;
  remoteStatus: "disconnected" | "connecting" | "connected" | "syncing" | "error";
  showFileType: boolean;
  visualizationBackgroundImage: string | null;
  visualizationEffect: VisualizationEffect;
  visualizationEnabled: boolean;
  visualizationPrimaryColor: string;
  visualizationSecondaryColor: string;
};

const positionOptions: {
  description: string;
  icon: "arrow-up-outline" | "arrow-down-outline";
  label: string;
  value: PlaylistPlayerPosition;
}[] = [
  {
    description: "Keep the player above the scrolling song list.",
    icon: "arrow-up-outline",
    label: "Top of screen",
    value: "top",
  },
  {
    description: "Keep the player below the scrolling song list.",
    icon: "arrow-down-outline",
    label: "Bottom of screen",
    value: "bottom",
  },
];

const visualizationEffects: {
  icon: "analytics-outline" | "radio-outline" | "pulse-outline";
  label: string;
  value: VisualizationEffect;
}[] = [
  { icon: "analytics-outline", label: "Bars", value: "bars" },
  { icon: "radio-outline", label: "Pulse", value: "pulse" },
  { icon: "pulse-outline", label: "Wave", value: "wave" },
];

const visualizationColors = [
  "#ffffff",
  "#ffd60a",
  "#30d158",
  "#64d2ff",
  "#bf5af2",
  "#ff375f",
];

export function SettingsScreen({
  onRemoteBrowse,
  onRemoteConnect,
  onRemoteDisconnect,
  onRemoteSync,
  onRemoteTest,
  onRemoteFoldersSave,
  onBack,
  onOpenPcConnectionGuide,
  onPlayerPositionChange,
  onShowFileTypeChange,
  onVisualizationBackgroundImageChoose,
  onVisualizationBackgroundImageRemove,
  onVisualizationEffectChange,
  onVisualizationEnabledChange,
  onVisualizationPrimaryColorChange,
  onVisualizationSecondaryColorChange,
  playerPosition,
  remoteConnection,
  remoteError,
  remoteStatus,
  showFileType,
  visualizationBackgroundImage,
  visualizationEffect,
  visualizationEnabled,
  visualizationPrimaryColor,
  visualizationSecondaryColor,
}: SettingsScreenProps) {
  const { colors, mode, setAccent, setMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [remoteUrl, setRemoteUrl] = useState(remoteConnection?.baseUrl ?? "");
  const [pairingCode, setPairingCode] = useState("");
  const [isFolderBrowserOpen, setIsFolderBrowserOpen] = useState(false);
  const [directoryListing, setDirectoryListing] =
    useState<RemoteDirectoryListing | null>(null);
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<string[]>([]);
  const [isBrowsingFolders, setIsBrowsingFolders] = useState(false);
  const isRemoteBusy =
    remoteStatus === "connecting" || remoteStatus === "syncing";

  const connect = async () => {
    try {
      const count = await onRemoteConnect(remoteUrl, pairingCode);
      setPairingCode("");
      Alert.alert("PC connected", `${count} tracks synced.`);
    } catch (error) {
      Alert.alert(
        "Could not connect",
        error instanceof Error ? error.message : "Check the URL and pairing code.",
      );
    }
  };

  const sync = async () => {
    try {
      const count = await onRemoteSync();
      Alert.alert("PC library synced", `${count} tracks are available.`);
    } catch (error) {
      Alert.alert(
        "Sync failed",
        error instanceof Error ? error.message : "The PC could not be reached.",
      );
    }
  };

  const disconnect = async () => {
    try {
      await onRemoteDisconnect(false);
    } catch (error) {
      Alert.alert(
        "Could not revoke PC access",
        `${
          error instanceof Error ? error.message : "The PC could not be reached."
        } You can keep the connection and retry, or remove it only from this phone. The PC token will remain valid until revoked from the companion admin page.`,
        [
          { text: "Keep connected", style: "cancel" },
          {
            text: "Remove locally",
            style: "destructive",
            onPress: () => void onRemoteDisconnect(true),
          },
        ],
      );
    }
  };

  const browse = async (directoryPath?: string) => {
    setIsBrowsingFolders(true);
    try {
      const listing = await onRemoteBrowse(directoryPath);
      setDirectoryListing(listing);
      if (!isFolderBrowserOpen) {
        setSelectedRemotePaths(listing.selectedPaths);
      }
      setIsFolderBrowserOpen(true);
    } catch (error) {
      Alert.alert(
        "Could not browse PC",
        error instanceof Error ? error.message : "The PC could not be reached.",
      );
    } finally {
      setIsBrowsingFolders(false);
    }
  };

  const toggleRemotePath = (directoryPath: string) => {
    setSelectedRemotePaths((current) =>
      current.includes(directoryPath)
        ? current.filter((item) => item !== directoryPath)
        : [...current, directoryPath],
    );
  };
  return (
    <View style={styles.screen}>
      <Modal
        animationType="slide"
        onRequestClose={() => setIsFolderBrowserOpen(false)}
        visible={isFolderBrowserOpen}
      >
        <View style={styles.folderBrowser}>
          <View style={styles.folderBrowserHeader}>
            <Pressable
              accessibilityLabel="Close PC folder browser"
              onPress={() => setIsFolderBrowserOpen(false)}
              style={styles.headerButton}
            >
              <Ionicons name="close" color={colors.text} size={24} />
            </Pressable>
            <Text style={styles.folderBrowserTitle}>Choose PC folders</Text>
            <Pressable
              accessibilityLabel="Return to PC locations"
              onPress={() => void browse()}
              style={styles.headerButton}
            >
              <Ionicons name="home-outline" color={colors.accent} size={22} />
            </Pressable>
          </View>
          <View style={styles.folderPathBar}>
            {directoryListing?.parentPath && (
              <Pressable
                accessibilityLabel="Open parent folder"
                onPress={() => void browse(directoryListing.parentPath ?? undefined)}
                style={styles.folderUpButton}
              >
                <Ionicons name="arrow-up" color={colors.accent} size={19} />
              </Pressable>
            )}
            <Text numberOfLines={2} style={styles.folderCurrentPath}>
              {directoryListing?.currentPath ?? "PC locations"}
            </Text>
          </View>
          <ScrollView contentContainerStyle={styles.folderList}>
            {isBrowsingFolders ? (
              <ActivityIndicator color={colors.accent} size="large" />
            ) : (
              directoryListing?.directories.map((directory) => {
                const selected = selectedRemotePaths.includes(directory.path);
                return (
                  <View key={directory.path} style={styles.folderRow}>
                    <Pressable
                      accessibilityLabel={`${selected ? "Remove" : "Add"} ${directory.name}`}
                      onPress={() => toggleRemotePath(directory.path)}
                      style={[
                        styles.folderSelectButton,
                        selected && styles.folderSelectButtonActive,
                      ]}
                    >
                      <Ionicons
                        name={selected ? "checkmark" : "add"}
                        color={selected ? "#fff" : colors.accent}
                        size={18}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Open ${directory.name}`}
                      onPress={() => void browse(directory.path)}
                      style={styles.folderOpenButton}
                    >
                      <Ionicons
                        name="folder-outline"
                        color={colors.accent}
                        size={22}
                      />
                      <View style={styles.folderText}>
                        <Text numberOfLines={1} style={styles.folderName}>
                          {directory.name}
                        </Text>
                        <Text numberOfLines={1} style={styles.folderLocation}>
                          {directory.path}
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        color={colors.muted}
                        size={18}
                      />
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
          <View style={styles.folderBrowserFooter}>
            <Text style={styles.folderSelectionCount}>
              {selectedRemotePaths.length}{" "}
              {selectedRemotePaths.length === 1 ? "folder" : "folders"} selected
            </Text>
            <Pressable
              disabled={isBrowsingFolders}
              onPress={async () => {
                setIsBrowsingFolders(true);
                try {
                  const count = await onRemoteFoldersSave(selectedRemotePaths);
                  setIsFolderBrowserOpen(false);
                  Alert.alert("PC folders saved", `${count} tracks synced.`);
                } catch (error) {
                  Alert.alert(
                    "Could not save folders",
                    error instanceof Error ? error.message : "Please try again.",
                  );
                } finally {
                  setIsBrowsingFolders(false);
                }
              }}
              style={styles.remotePrimaryButton}
            >
              <Text style={styles.remotePrimaryText}>Save folders</Text>
            </Pressable>
          </View>
        </View>
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
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AccordionSection
          description="Theme and accent color"
          icon="color-palette-outline"
          initiallyExpanded
          title="Appearance"
        >
        <Text style={styles.eyebrow}>APPEARANCE</Text>
        <Text style={styles.title}>Make it yours</Text>
        <Text style={styles.subtitle}>
          Choose the app theme and the accent used for controls and highlights.
        </Text>

        <View style={styles.themeOptions}>
          {(["light", "dark"] as ThemeMode[]).map((themeMode) => {
            const isSelected = mode === themeMode;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                key={themeMode}
                onPress={() => setMode(themeMode)}
                style={({ pressed }) => [
                  styles.themeOption,
                  isSelected && styles.themeOptionSelected,
                  pressed && styles.optionPressed,
                ]}
              >
                <Ionicons
                  color={isSelected ? "#fff" : colors.accent}
                  name={themeMode === "light" ? "sunny" : "moon"}
                  size={22}
                />
                <Text
                  style={[
                    styles.themeOptionText,
                    isSelected && styles.themeOptionTextSelected,
                  ]}
                >
                  {themeMode === "light" ? "Light" : "Dark"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.controlLabel}>ACCENT COLOR</Text>
        <View accessibilityRole="radiogroup" style={styles.accentOptions}>
          {ACCENT_COLORS.map((accent) => (
            <AccentOption
              color={accent}
              isSelected={colors.accent === accent}
              key={accent}
              onPress={() => setAccent(accent)}
            />
          ))}
        </View>
        </AccordionSection>

        <AccordionSection
          description="Stream privately through Tailscale"
          icon="desktop-outline"
          title="PC streaming"
        >
          <Text style={styles.eyebrow}>PC STREAMING</Text>
          <Text style={styles.sectionTitle}>
            {remoteConnection ? "Connected companion" : "Connect your PC"}
          </Text>
          <Text style={styles.subtitle}>
            Enter the private HTTPS address from Tailscale Serve and the
            six-digit code shown by the companion setup page.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open PC connection instructions"
            onPress={onOpenPcConnectionGuide}
            style={({ pressed }) => [
              styles.connectionGuideButton,
              pressed && styles.optionPressed,
            ]}
          >
            <View style={styles.optionIcon}>
              <Ionicons name="help-circle-outline" color={colors.accent} size={21} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>How to connect</Text>
              <Text style={styles.optionDescription}>
                Set up the Windows companion and Tailscale step by step.
              </Text>
            </View>
            <Ionicons name="chevron-forward" color={colors.muted} size={18} />
          </Pressable>

          <Text style={styles.controlLabel}>TAILSCALE HTTPS ADDRESS</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!remoteConnection && !isRemoteBusy}
            keyboardType="url"
            onChangeText={setRemoteUrl}
            placeholder="https://your-pc.tailnet.ts.net"
            placeholderTextColor={colors.muted}
            style={styles.remoteInput}
            value={remoteConnection?.baseUrl ?? remoteUrl}
          />
          {!remoteConnection && (
            <>
              <Text style={styles.controlLabel}>PAIRING CODE</Text>
              <TextInput
                editable={!isRemoteBusy}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setPairingCode}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                style={styles.remoteInput}
                value={pairingCode}
              />
            </>
          )}

          {remoteConnection?.lastSyncAt && (
            <Text style={styles.remoteStatus}>
              Last synced {new Date(remoteConnection.lastSyncAt).toLocaleString()}
            </Text>
          )}
          {remoteError && <Text style={styles.remoteError}>{remoteError}</Text>}
          {remoteConnection && (
            <Pressable
              disabled={isRemoteBusy || isBrowsingFolders}
              onPress={() => void browse()}
              style={({ pressed }) => [
                styles.folderBrowseButton,
                (pressed || isRemoteBusy || isBrowsingFolders) &&
                  styles.optionPressed,
              ]}
            >
              {isBrowsingFolders ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Ionicons name="folder-open-outline" color={colors.accent} size={20} />
              )}
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>Choose PC music folders</Text>
                <Text style={styles.optionDescription}>
                  Browse the PC and select which folders appear in your library.
                </Text>
              </View>
              <Ionicons name="chevron-forward" color={colors.muted} size={18} />
            </Pressable>
          )}

          <View style={styles.remoteActions}>
            {remoteConnection ? (
              <>
                <Pressable
                  disabled={isRemoteBusy}
                  onPress={sync}
                  style={({ pressed }) => [
                    styles.remotePrimaryButton,
                    (pressed || isRemoteBusy) && styles.optionPressed,
                  ]}
                >
                  {isRemoteBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.remotePrimaryText}>Sync library</Text>
                  )}
                </Pressable>
                <Pressable
                  disabled={isRemoteBusy}
                  onPress={async () => {
                    try {
                      await onRemoteTest();
                      Alert.alert("Connection works", "The PC companion is reachable.");
                    } catch (error) {
                      Alert.alert(
                        "PC unavailable",
                        error instanceof Error ? error.message : "Try again later.",
                      );
                    }
                  }}
                  style={({ pressed }) => [
                    styles.remoteSecondaryButton,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Text style={styles.remoteSecondaryText}>Test</Text>
                </Pressable>
                <Pressable
                  disabled={isRemoteBusy}
                  onPress={() =>
                    Alert.alert(
                      "Disconnect PC?",
                      "Remote tracks will be removed from this device and its playlists.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Disconnect",
                          style: "destructive",
                          onPress: () => void disconnect(),
                        },
                      ],
                    )
                  }
                  style={({ pressed }) => [
                    styles.remoteSecondaryButton,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Text style={styles.remoteDangerText}>Disconnect</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                disabled={isRemoteBusy || !remoteUrl.trim() || pairingCode.length !== 6}
                onPress={connect}
                style={({ pressed }) => [
                  styles.remotePrimaryButton,
                  (pressed ||
                    isRemoteBusy ||
                    !remoteUrl.trim() ||
                    pairingCode.length !== 6) &&
                    styles.optionPressed,
                ]}
              >
                {isRemoteBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.remotePrimaryText}>Connect and sync</Text>
                )}
              </Pressable>
            )}
          </View>
        </AccordionSection>

        <AccordionSection
          description="Song and file details"
          icon="library-outline"
          title="Library"
        >
          <Text style={styles.eyebrow}>LIBRARY</Text>
          <Text style={styles.sectionTitle}>File details</Text>
          <Text style={styles.subtitle}>
            Choose whether file types appear beside songs throughout the app.
          </Text>

          <View style={styles.toggleCard}>
            <View style={styles.optionIcon}>
              <Ionicons
                name="document-text-outline"
                color={colors.accent}
                size={21}
              />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Show file type</Text>
              <Text style={styles.optionDescription}>
                {showFileType ? "Shown throughout app" : "Hidden throughout app"}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Show file type throughout the app"
              accessibilityState={{ checked: showFileType }}
              onValueChange={onShowFileTypeChange}
              trackColor={{ false: colors.border, true: colors.switchTrack }}
              thumbColor={showFileType ? colors.accent : "#fff"}
              value={showFileType}
            />
          </View>
        </AccordionSection>

        <AccordionSection
          description="Player placement"
          icon="list-outline"
          title="Playlist"
        >
        <Text style={styles.eyebrow}>PLAYLIST</Text>
        <Text style={styles.sectionTitle}>Player position</Text>
        <Text style={styles.subtitle}>
          Choose where the music player stays while you scroll the playlist.
        </Text>

        <View
          accessibilityRole="radiogroup"
          style={styles.options}
        >
          {positionOptions.map((option) => {
            const isSelected = playerPosition === option.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked: isSelected }}
                key={option.value}
                onPress={() => onPlayerPositionChange(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
              >
                <View
                  style={[
                    styles.optionIcon,
                    isSelected && styles.optionIconSelected,
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    color={isSelected ? "#fff" : colors.accent}
                    size={21}
                  />
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionDescription}>
                    {option.description}
                  </Text>
                </View>
                <Ionicons
                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                  color={isSelected ? colors.accent : colors.muted}
                  size={23}
                />
              </Pressable>
            );
          })}
        </View>
        </AccordionSection>

        <AccordionSection
          description="Visualization and colors"
          icon="musical-notes-outline"
          title="Now Playing"
        >
          <Text style={styles.eyebrow}>NOW PLAYING</Text>
          <Text style={styles.sectionTitle}>Visualization</Text>
          <Text style={styles.subtitle}>
            Animate the player artwork area while a song without album art is
            playing.
          </Text>

          <View style={styles.toggleCard}>
            <View style={styles.optionIcon}>
              <Ionicons
                name="pulse-outline"
                color={colors.accent}
                size={21}
              />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>Music visualization</Text>
              <Text style={styles.optionDescription}>
                {visualizationEnabled ? "Enabled" : "Disabled"}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Music visualization"
              accessibilityState={{ checked: visualizationEnabled }}
              onValueChange={onVisualizationEnabledChange}
              trackColor={{ false: colors.border, true: colors.switchTrack }}
              thumbColor={visualizationEnabled ? colors.accent : "#fff"}
              value={visualizationEnabled}
            />
          </View>

          <Text style={styles.controlLabel}>EFFECT</Text>
          <View accessibilityRole="radiogroup" style={styles.effectOptions}>
            {visualizationEffects.map((effect) => {
              const isSelected = visualizationEffect === effect.value;
              return (
                <Pressable
                  accessibilityLabel={`${effect.label} visualization`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={effect.value}
                  onPress={() => onVisualizationEffectChange(effect.value)}
                  style={({ pressed }) => [
                    styles.effectOption,
                    isSelected && styles.effectOptionSelected,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Ionicons
                    color={isSelected ? "#fff" : colors.accent}
                    name={effect.icon}
                    size={23}
                  />
                  <Text
                    style={[
                      styles.effectLabel,
                      isSelected && styles.effectLabelSelected,
                    ]}
                  >
                    {effect.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.controlLabel}>BACKGROUND IMAGE</Text>
          <View style={styles.backgroundCard}>
            {visualizationBackgroundImage ? (
              <Image
                accessibilityLabel="Custom visualization background"
                resizeMode="cover"
                source={{ uri: visualizationBackgroundImage }}
                style={styles.backgroundPreview}
              />
            ) : (
              <View style={styles.backgroundPlaceholder}>
                <Ionicons
                  name="image-outline"
                  color={colors.secondaryText}
                  size={26}
                />
              </View>
            )}
            <View style={styles.backgroundActions}>
              <Pressable
                accessibilityRole="button"
                onPress={onVisualizationBackgroundImageChoose}
                style={({ pressed }) => [
                  styles.backgroundButton,
                  pressed && styles.optionPressed,
                ]}
              >
                <Ionicons
                  name="folder-open-outline"
                  color={colors.accent}
                  size={18}
                />
                <Text style={styles.backgroundButtonText}>
                  {visualizationBackgroundImage ? "Change image" : "Choose image"}
                </Text>
              </Pressable>
              {visualizationBackgroundImage && (
                <Pressable
                  accessibilityRole="button"
                  onPress={onVisualizationBackgroundImageRemove}
                  style={({ pressed }) => [
                    styles.removeBackgroundButton,
                    pressed && styles.optionPressed,
                  ]}
                >
                  <Text style={styles.removeBackgroundText}>Remove</Text>
                </Pressable>
              )}
            </View>
          </View>

          <Text style={styles.controlLabel}>PRIMARY COLOR</Text>
          <View style={styles.colorOptions}>
            {visualizationColors.map((color) => (
              <ColorOption
                color={color}
                isSelected={visualizationPrimaryColor === color}
                key={`primary-${color}`}
                label="primary"
                onPress={() => onVisualizationPrimaryColorChange(color)}
              />
            ))}
          </View>

          <Text style={styles.controlLabel}>SECONDARY COLOR</Text>
          <View style={styles.colorOptions}>
            {visualizationColors.map((color) => (
              <ColorOption
                color={color}
                isSelected={visualizationSecondaryColor === color}
                key={`secondary-${color}`}
                label="secondary"
                onPress={() => onVisualizationSecondaryColorChange(color)}
              />
            ))}
          </View>
        </AccordionSection>
      </ScrollView>
    </View>
  );
}

function AccordionSection({
  children,
  description,
  icon,
  initiallyExpanded = false,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  initiallyExpanded?: boolean;
  title: string;
}) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.accordion}>
      <Pressable
        accessibilityHint={`${isExpanded ? "Collapses" : "Expands"} ${title} settings`}
        accessibilityLabel={`${title} settings`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setIsExpanded((expanded) => !expanded)}
        style={({ pressed }) => [
          styles.accordionHeader,
          pressed && styles.buttonPressed,
        ]}
      >
        <View style={styles.accordionIcon}>
          <Ionicons color={colors.accent} name={icon} size={21} />
        </View>
        <View style={styles.accordionHeading}>
          <Text style={styles.accordionTitle}>{title}</Text>
          <Text style={styles.accordionDescription}>{description}</Text>
        </View>
        <Ionicons
          color={colors.secondaryText}
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={20}
        />
      </Pressable>
      {isExpanded && <View style={styles.accordionBody}>{children}</View>}
    </View>
  );
}

function AccentOption({
  color,
  isSelected,
  onPress,
}: {
  color: AccentColor;
  isSelected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={`Use ${color} as app accent color`}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      onPress={onPress}
      style={[
        {
          alignItems: "center",
          borderColor: isSelected ? colors.text : "transparent",
          borderRadius: 22,
          borderWidth: 2,
          height: 40,
          justifyContent: "center",
          width: 40,
        },
      ]}
    >
      <View style={[stylesStatic.accentSwatch, { backgroundColor: color }]}>
        {isSelected && <Ionicons color="#fff" name="checkmark" size={18} />}
      </View>
    </Pressable>
  );
}

function ColorOption({
  color,
  isSelected,
  label,
  onPress,
}: {
  color: string;
  isSelected: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityLabel={`Use ${color} as ${label} visualization color`}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.colorOption,
        isSelected && styles.colorOptionSelected,
        pressed && styles.optionPressed,
      ]}
    >
      <View style={[styles.colorSwatch, { backgroundColor: color }]}>
        {isSelected && (
          <Ionicons
            color={color === "#ffffff" ? "#1d1d1f" : "#fff"}
            name="checkmark"
            size={18}
          />
        )}
      </View>
    </Pressable>
  );
}

const stylesStatic = StyleSheet.create({
  accentSwatch: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
});

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
  buttonPressed: {
    backgroundColor: colors.accentSoft,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  content: {
    alignSelf: "center",
    gap: 12,
    padding: 22,
    paddingBottom: 32,
    paddingTop: 30,
    width: "100%",
    maxWidth: 560,
  },
  accordion: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  accordionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  accordionIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  accordionHeading: {
    flex: 1,
  },
  accordionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  accordionDescription: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 3,
  },
  accordionBody: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 18,
    paddingTop: 20,
  },
  themeOptions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  themeOption: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 15,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
  },
  themeOptionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  themeOptionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  themeOptionTextSelected: {
    color: "#fff",
  },
  accentOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  sectionTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.6,
    marginTop: 5,
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  options: {
    gap: 10,
    marginTop: 24,
  },
  option: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "transparent",
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: 12,
    minHeight: 78,
    padding: 14,
  },
  optionSelected: {
    borderColor: colors.accent,
  },
  optionPressed: {
    opacity: 0.72,
  },
  optionIcon: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  optionIconSelected: {
    backgroundColor: colors.accent,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  optionDescription: {
    color: colors.secondaryText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  toggleCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
    minHeight: 78,
    padding: 14,
  },
  connectionGuideButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
    minHeight: 72,
    padding: 13,
  },
  remoteInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  folderBrowseButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    minHeight: 72,
    padding: 13,
  },
  folderBrowser: {
    backgroundColor: colors.background,
    flex: 1,
  },
  folderBrowserHeader: {
    alignItems: "center",
    backgroundColor: colors.header,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 12,
  },
  folderBrowserTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  folderPathBar: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 16,
  },
  folderUpButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  folderCurrentPath: {
    color: colors.secondaryText,
    flex: 1,
    fontSize: 12,
  },
  folderList: {
    gap: 8,
    padding: 16,
  },
  folderRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  folderSelectButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    marginLeft: 12,
    width: 34,
  },
  folderSelectButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  folderOpenButton: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 70,
    padding: 12,
  },
  folderText: {
    flex: 1,
  },
  folderName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  folderLocation: {
    color: colors.secondaryText,
    fontSize: 10,
    marginTop: 3,
  },
  folderBrowserFooter: {
    alignItems: "center",
    backgroundColor: colors.header,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  folderSelectionCount: {
    color: colors.secondaryText,
    flex: 1,
    fontSize: 12,
  },
  remoteStatus: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 14,
  },
  remoteError: {
    color: "#b42318",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  remoteActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 18,
  },
  remotePrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 130,
    paddingHorizontal: 16,
  },
  remotePrimaryText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  remoteSecondaryButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 15,
  },
  remoteSecondaryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  remoteDangerText: {
    color: "#b42318",
    fontSize: 13,
    fontWeight: "700",
  },
  controlLabel: {
    color: colors.secondaryText,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 9,
    marginTop: 24,
  },
  effectOptions: {
    flexDirection: "row",
    gap: 9,
  },
  effectOption: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "transparent",
    borderRadius: 14,
    borderWidth: 1.5,
    flex: 1,
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 13,
  },
  effectOptionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  effectLabel: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: "700",
  },
  effectLabelSelected: {
    color: "#fff",
  },
  colorOptions: {
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between",
  },
  colorOption: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 22,
    borderWidth: 2,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  colorOptionSelected: {
    borderColor: colors.accent,
  },
  colorSwatch: {
    alignItems: "center",
    borderColor: "rgba(0,0,0,0.12)",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  backgroundCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    flexDirection: "row",
    gap: 13,
    padding: 12,
  },
  backgroundPreview: {
    borderRadius: 11,
    height: 64,
    width: 84,
  },
  backgroundPlaceholder: {
    alignItems: "center",
    backgroundColor: colors.elevated,
    borderRadius: 11,
    height: 64,
    justifyContent: "center",
    width: 84,
  },
  backgroundActions: {
    alignItems: "flex-start",
    flex: 1,
    gap: 7,
  },
  backgroundButton: {
    alignItems: "center",
    borderRadius: 9,
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 7,
  },
  backgroundButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  removeBackgroundButton: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  removeBackgroundText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: "600",
  },
});
