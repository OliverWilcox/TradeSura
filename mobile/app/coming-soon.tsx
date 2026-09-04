import { View, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Pill } from "@/components/ui";

// RN port of ../../components/ui.tsx's ComingSoon — used for P1/P2 screens
// that aren't in the mobile P0 scope (CLAUDE.md scope fence).
export default function ComingSoon() {
  const { title } = useLocalSearchParams<{ title?: string }>();
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
      <Text className="font-bold text-3xl uppercase tracking-wide text-ink">
        {title ?? "Coming soon"}
      </Text>
      <Pill tone="info">COMING SOON</Pill>
      <Text className="max-w-[32ch] text-center font-sans text-sm text-muted">
        This part of TradeSura arrives in the next release.
      </Text>
      <Button variant="ghost" onPress={() => router.back()}>
        Back
      </Button>
    </View>
  );
}
