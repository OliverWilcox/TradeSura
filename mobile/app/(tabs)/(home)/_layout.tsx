import { Stack } from "expo-router";

// Build Guide v2 Part 3: pushed pages keep the tab bar with the parent tab
// lit. Everything reachable from Home (My plans, the plan editor, Account,
// Invite, Membership Shop, Messages) stacks inside the Home tab, so Home
// stays blue while you're in it and tapping Home pops back to the dashboard.
export const unstable_settings = { initialRouteName: "index" };

export default function HomeStack() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 220 }}>
      {/* Review 3 P0 — Back in the wizard means the previous step, so the
          swipe-back gesture can't skip out of it. */}
      <Stack.Screen name="plan-wizard" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
