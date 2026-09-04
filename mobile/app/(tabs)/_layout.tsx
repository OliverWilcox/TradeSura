import { Redirect, Tabs, router } from "expo-router";
import { View, ActivityIndicator, Text, Pressable, type ColorValue } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { token, loading, me, meLoading, meError, stripeSkipped, refreshMe, signOut } = useAuth();

  if (loading) return null;
  if (!token) return <Redirect href="/sign-in" />;

  if (meLoading && !me) {
    return (
      <View className="flex-1 items-center justify-center bg-panel">
        <ActivityIndicator color="#1966CC" />
      </View>
    );
  }

  if (meError && !me) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="text-sm text-danger">{meError}</Text>
        <Button onPress={refreshMe} variant="ghost" className="w-full">
          Try again
        </Button>
        <Button onPress={signOut} variant="ghost" className="w-full">
          Sign out
        </Button>
      </View>
    );
  }

  // The only post-signup gate is Stripe payment onboarding — skippable via
  // onboarding.tsx while Stripe test-mode credentials aren't wired up.
  if (me && !me.stripeConnected && !stripeSkipped) return <Redirect href="/onboarding" />;

  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: "#1966CC",
          tabBarInactiveTintColor: "#5B6B7C",
          tabBarStyle: { borderTopColor: "#E1E8F0", backgroundColor: "#FFFFFF" },
          tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} /> }}
        />
        <Tabs.Screen
          name="customers"
          options={{
            title: "Customers",
            tabBarIcon: ({ color }) => <TabIcon glyph="👥" color={color} />,
          }}
        />
        <Tabs.Screen
          name="jobs"
          options={{
            title: "Reminders",
            tabBarIcon: ({ color }) => <TabIcon glyph="🔔" color={color} />,
          }}
        />
        <Tabs.Screen
          name="payouts"
          options={{
            title: "Payouts",
            tabBarIcon: ({ color }) => <TabIcon glyph="£" color={color} />,
          }}
        />
        {/* Reachable from the money card, More hub and onboarding — not a tab slot. */}
        <Tabs.Screen name="plans" options={{ href: null }} />
        <Tabs.Screen name="more" options={{ href: null }} />
      </Tabs>
      {/* Send an offer — the app's primary action, one tap from every tab. */}
      <Pressable
        onPress={() => router.push("/offer")}
        className="absolute bottom-[26px] h-14 w-14 items-center justify-center self-center rounded-full bg-flame"
        style={{
          elevation: 6,
          shadowColor: "#1966CC",
          shadowOpacity: 0.4,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <Text className="text-[26px] leading-none text-white">+</Text>
      </Pressable>
    </View>
  );
}
