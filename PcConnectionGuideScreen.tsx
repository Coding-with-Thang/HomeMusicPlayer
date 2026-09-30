import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { type ThemeColors, useTheme } from "./theme";

type PcConnectionGuideScreenProps = {
  onBack: () => void;
};

const steps = [
  {
    icon: "download-outline" as const,
    title: "Start the PC companion",
    description:
      "On your Windows PC, open the companion folder in a terminal, run npm install, then run npm start.",
    command: "cd companion\nnpm install\nnpm start",
  },
  {
    icon: "shield-checkmark-outline" as const,
    title: "Finish first-time setup",
    description:
      "Copy the one-time setup code from the terminal. Open http://127.0.0.1:47831 on the PC, enter the code, and create an admin password.",
  },
  {
    icon: "git-network-outline" as const,
    title: "Connect through Tailscale",
    description:
      "Install Tailscale on the PC and phone, then sign in to the same tailnet on both devices.",
  },
  {
    icon: "terminal-outline" as const,
    title: "Enable private HTTPS",
    description:
      "Open PowerShell as Administrator on the PC and run this command:",
    command: "tailscale serve --bg 47832",
  },
  {
    icon: "key-outline" as const,
    title: "Generate a pairing code",
    description:
      "Return to the companion admin page and generate a six-digit pairing code. The page also shows the private https://*.ts.net address.",
  },
  {
    icon: "phone-portrait-outline" as const,
    title: "Connect this phone",
    description:
      "Go back to PC streaming, enter the Tailscale HTTPS address and pairing code, then select Connect and sync.",
  },
] as const;

export function PcConnectionGuideScreen({
  onBack,
}: PcConnectionGuideScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
          onPress={onBack}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Ionicons name="chevron-back" color={colors.accent} size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Connect to PC</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="desktop-outline" color="#fff" size={34} />
          </View>
          <Text style={styles.title}>Play music from your PC</Text>
          <Text style={styles.subtitle}>
            Set up the Windows companion and connect privately through
            Tailscale. Keep your PC on while streaming.
          </Text>
        </View>

        <View style={styles.steps}>
          {steps.map((step, index) => (
            <View key={step.title} style={styles.stepCard}>
              <View style={styles.stepRail}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                {index < steps.length - 1 && <View style={styles.stepLine} />}
              </View>
              <View style={styles.stepBody}>
                <View style={styles.stepHeading}>
                  <Ionicons name={step.icon} color={colors.accent} size={20} />
                  <Text style={styles.stepTitle}>{step.title}</Text>
                </View>
                <Text style={styles.stepDescription}>{step.description}</Text>
                {"command" in step && (
                  <View style={styles.commandBox}>
                    <Text selectable style={styles.commandText}>
                      {step.command}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.securityNote}>
          <Ionicons
            name="lock-closed-outline"
            color={colors.accent}
            size={20}
          />
          <View style={styles.securityText}>
            <Text style={styles.securityTitle}>Private by default</Text>
            <Text style={styles.securityDescription}>
              Use Tailscale Serve, not Funnel. The companion should remain
              bound to 127.0.0.1 and is available only to your tailnet.
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.doneButton,
            pressed && styles.doneButtonPressed,
          ]}
        >
          <Text style={styles.doneButtonText}>Enter connection details</Text>
          <Ionicons name="arrow-forward" color="#fff" size={19} />
        </Pressable>
      </ScrollView>
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
    buttonPressed: {
      backgroundColor: colors.elevated,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    content: {
      alignSelf: "center",
      maxWidth: 600,
      paddingBottom: 32,
      paddingHorizontal: 18,
      width: "100%",
    },
    hero: {
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 26,
    },
    heroIcon: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 32,
      height: 64,
      justifyContent: "center",
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 7 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      width: 64,
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "700",
      letterSpacing: -0.7,
      marginTop: 16,
      textAlign: "center",
    },
    subtitle: {
      color: colors.secondaryText,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 7,
      textAlign: "center",
    },
    steps: {
      gap: 10,
    },
    stepCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      padding: 15,
    },
    stepRail: {
      alignItems: "center",
      marginRight: 13,
    },
    stepNumber: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 15,
      height: 30,
      justifyContent: "center",
      width: 30,
    },
    stepNumberText: {
      color: "#fff",
      fontSize: 13,
      fontWeight: "800",
    },
    stepLine: {
      backgroundColor: colors.border,
      flex: 1,
      marginTop: 8,
      width: 2,
    },
    stepBody: {
      flex: 1,
      paddingBottom: 2,
    },
    stepHeading: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      minHeight: 30,
    },
    stepTitle: {
      color: colors.text,
      flex: 1,
      fontSize: 15,
      fontWeight: "700",
    },
    stepDescription: {
      color: colors.secondaryText,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 5,
    },
    commandBox: {
      backgroundColor: colors.elevated,
      borderRadius: 10,
      marginTop: 11,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    commandText: {
      color: colors.text,
      fontFamily: "monospace",
      fontSize: 12,
      lineHeight: 18,
    },
    securityNote: {
      backgroundColor: colors.accentSoft,
      borderRadius: 15,
      flexDirection: "row",
      gap: 11,
      marginTop: 18,
      padding: 15,
    },
    securityText: {
      flex: 1,
    },
    securityTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    securityDescription: {
      color: colors.secondaryText,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 3,
    },
    doneButton: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 14,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      marginTop: 18,
      minHeight: 50,
      paddingHorizontal: 18,
    },
    doneButtonPressed: {
      backgroundColor: colors.accentPressed,
    },
    doneButtonText: {
      color: "#fff",
      fontSize: 15,
      fontWeight: "700",
    },
  });
