import { Ionicons } from "@expo/vector-icons";
import { Image, View } from "react-native";

import { useTheme } from "./theme";
import type { LocalTrack } from "./useLocalAudioPlayer";

type TrackArtworkProps = {
  borderRadius?: number;
  remoteToken: string | null;
  size?: number;
  track: LocalTrack;
};

export function TrackArtwork({
  borderRadius = 10,
  remoteToken,
  size = 42,
  track,
}: TrackArtworkProps) {
  const { colors } = useTheme();
  const source = track.artwork
    ? {
        uri: track.artwork,
        ...(track.source === "remote" && remoteToken
          ? { headers: { Authorization: `Bearer ${remoteToken}` } }
          : {}),
      }
    : null;

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.accent,
        borderRadius,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {source ? (
        <Image
          accessibilityIgnoresInvertColors
          accessibilityLabel={`Artwork for ${track.name}`}
          resizeMode="cover"
          source={source}
          style={{ height: size, width: size }}
        />
      ) : (
        <Ionicons
          name="musical-note"
          color="#fff"
          size={Math.max(18, Math.round(size * 0.46))}
        />
      )}
    </View>
  );
}
