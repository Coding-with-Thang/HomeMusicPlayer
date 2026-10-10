import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

const BAR_COUNT = 11;
const WAVE_DOT_COUNT = 9;
const SPECTRUM_BAR_COUNT = 15;
const KALEIDOSCOPE_PETAL_COUNT = 10;

export type VisualizationEffect =
  | "bars"
  | "pulse"
  | "wave"
  | "spectrum"
  | "orbit"
  | "kaleidoscope";

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

function SpectrumVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [levels] = useState(() =>
    Array.from(
      { length: SPECTRUM_BAR_COUNT },
      (_, index) => new Animated.Value(0.25 + (index % 5) * 0.1),
    ),
  );

  useEffect(() => {
    const animations = levels.map((level, index) =>
      Animated.sequence([
        Animated.delay(Math.abs(7 - index) * 32),
        Animated.loop(
          Animated.sequence([
            Animated.timing(level, {
              duration: 220 + (index % 4) * 45,
              easing: Easing.inOut(Easing.sin),
              toValue: 1,
              useNativeDriver: true,
            }),
            Animated.timing(level, {
              duration: 260 + ((index + 2) % 5) * 50,
              easing: Easing.inOut(Easing.sin),
              toValue: 0.18 + (index % 3) * 0.11,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [levels]);

  return (
    <View
      accessibilityLabel="Layered spectrum now playing visualization"
      accessibilityRole="image"
      style={styles.spectrumContainer}
    >
      {levels.map((level, index) => (
        <View key={index} style={styles.spectrumColumn}>
          <Animated.View
            style={[
              styles.spectrumBar,
              styles.spectrumBarTop,
              {
                backgroundColor:
                  index % 2 === 0 ? primaryColor : secondaryColor,
                opacity: level,
                transform: [{ scaleY: level }],
              },
            ]}
          />
          <View
            style={[
              styles.spectrumNode,
              {
                backgroundColor:
                  index % 2 === 0 ? secondaryColor : primaryColor,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.spectrumBar,
              styles.spectrumBarBottom,
              {
                backgroundColor:
                  index % 2 === 0 ? primaryColor : secondaryColor,
                opacity: level,
                transform: [{ scaleY: level }],
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function OrbitVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [rotation] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const spinAnimation = Animated.loop(
      Animated.timing(rotation, {
        duration: 6800,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const breathAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    spinAnimation.start();
    breathAnimation.start();
    return () => {
      spinAnimation.stop();
      breathAnimation.stop();
    };
  }, [breath, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseRotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });
  const coreScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1.12],
  });

  return (
    <View
      accessibilityLabel="Orbiting now playing visualization"
      accessibilityRole="image"
      style={styles.orbitContainer}
    >
      <Animated.View
        style={[
          styles.orbitOuter,
          { borderColor: secondaryColor, transform: [{ rotate }] },
        ]}
      >
        <View style={[styles.orbitPlanet, { backgroundColor: primaryColor }]} />
        <View
          style={[
            styles.orbitPlanet,
            styles.orbitPlanetOpposite,
            { backgroundColor: secondaryColor },
          ]}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.orbitInner,
          { borderColor: primaryColor, transform: [{ rotate: reverseRotate }] },
        ]}
      >
        <View
          style={[styles.orbitMoon, { backgroundColor: secondaryColor }]}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.orbitCore,
          {
            backgroundColor: primaryColor,
            shadowColor: primaryColor,
            transform: [{ scale: coreScale }],
          },
        ]}
      >
        <View style={[styles.orbitCoreInner, { backgroundColor: secondaryColor }]} />
      </Animated.View>
    </View>
  );
}

function KaleidoscopeVisualizer({
  primaryColor,
  secondaryColor,
}: Omit<AudioVisualizerProps, "effect">) {
  const [motion] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(motion, {
        duration: 5200,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [motion]);

  const rotate = motion.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseRotate = motion.interpolate({
    inputRange: [0, 1],
    outputRange: ["360deg", "0deg"],
  });
  const pulseScale = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.82, 1.08, 0.82],
  });

  return (
    <View
      accessibilityLabel="Kaleidoscope now playing visualization"
      accessibilityRole="image"
      style={styles.kaleidoscopeContainer}
    >
      <Animated.View
        style={[
          styles.kaleidoscopeLayer,
          { transform: [{ rotate }, { scale: pulseScale }] },
        ]}
      >
        {Array.from({ length: KALEIDOSCOPE_PETAL_COUNT }, (_, index) => (
          <View
            key={index}
            style={[
              styles.petalAnchor,
              { transform: [{ rotate: `${index * 36}deg` }] },
            ]}
          >
            <View
              style={[
                styles.kaleidoscopePetal,
                {
                  backgroundColor:
                    index % 2 === 0 ? primaryColor : secondaryColor,
                },
              ]}
            />
          </View>
        ))}
      </Animated.View>
      <Animated.View
        style={[
          styles.kaleidoscopeDiamond,
          {
            borderColor: secondaryColor,
            transform: [{ rotate: reverseRotate }],
          },
        ]}
      />
      <View
        style={[styles.kaleidoscopeCore, { backgroundColor: primaryColor }]}
      />
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
  if (effect === "spectrum") {
    return (
      <SpectrumVisualizer
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
      />
    );
  }
  if (effect === "orbit") {
    return (
      <OrbitVisualizer
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
      />
    );
  }
  if (effect === "kaleidoscope") {
    return (
      <KaleidoscopeVisualizer
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
  spectrumContainer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 140,
    justifyContent: "center",
  },
  spectrumColumn: {
    alignItems: "center",
    height: 128,
    justifyContent: "center",
    width: 7,
  },
  spectrumBar: {
    borderRadius: 4,
    height: 52,
    position: "absolute",
    width: 6,
  },
  spectrumBarTop: {
    bottom: 66,
    transformOrigin: "bottom",
  },
  spectrumBarBottom: {
    top: 66,
    transformOrigin: "top",
  },
  spectrumNode: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  orbitContainer: {
    alignItems: "center",
    height: 170,
    justifyContent: "center",
  },
  orbitOuter: {
    borderRadius: 80,
    borderWidth: 2,
    height: 160,
    position: "absolute",
    width: 160,
  },
  orbitInner: {
    borderRadius: 53,
    borderWidth: 3,
    height: 106,
    position: "absolute",
    width: 106,
  },
  orbitPlanet: {
    borderRadius: 10,
    height: 20,
    left: 69,
    position: "absolute",
    top: -11,
    width: 20,
  },
  orbitPlanetOpposite: {
    bottom: -8,
    height: 14,
    left: 72,
    top: undefined,
    width: 14,
  },
  orbitMoon: {
    borderRadius: 7,
    height: 14,
    position: "absolute",
    right: -8,
    top: 44,
    width: 14,
  },
  orbitCore: {
    alignItems: "center",
    borderRadius: 30,
    elevation: 8,
    height: 60,
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 15,
    width: 60,
  },
  orbitCoreInner: {
    borderRadius: 11,
    height: 22,
    width: 22,
  },
  kaleidoscopeContainer: {
    alignItems: "center",
    height: 170,
    justifyContent: "center",
  },
  kaleidoscopeLayer: {
    height: 156,
    position: "absolute",
    width: 156,
  },
  petalAnchor: {
    height: 156,
    left: 72,
    position: "absolute",
    top: 0,
    width: 12,
  },
  kaleidoscopePetal: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 12,
    height: 58,
    opacity: 0.72,
    width: 12,
  },
  kaleidoscopeDiamond: {
    borderRadius: 18,
    borderWidth: 4,
    height: 82,
    position: "absolute",
    width: 82,
  },
  kaleidoscopeCore: {
    borderRadius: 13,
    height: 26,
    transform: [{ rotate: "45deg" }],
    width: 26,
  },
});
