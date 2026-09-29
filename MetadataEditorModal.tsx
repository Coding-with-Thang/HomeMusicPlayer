import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  EditableTrackMetadata,
  LocalTrack,
} from './useLocalAudioPlayer';
import { type ThemeColors, useTheme } from './theme';

type MetadataEditorModalProps = {
  onClose: () => void;
  onSave: (
    uri: string,
    metadata: EditableTrackMetadata
  ) => Promise<LocalTrack>;
  track: LocalTrack;
};

type MetadataForm = {
  album: string;
  artist: string;
  genre: string;
  name: string;
  track: string;
  year: string;
};

function metadataFormForTrack(track: LocalTrack): MetadataForm {
  return {
    album: track.album ?? '',
    artist: track.artist === 'Unknown Artist' ? '' : track.artist,
    genre: track.genre ?? '',
    name: track.name,
    track: track.track ? String(track.track) : '',
    year: track.year ? String(track.year) : '',
  };
}

export function MetadataEditorModal({
  onClose,
  onSave,
  track,
}: MetadataEditorModalProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [form, setForm] = useState<MetadataForm>(() =>
    metadataFormForTrack(track)
  );
  const [isSaving, setIsSaving] = useState(false);

  const updateField = (field: keyof MetadataForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    if (isSaving) {
      return;
    }

    const year = form.year.trim() ? Number(form.year) : undefined;
    const trackNumber = form.track.trim() ? Number(form.track) : undefined;
    if (
      (year !== undefined && (!Number.isInteger(year) || year < 0)) ||
      (trackNumber !== undefined &&
        (!Number.isInteger(trackNumber) || trackNumber < 1))
    ) {
      Alert.alert(
        'Check metadata',
        'Year must be a positive whole number and track must be 1 or greater.'
      );
      return;
    }

    try {
      setIsSaving(true);
      await onSave(track.uri, {
        album: form.album,
        artist: form.artist,
        genre: form.genre,
        name: form.name,
        track: trackNumber,
        year,
      });
      onClose();
      Alert.alert(
        'Metadata saved',
        'The tags were written directly to the audio file.'
      );
    } catch (error) {
      Alert.alert(
        'Could not save metadata',
        error instanceof Error
          ? error.message
          : 'The file may be read-only or no longer accessible.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={isSaving ? undefined : onClose}
      presentationStyle="pageSheet"
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>EDIT AUDIO FILE</Text>
              <Text numberOfLines={1} style={styles.title}>
                Metadata
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close metadata editor"
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Ionicons name="close" color={colors.secondaryText} size={23} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.fileName} numberOfLines={1}>
              {track.source === 'remote'
                ? `${track.name}.${track.extension.toLowerCase()} • PC`
                : decodeURIComponent(track.uri.split('/').pop() ?? '')}
            </Text>
            <Text style={styles.note}>
              {track.source === 'remote'
                ? 'Saving writes these tags to the original audio file on your PC.'
                : 'Saving changes the tags in the original file, so other music apps can read them too.'}
            </Text>

            <MetadataField
              autoFocus
              label="Title"
              onChangeText={(value) => updateField('name', value)}
              styles={styles}
              value={form.name}
            />
            <MetadataField
              label="Artist"
              onChangeText={(value) => updateField('artist', value)}
              styles={styles}
              value={form.artist}
            />
            <MetadataField
              label="Album"
              onChangeText={(value) => updateField('album', value)}
              styles={styles}
              value={form.album}
            />
            <MetadataField
              label="Genre"
              onChangeText={(value) => updateField('genre', value)}
              styles={styles}
              value={form.genre}
            />
            <View style={styles.numberRow}>
              <MetadataField
                keyboardType="number-pad"
                label="Year"
                onChangeText={(value) =>
                  updateField('year', value.replace(/\D/g, ''))
                }
                styles={styles}
                value={form.year}
                wrapperStyle={styles.numberField}
              />
              <MetadataField
                keyboardType="number-pad"
                label="Track"
                onChangeText={(value) =>
                  updateField('track', value.replace(/\D/g, ''))
                }
                styles={styles}
                value={form.track}
                wrapperStyle={styles.numberField}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onClose}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.saveButtonPressed,
                isSaving && styles.disabledButton,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="save-outline" color="#fff" size={18} />
              )}
              <Text style={styles.saveText}>
                {isSaving ? 'Writing file…' : 'Save to File'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type MetadataFieldProps = {
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  styles: ReturnType<typeof createStyles>;
  value: string;
  wrapperStyle?: object;
};

function MetadataField({
  autoFocus,
  keyboardType = 'default',
  label,
  onChangeText,
  styles,
  value,
  wrapperStyle,
}: MetadataFieldProps) {
  return (
    <View style={wrapperStyle}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoFocus={autoFocus}
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={`No ${label.toLocaleLowerCase()}`}
        placeholderTextColor={styles.placeholder.color}
        selectTextOnFocus={false}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      backgroundColor: 'rgba(0,0,0,0.42)',
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '92%',
      overflow: 'hidden',
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: colors.border,
      borderRadius: 2,
      height: 4,
      marginTop: 9,
      width: 40,
    },
    header: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 13,
    },
    headerText: {
      flex: 1,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      marginTop: 2,
    },
    closeButton: {
      alignItems: 'center',
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    buttonPressed: {
      backgroundColor: colors.elevated,
    },
    form: {
      gap: 13,
      padding: 18,
    },
    fileName: {
      color: colors.secondaryText,
      fontSize: 12,
      fontWeight: '600',
    },
    note: {
      backgroundColor: colors.accentSoft,
      borderRadius: 10,
      color: colors.accent,
      fontSize: 11,
      lineHeight: 16,
      padding: 10,
    },
    label: {
      color: colors.secondaryText,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginBottom: 5,
      textTransform: 'uppercase',
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      height: 46,
      paddingHorizontal: 12,
    },
    placeholder: {
      color: colors.muted,
    },
    numberRow: {
      flexDirection: 'row',
      gap: 10,
    },
    numberField: {
      flex: 1,
    },
    footer: {
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      padding: 14,
    },
    cancelButton: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      height: 46,
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    cancelText: {
      color: colors.secondaryText,
      fontSize: 14,
      fontWeight: '700',
    },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      flex: 1,
      flexDirection: 'row',
      gap: 7,
      height: 46,
      justifyContent: 'center',
    },
    saveButtonPressed: {
      backgroundColor: colors.accentPressed,
    },
    disabledButton: {
      opacity: 0.72,
    },
    saveText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
    },
  });
