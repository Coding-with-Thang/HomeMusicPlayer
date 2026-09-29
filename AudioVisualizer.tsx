import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";

const BAR_COUNT = 11;
const WAVE_DOT_COUNT = 9;

export type VisualizationEffect = "bars" | "pulse" | "wave";

type AudioVisualizerProps = {
  effect: VisualizationEffect;
  primaryColor: string;
  secondaryColor: string;
};

function BarsVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [bars] = useState(() =>
    Array.from(
      { length: BAR_COUNT },
      (_, index) => new Animated.Value(0.25 + (index % 4) * 0.12),
    ),
  );

  useEffect(() => {
    const animations = bars.map((bar, index) =>
      Animated.sequence([
        Animated.delay(index * 45),
        Animated.loop(
          Animated.sequence([
            Animated.timing(bar, {
              duration: 260 + (index % 5) * 55,
              toValue: 0.95 - (index % 3) * 0.08,
              useNativeDriver: true,
            }),
            Animated.timing(bar, {
              duration: 300 + ((index + 2) % 4) * 65,
              toValue: 0.22 + ((index + 1) % 4) * 0.1,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );

    animations.forEach((animation) => {
      animation.start();
    });

    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [bars]);

  return (
    <View
      accessibilityLabel="Now playing visualization"
      accessibilityRole="image"
      style={styles.container}
    >
      {bars.map((scaleY, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              backgroundColor:
                index % 2 === 0 ? primaryColor : secondaryColor,
              opacity: scaleY,
              transform: [{ scaleY }],
            },
          ]}
        />
      ))}
    </View>
  );
}

function PulseVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(pulse, {
        duration: 1400,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const innerScale = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.72, 1, 0.72],
  });
  const outerScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1.35],
  });
  const outerOpacity = pulse.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [0.75, 0.2, 0],
  });

  return (
    <View
      accessibilityLabel="Pulsing now playing visualization"
      accessibilityRole="image"
      style={styles.pulseContainer}
    >
      <Animated.View
        style={[
          styles.outerPulse,
          {
            borderColor: secondaryColor,
            opacity: outerOpacity,
            transform: [{ scale: outerScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.innerPulse,
          {
            backgroundColor: primaryColor,
            transform: [{ scale: innerScale }],
          },
        ]}
      >
        <View
          style={[styles.pulseCore, { backgroundColor: secondaryColor }]}
        />
      </Animated.View>
    </View>
  );
}

function WaveVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [dots] = useState(() =>
    Array.from(
      { length: WAVE_DOT_COUNT },
      (_, index) => new Animated.Value((index % 3) / 2),
    ),
  );

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.sequence([
        Animated.delay(index * 65),
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              duration: 420,
              toValue: 1,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              duration: 420,
              toValue: 0,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View
      accessibilityLabel="Wave now playing visualization"
      accessibilityRole="image"
      style={styles.waveContainer}
    >
      {dots.map((position, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveDot,
            {
              backgroundColor:
                index % 2 === 0 ? primaryColor : secondaryColor,
              transform: [
                {
                  translateY: position.interpolate({
                    inputRange: [0, 1],
                    outputRange: [28, -28],
                  }),
                },
                {
                  scale: position.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0.72, 1.15, 0.72],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export function AudioVisualizer({
  effect,
  primaryColor,
  secondaryColor,
}: AudioVisualizerProps) {
  if (effect === "pulse") {
    return (
      <PulseVisualizer
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
      />
    );
  }
  if (effect === "wave") {
    return (
      <WaveVisualizer
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
      />
    );
  }
  return (
    <BarsVisualizer
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: 120,
    justifyContent: "center",
  },
  bar: {
    borderRadius: 5,
    height: 96,
    width: 8,
  },
  pulseContainer: {
    alignItems: "center",
    height: 150,
    justifyContent: "center",
  },
  outerPulse: {
    borderRadius: 72,
    borderWidth: 7,
    height: 144,
    position: "absolute",
    width: 144,
  },
  innerPulse: {
    alignItems: "center",
    borderRadius: 50,
    height: 100,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    width: 100,
  },
  pulseCore: {
    borderRadius: 21,
    height: 42,
    opacity: 0.9,
    width: 42,
  },
  waveContainer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    height: 120,
    justifyContent: "center",
  },
  waveDot: {
    borderRadius: 9,
    height: 18,
    width: 18,
  },
});
