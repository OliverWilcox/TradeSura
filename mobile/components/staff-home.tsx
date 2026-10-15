import { useCallback, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { AddCustomerSheet } from "@/components/add-customer-sheet";
import { Icon } from "@/components/icon";

// Build Review 2, section 8 — "Staff app: the same shell, cut down. Home shows
// a big 'Add customer' button and their own count of sign-ups this week (a
// number, never £)." Offers stay locked until their own Gas Safe check passes.
export function StaffHome() {
  const { me, refreshMe } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe]),
  );

  const verified = Boolean(me?.gasSafeVerifiedAt);
  const rejected = !verified && Boolean(me?.gasSafeRejectedAt);
  const canAdd = Boolean(me?.hasPlan);
  const count = me?.signUpsThisWeek ?? 0;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-8 pt-4">
        <View>
          <Text className="text-2xl font-bold text-ink">
            {me?.firstName ? `Hi, ${me.firstName}` : "Hi"}
          </Text>
          <Text className="mt-0.5 font-sans text-sm text-muted">
            Signing customers up for {me?.businessName ?? "your business"}.
          </Text>
        </View>

        <Card className={verified ? "" : rejected ? "border-danger-tint bg-danger-tint" : "border-warn-tint bg-warn-tint"}>
          <View className="flex-row items-center gap-2">
            <Icon
              name={verified ? "verified" : "warning"}
              size={18}
              color={verified ? "#5FA3F0" : rejected ? "#FF6B6B" : "#F2B84B"}
            />
            <Text className={`flex-1 font-sans text-sm ${verified ? "text-ink" : rejected ? "text-danger" : "text-warn"}`}>
              {verified
                ? "Gas Safe verified — you can send plan offers."
                : rejected
                  ? "Your Gas Safe check needs a look — ask the business owner to check your card on their Team page."
                  : "Gas Safe check in progress — you can add customers now, and send offers once it's done."}
            </Text>
          </View>
        </Card>

        <Card variant="raised" className="items-center py-5">
          <Micro>Sign-ups this week</Micro>
          <Text className="mt-1 font-mono text-5xl font-semibold text-ink">{count}</Text>
          <Text className="mt-1 font-sans text-xs text-muted">
            Customers who joined a plan you offered, since Monday.
          </Text>
        </Card>

        <Button onPress={() => setSheetOpen(true)} disabled={!canAdd}>
          Add customer
        </Button>
        {!canAdd && (
          <Text className="text-center font-sans text-xs text-muted">
            The business has no live plan yet — ask the owner to make one live.
          </Text>
        )}
        <Button variant="ghost" onPress={() => router.push("/customers")}>
          My customers
        </Button>
      </ScrollView>
      <AddCustomerSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}
