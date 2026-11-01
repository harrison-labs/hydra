import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export default function useVoteBounce() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const bounce = () => {
    scale.value = withSequence(
      withTiming(1.2, { duration: 75 }),
      withSpring(1),
    );
  };
  return { style, bounce };
}
