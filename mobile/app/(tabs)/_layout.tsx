import { Redirect, Tabs, router } from "expo-router";
import type { ComponentProps } from "react";
import { View, ActivityIndicator, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

const TAB_ICONS: Record<string, string> = {
  index: "⌂",
  customers: "👥",
  jobs: "🔔",
  payouts: "£",
};
const TAB_LABELS: Record<string, string> = {
  index: "Home",
  customers: "Customers",
  jobs: "Reminders",
  payouts: "Payouts",
};
const VISIBLE_TABS = ["index", "customers", "jobs", "payouts"];

// The real BottomTabBarProps type, extracted structurally from Tabs' own
// `tabBar` prop rather than imported from @react-navigation/bottom-tabs —
// that package isn't a direct dependency here (only reachable transitively
// through expo-router) and isn't a reliably resolvable import path; see
// mobile/CLAUDE.md's note on packages that need to be direct deps to
// resolve reliably. This sidesteps needing the import at all.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Custom tab bar so the "offer" FAB gets a real, reserved flex slot between
// Customers and Reminders instead of floating absolutely-centered over a
// 4-item bar — which put it dead on the boundary between those two tabs,
// overlapping both (the bug this replaced).
function CustomTabBar({ state, navigation }: TabBarProps) {
  const routes = state.routes.filter((r) => VISIBLE_TABS.includes(r.name));
  const activeName = state.routes[state.index]?.name;
  const leftTabs = routes.slice(0, 2);
  const rightTabs = routes.slice(2);

  function renderTab(route: { key: string; name: string }) {
    const focused = route.name === activeName;
    const color = focused ? "#5FA3F0" : "#6E86A3";
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        className="flex-1 items-center justify-center gap-0.5 py-1.5"
      >
        <Text style={{ fontSize: 18, color }}>{TAB_ICONS[route.name]}</Text>
        <Text style={{ fontSize: 10, fontWeight: "600", color }}>{TAB_LABELS[route.name]}</Text>
      </Pressable>
    );
  }

  return (
    <View
      style={{
        backgroundColor: "rgba(8,19,33,0.97)",
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.10)",
      }}
    >
      <SafeAreaView edges={["bottom"]}>
        <View className="flex-row items-center px-2 pt-1">
          {leftTabs.map(renderTab)}
          {/* Reserved slot for the FAB — a real flex child sized like the
              other tabs, so it can never sit on top of one. */}
          <View className="flex-1 items-center justify-center">
            <Pressable
              onPress={() => router.push("/offer")}
              className="h-14 w-14 items-center justify-center rounded-full bg-white"
              style={{
                marginTop: -30,
                elevation: 6,
                shadowColor: "#000",
                shadowOpacity: 0.5,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Text className="text-[26px] leading-none text-on-light">+</Text>
            </Pressable>
          </View>
          {rightTabs.map(renderTab)}
        </View>
      </SafeAreaView>
    </View>
  );
}

export default function TabsLayout() {
  const { token, loading, me, meLoading, meError, stripeSkipped, refreshMe, signOut } = useAuth();

  if (loading) return null;
  // W0 — signed-out users land on the welcome screen, not straight on
  // sign-in; it decides for itself whether to promote Sign in (returning
  // device) or Start now (organic/claim/referral).
  if (!token) return <Redirect href="/welcome" />;

  if (meLoading && !me) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#5FA3F0" />
      </View>
    );
  }

  if (meError && !me) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-6">
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
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="customers" options={{ title: "Customers" }} />
      <Tabs.Screen name="jobs" options={{ title: "Reminders" }} />
      <Tabs.Screen name="payouts" options={{ title: "Payouts" }} />
      {/* Reachable from the money card, More hub and onboarding — not a tab slot. */}
      <Tabs.Screen name="plans" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
    </Tabs>
  );
}
