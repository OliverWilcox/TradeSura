import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro } from "@/components/ui";

// Build Guide v2 Part 14 — "Membership Shop: the October face is the
// coming-soon card — 'your free member pack ships when your badge goes
// live.'" LAW: "the credential lock is permanent: anything bearing the
// Verified Member seal can never be bought or shipped to an unverified
// account, and re-locks on pause or ban." There's no catalogue yet — this
// is the honest one-card room the quick-action gate unlocks into.
export default function MembershipShop() {
  const { me } = useAuth();
  const verified = Boolean(me?.gasSafeVerifiedAt);
  const packSent = Boolean(me?.packRequestedAt);

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Membership Shop" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <Card variant="hero" className="items-center py-6">
          <Text className="text-center font-semibold text-base text-white">
            {verified
              ? packSent
                ? "Your free member pack is on its way."
                : "Your free member pack ships when your badge goes live."
              : "The shop unlocks with your badge."}
          </Text>
          <Text className="mt-1.5 text-center font-sans text-xs text-night-muted">
            Coming this October.
          </Text>
        </Card>
        <Card>
          <Micro className="mb-1">Why it&apos;s locked</Micro>
          <Text className="font-sans text-xs text-muted">
            Anything carrying the Verified Member mark can only ever go to a verified account —
            it&apos;s re-locked automatically if your account is ever paused.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
