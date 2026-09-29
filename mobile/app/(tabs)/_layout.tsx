import { Redirect, Tabs, router } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { View, Text, Pressable, AppState } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button, GateSheet } from "@/components/ui";
import { AddCustomerSheet } from "@/components/add-customer-sheet";
import { CenteredSpinner } from "@/components/skeleton";
import { Icon, type IconName } from "@/components/icon";

// Build Guide v2 Part 3 — the whole map: Home · Customers · Add customer
// (the labelled hero) · Reminders · Payouts. No Plans tab, no More tab — those
// rooms are pushed pages that stack inside the Home tab ((home)/_layout.tsx),
// so the tab bar stays and Home stays lit while you're in them. Icons are
// one native family (Part 2.4), no emoji. Lit state is data-driven — blue
// only on the active tab.
const TAB_ICONS: Record<string, IconName> = {
  "(home)": "home",
  "(customers)": "customers",
  jobs: "reminders",
  payouts: "payouts",
};
const TAB_LABELS: Record<string, string> = {
  "(home)": "Home",
  "(customers)": "Customers",
  jobs: "Reminders",
  payouts: "Payouts",
};
const VISIBLE_TABS = ["(home)", "(customers)", "jobs", "payouts"];

const ACTIVE = "#5FA3F0";
const IDLE = "#6E86A3";

// The real BottomTabBarProps type, extracted structurally from Tabs' own
// `tabBar` prop rather than imported from @react-navigation/bottom-tabs —
// that package isn't a direct dependency here (only reachable transitively
// through expo-router) and isn't a reliably resolvable import path; see
// mobile/CLAUDE.md's note on packages that need to be direct deps to
// resolve reliably. This sidesteps needing the import at all.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Part 3: the Reminders bell wears a red count badge only when items are due
// this week or overdue. Polled from a tiny endpoint on every navigation
// change and on app foreground — zero means no badge, never "0".
function useRemindersBadge(navKey: string) {
  const [due, setDue] = useState(0);
  const load = useCallback(() => {
    api<{ due: number }>("/api/jobs/badge")
      .then((r) => setDue(r.due))
      .catch(() => {
        // Badge is a garnish — a failed poll just leaves the last value.
      });
  }, []);
  useEffect(load, [load, navKey]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") load();
    });
    return () => sub.remove();
  }, [load]);
  return due;
}

// Custom tab bar so the "Add customer" hero gets a real, reserved flex slot
// between Customers and Reminders instead of floating absolutely-centered
// over a 4-item bar — which put it dead on the boundary between those two
// tabs, overlapping both (the bug this replaced).
function CustomTabBar({ state, navigation }: TabBarProps) {
  const { me } = useAuth();
  const [gateOpen, setGateOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const routes = state.routes.filter((r) => VISIBLE_TABS.includes(r.name));
  const active = state.routes[state.index];
  const activeName = active?.name;
  // Re-poll the badge whenever the focused tab or its nested stack moves.
  const nested = active?.state;
  const navKey = `${activeName}:${nested?.index ?? 0}:${nested?.routes?.length ?? 0}`;
  const due = useRemindersBadge(navKey);
  const leftTabs = routes.slice(0, 2);
  const rightTabs = routes.slice(2);

  // Part 6.5 soft gate: the hero wakes with the first live plan. Asleep, it
  // drops to muted but stays the bar's centrepiece — and stays tappable,
  // opening the gate sheet with the reason and the route back.
  const heroAwake = Boolean(me?.hasPlan);

  function renderTab(route: { key: string; name: string }) {
    const focused = route.name === activeName;
    const color = focused ? ACTIVE : IDLE;
    const badge = route.name === "jobs" && due > 0 ? due : 0;
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          // Emitting tabPress with the route key is what lets the nested
          // stack pop to its root when its own tab is tapped again ("tapping
          // Home pops back to the dashboard").
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={badge ? `${TAB_LABELS[route.name]}, ${badge} due` : TAB_LABELS[route.name]}
        className="flex-1 items-center justify-center gap-0.5 py-1.5"
      >
        <View>
          <Icon name={TAB_ICONS[route.name]} size={24} color={color} weight={focused ? "semibold" : "regular"} />
          {badge > 0 && (
            <View
              className="absolute items-center justify-center rounded-full bg-danger px-1"
              style={{ top: -5, right: -9, minWidth: 17, height: 17 }}
            >
              <Text className="text-[10px] font-bold text-white">{badge > 99 ? "99+" : badge}</Text>
            </View>
          )}
        </View>
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
          {/* Reserved slot for the hero — a real flex child sized like the
              other tabs, so it can never sit on top of one. Label beneath,
              white circle, the bar's only filled element. */}
          <View className="flex-1 items-center justify-center gap-0.5 py-1.5">
            <Pressable
              onPress={() => (heroAwake ? setSheetOpen(true) : setGateOpen(true))}
              accessibilityRole="button"
              accessibilityLabel="Add customer"
              accessibilityState={{ disabled: !heroAwake }}
              className="h-14 w-14 items-center justify-center rounded-full bg-white"
              style={{
                marginTop: -30,
                // Per the user's direct ask: the hero stays fully opaque
                // white always — Part 3 calls it "the bar's only filled
                // element" unconditionally. The gate itself (still tappable
                // → gate sheet when !heroAwake) is unchanged; "asleep" is
                // now signalled by the label colour alone (below), not by
                // fading the one white circle in the whole tab bar.
                elevation: 6,
                shadowColor: "#000",
                shadowOpacity: 0.5,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              <Icon name="addCustomer" size={26} color="#0f2140" weight="medium" />
            </Pressable>
            <Text
              style={{ fontSize: 10, fontWeight: "600", color: heroAwake ? "#f3f7fb" : IDLE, marginTop: 2 }}
            >
              Add customer
            </Text>
          </View>
          {rightTabs.map(renderTab)}
        </View>
      </SafeAreaView>
      <GateSheet
        visible={gateOpen}
        onClose={() => setGateOpen(false)}
        reason="Add customers once your first plan is live — Continue setup →"
        onCta={() => router.push("/onboarding")}
      />
      <AddCustomerSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

export default function TabsLayout() {
  const { token, loading, me, meLoading, meError, refreshMe, signOut } = useAuth();

  // The launch overlay (app/_layout.tsx) covers these first moments.
  if (loading) return <View className="flex-1 bg-night" />;
  // W0 — signed-out users land on the welcome screen, not straight on
  // sign-in; it decides for itself whether to promote Sign in (returning
  // device) or Start now (organic/claim/referral).
  if (!token) return <Redirect href="/welcome" />;

  // Straight after sign-in the launch overlay has already gone, so the
  // profile fetch gets the ring rather than a blank navy screen.
  if (meLoading && !me) {
    return (
      <View className="flex-1 bg-night">
        <CenteredSpinner label="Loading your account" />
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

  // Build Guide v2 review 17 Sept, B6 — "The plan builder cannot be started
  // at all... the core action of the product cannot be performed anywhere
  // in this build." Root cause: this used to hard-redirect the ENTIRE
  // (tabs) section — not just Home, every route including /plans and the
  // customer-import screens — back to /onboarding whenever Stripe wasn't
  // yet connected or explicitly skipped. So "Set up my plan" and "Import my
  // book" on the onboarding hub, which both route into (tabs), could never
  // actually land anywhere — the redirect fired before their destination
  // screen ever got a chance to render, for any account that hadn't
  // completed or skipped Stripe first. Confirmed live: navigating straight
  // to /plans on a fresh, Stripe-unconnected account bounced straight back
  // to /onboarding with zero network requests fired — the screen never
  // even mounted. This directly contradicted Part 3's own LAW: "Rooms are
  // never locked; actions are... gating happens on buttons, with a reason
  // and a route" — a blanket screen-level redirect is the one thing that
  // LAW explicitly rules out. The dashboard's "skipped-setup state" (Part
  // 5: "works today — keep it") already renders correctly without Stripe,
  // so removing this gate doesn't leave anything unhandled; the soft-gate
  // sheets (Part 6.5) already gate the specific actions that need gating
  // (My plans, Add customer) on hasPlan, never on Stripe status.
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="(home)" options={{ title: "Home" }} />
      <Tabs.Screen name="(customers)" options={{ title: "Customers" }} />
      <Tabs.Screen name="jobs" options={{ title: "Reminders" }} />
      <Tabs.Screen name="payouts" options={{ title: "Payouts" }} />
    </Tabs>
  );
}
