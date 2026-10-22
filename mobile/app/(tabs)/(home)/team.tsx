import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";
import { CenteredSpinner } from "@/components/skeleton";

// Build Review 2, section 8 — the owner's Team page. Staff log into their own
// accounts and can only add customers; each one's Gas Safe card is its own
// check, and they can't send offers until it's approved.

type Staff = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  check: "check_in_progress" | "verified" | "rejected";
  rejectReason: string | null;
  joined: boolean;
  signUpsTotal: number;
  signUpsThisWeek: number;
};

const CHECK_PILL: Record<Staff["check"], { tone: "info" | "warn" | "off"; label: string }> = {
  check_in_progress: { tone: "warn", label: "Check in progress" },
  verified: { tone: "info", label: "Verified" },
  rejected: { tone: "off", label: "Check failed" },
};

export default function Team() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ staff: Staff[] }>("/api/team");
      setStaff(d.staff);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your team.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/api/team/${id}`, { method: "DELETE" });
      setRemoving(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove them — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Team" />
      </SafeAreaView>
      {!staff && !error && <CenteredSpinner label="Loading your team" />}
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
        <Text className="px-1 font-sans text-sm text-muted">
          Your engineers sign in to their own accounts and can add customers to your plans. They never
          see your money or settings, and every payment still goes to your Stripe account.
        </Text>

        <Button onPress={() => router.push("/team-add")}>Add an engineer</Button>

        {staff && staff.length === 0 && (
          <Card>
            <Text className="font-sans text-sm text-muted">No engineers yet.</Text>
          </Card>
        )}

        {staff?.map((s) => {
          const pill = CHECK_PILL[s.check];
          return (
            <Card key={s.id}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-bold text-sm text-ink">{s.name}</Text>
                <Pill tone={pill.tone}>{pill.label}</Pill>
              </View>
              <Text className="mt-0.5 font-sans text-xs text-muted">
                {s.email}
                {s.joined ? "" : " · hasn't signed in yet"}
              </Text>
              {s.check === "check_in_progress" && (
                <Text className="mt-1.5 font-sans text-xs text-warn">
                  Can add customers now; offers unlock once their Gas Safe card is approved.
                </Text>
              )}
              {s.check === "rejected" && (
                <Text className="mt-1.5 font-sans text-xs text-danger">
                  We couldn&apos;t verify their card{s.rejectReason ? ` (${s.rejectReason})` : ""}. Email
                  info@tradesura.com with a clearer photo.
                </Text>
              )}
              <View className="mt-2 flex-row gap-4">
                <View>
                  <Micro>This week</Micro>
                  <Text className="tabular-nums text-base text-ink">{s.signUpsThisWeek}</Text>
                </View>
                <View>
                  <Micro>All time</Micro>
                  <Text className="tabular-nums text-base text-ink">{s.signUpsTotal}</Text>
                </View>
              </View>
              {removing === s.id ? (
                <View className="mt-3 gap-2">
                  <Text className="font-sans text-xs text-muted">
                    Their access stops straight away. Customers they added stay with your business.
                  </Text>
                  <Button variant="dangerghost" onPress={() => remove(s.id)} disabled={busy}>
                    {busy ? "Removing…" : `Remove ${s.name.split(" ")[0]}`}
                  </Button>
                  <Button variant="ghost" onPress={() => setRemoving(null)} disabled={busy}>
                    Keep them
                  </Button>
                </View>
              ) : (
                <Pressable onPress={() => setRemoving(s.id)} className="mt-3 self-start py-1">
                  <Text className="font-sans text-xs text-muted">Remove from team</Text>
                </Pressable>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
