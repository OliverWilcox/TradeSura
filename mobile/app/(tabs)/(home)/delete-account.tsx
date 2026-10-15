import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button } from "@/components/ui";

// Build Review 2, section 10 — in-app account deletion (App Store rule
// 5.1.1), behind a confirmation step. Owners with customers on live plans are
// told by the server to end or hand those over first.
export default function DeleteAccount() {
  const { me, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isStaff = me?.role === "staff";

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/me", { method: "DELETE" });
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete your account — try again.");
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Delete my account" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
        <Card>
          <Text className="font-sans text-sm text-ink">
            {isStaff
              ? `Deleting your account removes you from ${me?.businessName ?? "the business"}'s team and erases your details. Customers you added stay with the business.`
              : "Deleting your account erases your details, your customers' details and your Gas Safe card, removes your team's access and stops your plans being offered."}
          </Text>
          {!isStaff && (
            <Text className="mt-2 font-sans text-sm text-muted">
              If any customers are on a live plan, end their plans first (from each customer&apos;s page) so
              their Direct Debits stop. Records of past payments are kept for accounting, without names.
            </Text>
          )}
          <Text className="mt-2 font-sans text-sm text-muted">This can&apos;t be undone.</Text>
        </Card>
        {error && <Text className="px-1 font-sans text-sm text-danger">{error}</Text>}
        {!confirming ? (
          <Button variant="dangerghost" onPress={() => setConfirming(true)}>
            Delete my account
          </Button>
        ) : (
          <Card>
            <Text className="font-sans text-sm text-ink">Are you sure? Your account will be deleted straight away.</Text>
            <View className="mt-3 gap-2">
              <Button variant="dangerghost" onPress={remove} disabled={busy}>
                {busy ? "Deleting…" : "Yes, delete it permanently"}
              </Button>
              <Button variant="ghost" onPress={() => setConfirming(false)} disabled={busy}>
                Keep my account
              </Button>
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
