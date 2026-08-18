import { Redirect, Tabs, router } from "expo-router";
import { View, ActivityIndicator, Text, Pressable } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

export default function TabsLayout() {
  const { token, loading, me, meLoading, meError, gcSkipped, refreshMe, signOut } = useAuth();

  if (loading) return null;
  if (!token) return <Redirect href="/sign-in" />;

  if (meLoading && !me) {
    return (
      <View className="flex-1 items-center justify-center bg-panel">
        <ActivityIndicator color="#0E7FD0" />
      </View>
    );
  }

  if (meError && !me) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="font-sans text-sm text-danger">{meError}</Text>
        <Button onPress={refreshMe} variant="ghost" className="w-full">
          Try again
        </Button>
        <Button onPress={signOut} variant="ghost" className="w-full">
          Sign out
        </Button>
      </View>
    );
  }

  // Gas Safe verification (and name/trading name/business info) now happen
  // pre-account in the sign-up wizard, so the only remaining post-signup gate
  // is connecting Direct Debit — skippable for now via onboarding.tsx while
  // GC sandbox credentials aren't wired up (see gcSkipped in auth-context).
  if (me && !me.gcConnected && !gcSkipped) return <Redirect href="/onboarding" />;

  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#0A62A3",
          tabBarInactiveTintColor: "#8B95A1",
          tabBarStyle: { borderTopColor: "#D9DEE4" },
          tabBarLabelStyle: {
            fontFamily: "IBMPlexMono_500Medium",
            fontSize: 10,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="customers" options={{ title: "Customers" }} />
        <Tabs.Screen name="plans" options={{ title: "Plans" }} />
        <Tabs.Screen name="jobs" options={{ title: "Jobs" }} />
        <Tabs.Screen name="more" options={{ title: "More" }} />
      </Tabs>
      {/* Raised quick-action, overlaid on the tab bar rather than replacing a
          tab slot — the doorstep flow is the app's primary action (see the
          design spec's Screen 04 notes), so it stays one tap away from every
          tab, not just Home. */}
      <Pressable
        onPress={() => router.push("/offer")}
        className="absolute bottom-[30px] h-16 w-16 items-center justify-center self-center rounded-full bg-copper shadow-lg"
        style={{ elevation: 6 }}
      >
        <Text className="text-[28px] leading-none text-white">+</Text>
      </Pressable>
    </View>
  );
}
