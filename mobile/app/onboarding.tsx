import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { gcResultError } from "@/lib/gc";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

// Post-signup — Direct Debit connect only. Name, Gas Safe verification,
// trading name and business details are all collected earlier now, in the
// sign-up wizard (app/sign-up.tsx) before the account even exists.
export default function Onboarding() {
  const { me, refreshMe, skipGc } = useAuth();
  const [gcBusy, setGcBusy] = useState(false);
  const [gcError, setGcError] = useState<string | null>(null);

  async function skip() {
    await skipGc();
    router.replace("/(tabs)");
  }

  async function connectGc() {
    setGcBusy(true);
    setGcError(null);
    try {
      const { url } = await api<{ url: string }>("/api/gc/connect-url");
      const result = await WebBrowser.openAuthSessionAsync(url, "tradesura://onboarding");
      const gcErr = gcResultError(result);
      if (gcErr) setGcError(gcErr);
      else if (result.type === "success") await refreshMe();
    } catch (e) {
      setGcError(e instanceof ApiError ? e.message : "Couldn't start Direct Debit connect.");
    } finally {
      setGcBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Almost there</Micro>} />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-6 pt-4">
        <Text className="font-disp-bold text-2xl uppercase tracking-wide text-ink">
          {me?.firstName ? `Welcome, ${me.firstName}` : "Welcome"}
        </Text>
        <Text className="mb-1 font-sans text-sm text-muted">
          One last step before you can start selling plans.
        </Text>

        <Card>
          <Text className="mb-1 font-sans-semibold text-sm text-ink">Connect Direct Debit</Text>
          <Text className="mb-2.5 font-sans text-xs text-muted">
            Customers pay you by Direct Debit. Paid out direct to your bank — TradeSura never
            holds your money.
          </Text>
          {me?.gcConnected ? (
            <View className="rounded-[10px] border border-[#BCE6CF] bg-ok-tint px-3 py-2.5">
              <Text className="font-sans-semibold text-xs text-ok">✓ Direct Debit connected</Text>
            </View>
          ) : (
            <>
              {gcError && <Text className="mb-2 font-sans text-xs text-danger">{gcError}</Text>}
              <Button onPress={connectGc} disabled={gcBusy}>
                {gcBusy ? "Opening…" : "Connect Direct Debit"}
              </Button>
            </>
          )}
        </Card>

        {me?.gcConnected ? (
          <Button onPress={() => router.replace("/(tabs)")} className="mt-1">
            Continue — build my first plan
          </Button>
        ) : (
          <Button onPress={skip} variant="ghost" className="mt-1">
            Skip for now
          </Button>
        )}
        <Text className="pt-1 text-center font-mono text-[10px] text-faint">
          Paid out direct to your bank · Verification refreshed monthly
        </Text>
      </ScrollView>
    </View>
  );
}
