import type { ReactNode } from "react";
import { View, Text, Pressable, Modal, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { Chevron } from "@/components/ui";

// Build Guide v2 Part 9 — "The sheet. Opens over the dimmed dashboard from
// the hero tab. Three routes + a quiet 'Manage plans' link." Per-route
// gating: routes 1 and 2 need the two-leg gate (live plan AND badge); the
// hero itself already guarantees the plan leg (it's only reachable awake),
// so this sheet only needs to add the badge leg. Route 3 has neither
// restriction.
function Row({
  title,
  sub,
  muted,
  onPress,
}: {
  title: string;
  sub: string;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center justify-between gap-2 border-b border-line-soft py-3 last:border-b-0 ${muted ? "opacity-45" : ""}`}
    >
      <View className="shrink">
        <Text className="font-semibold text-sm text-ink">{title}</Text>
        <Text className="mt-0.5 font-sans text-xs text-muted">{sub}</Text>
      </View>
      <Chevron />
    </Pressable>
  );
}

export function AddCustomerSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): ReactNode {
  const { me } = useAuth();
  const badgeGranted = Boolean(me?.gasSafeVerifiedAt);
  // Routes 1-2 end at the customer paying by Direct Debit — if the engineer's
  // Stripe setup isn't finished, the customer would hit "hasn't finished
  // their payment setup" mid-signup. Stop it here, on the engineer's side.
  const paymentsReady = Boolean(me?.stripeConnected);
  // Review 4 — greyed routes say what unlocks them, not what they'd do.
  const lockedSub =
    me?.role === "staff"
      ? !badgeGranted
        ? "Unlocks when your Gas Safe check is done"
        : "Unlocks when the business owner finishes payment setup"
      : !badgeGranted && !paymentsReady
        ? "Unlocks when your Gas Safe check and payments are done"
        : !badgeGranted
          ? "Unlocks when your Gas Safe check is done"
          : "Unlocks when your payments are set up";
  const customerLocked = !badgeGranted || !paymentsReady;

  function go(path: Parameters<typeof router.push>[0]) {
    onClose();
    router.push(path);
  }

  // Review 3 — the offer lock, with the same words as everywhere else and a
  // way to try the flow in demo mode while it's locked.
  function locked(title: string, reason: string, cta: string, href: Parameters<typeof router.push>[0] | null) {
    onClose();
    Alert.alert(title, reason, [
      { text: "Not now", style: "cancel" },
      { text: "Try it in demo mode", onPress: () => router.push("/demo") },
      ...(href ? [{ text: cta, onPress: () => router.push(href) }] : []),
    ]);
  }

  function customerFacing(path: Parameters<typeof router.push>[0]) {
    if (!badgeGranted) {
      return !paymentsReady && me?.role !== "staff"
        ? locked("Offers are locked for now", "Unlocks when your Gas Safe check and payments are done.", "Set up payments", "/get-paid")
        : locked(
            "Offers are locked for now",
            "Unlocks when your Gas Safe check is done (usually within 24 hours).",
            "Check my status",
            "/more",
          );
    }
    if (!paymentsReady) {
      return me?.role === "staff"
        ? locked("Set up payments first", "Ask the business owner to finish payment setup from their app.", "", null)
        : locked("Set up payments first", "Customers pay you by Direct Debit through Stripe, so payments need setting up before you can offer a plan.", "Set up payments", "/get-paid");
    }
    go(path);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/60" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl border-t border-line-strong bg-paper px-5 pb-10 pt-4"
        >
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-line-strong" />
          <Text className="mb-1 text-center text-base font-bold text-ink">Add a customer</Text>

          <Row
            title="They're with me — show my plans"
            sub={customerLocked ? lockedSub : "Hand them the phone at the kitchen table"}
            muted={customerLocked}
            onPress={() => customerFacing("/demo")}
          />
          <Row
            title="Text them the offer"
            sub={customerLocked ? lockedSub : "Pick a plan, see the exact text, send"}
            muted={customerLocked}
            onPress={() => customerFacing("/offer")}
          />
          <Row
            title="Just save their details"
            sub="No plan yet — just their name and number"
            onPress={() => go("/add-customer")}
          />

          {me?.role !== "staff" && (
            <Pressable onPress={() => go("/plans")} className="items-center pt-3">
              <Text className="font-semibold text-xs text-flame-deep">Manage plans</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
