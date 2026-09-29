import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance } from "react-native";

export type ThemeMode = "light" | "dark";

export const ACCENT_COLORS = [
  "#fa2d48",
  "#ff7a00",
  "#ffd60a",
  "#30b85a",
  "#007aff",
  "#5856d6",
  "#af52de",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export type ThemeColors = {
  accent: AccentColor;
  accentPressed: string;
  accentSoft: string;
  background: string;
  border: string;
  elevated: string;
  header: string;
  muted: string;
  playbackControlBackground: string;
  playbackControlBorder: string;
  progressTrack: string;
  secondaryText: string;
  surface: string;
  switchTrack: string;
  text: string;
};

type ThemeContextValue = {
  colors: ThemeColors;
  mode: ThemeMode;
  setAccent: (accent: AccentColor) => void;
  setMode: (mode: ThemeMode) => void;
};

const THEME_MODE_KEY = "home-audio-player.theme-mode.v1";
const ACCENT_COLOR_KEY = "home-audio-player.accent-color.v1";
const DEFAULT_ACCENT: AccentColor = "#fa2d48";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function withAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

function createColors(mode: ThemeMode, accent: AccentColor): ThemeColors {
  const dark = mode === "dark";
  return {
    accent,
    accentPressed: withAlpha(accent, "cc"),
    accentSoft: withAlpha(accent, dark ? "2e" : "14"),
    background: dark ? "#0f0f10" : "#f5f5f7",
    border: dark ? "#38383a" : "#e5e5ea",
    elevated: dark ? "#2c2c2e" : "#f2f2f7",
    header: dark ? "#1c1c1e" : "#ffffff",
    muted: dark ? "#8e8e93" : "#aeaeb2",
    playbackControlBackground: dark ? "#242426" : "transparent",
    playbackControlBorder: dark ? "#48484a" : "transparent",
    progressTrack: dark ? "#48484a" : "#dedee3",
    secondaryText: dark ? "#aeaeb2" : "#6e6e73",
    surface: dark ? "#1c1c1e" : "#ffffff",
    switchTrack: withAlpha(accent, "80"),
    text: dark ? "#f5f5f7" : "#1d1d1f",
  };
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [accent, setAccentState] = useState<AccentColor>(DEFAULT_ACCENT);

  useEffect(() => {
    Appearance.setColorScheme(mode);
  }, [mode]);

  useEffect(() => {
    AsyncStorage.multiGet([THEME_MODE_KEY, ACCENT_COLOR_KEY])
      .then((entries) => {
        const stored = new Map(entries);
        const storedMode = stored.get(THEME_MODE_KEY);
        const storedAccent = stored.get(ACCENT_COLOR_KEY);
        if (storedMode === "light" || storedMode === "dark") {
          setModeState(storedMode);
        }
        if (
          storedAccent &&
          ACCENT_COLORS.includes(storedAccent as AccentColor)
        ) {
          setAccentState(storedAccent as AccentColor);
        }
      })
      .catch(() => {
        // Keep the defaults if saved appearance settings cannot be loaded.
      });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: createColors(mode, accent),
      mode,
      setAccent: (nextAccent) => {
        setAccentState(nextAccent);
        AsyncStorage.setItem(ACCENT_COLOR_KEY, nextAccent).catch(() => {});
      },
      setMode: (nextMode) => {
        setModeState(nextMode);
        AsyncStorage.setItem(THEME_MODE_KEY, nextMode).catch(() => {});
      },
    }),
    [accent, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
