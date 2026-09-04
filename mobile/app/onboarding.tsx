import { useState, type ReactNode } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { stripeResultError } from "@/lib/stripe";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

// E2 — post-signup onboarding wizard. Four steps, sequenced for activation:
// get paid → first plan → import book → founding pack. Only step 1 gates the
// app (see (tabs)/_layout.tsx); 2–4 are strong nudges that resume from wherever
// the engineer left off (state derived from /api/me, not stored).
type StepState = "done" | "next" | "later";

function StepCard({
  n,
  title,
  body,
  state,
  cta,
  onPress,
  children,
}: {
  n: number;
  title: string;
  body: string;
  state: StepState;
  cta?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  return (
    <Card
      variant={state === "next" ? "raised" : "flat"}
      className={
        state === "next" ? "border-[1.5px] border-flame" : state === "later" ? "opacity-60" : ""
      }
    >
      <View className="flex-row items-start justify-between gap-2">
        <View className="shrink">
          <Micro className={state === "done" ? "text-ok" : state === "next" ? "text-flame" : ""}>
            {state === "done" ? "✓ Done" : `Step ${n}`}
          </Micro>
          <Text className="mt-0.5 font-semibold text-[15px] text-ink">{title}</Text>
          <Text className="mt-0.5 font-sans text-xs text-muted">{body}</Text>
        </View>
        {state === "done" && <Text className="text-lg text-ok">✓</Text>}
      </View>
      {children}
      {state !== "done" && cta && onPress && (
        <Button onPress={onPress} variant={state === "next" ? "flame" : "ghost"} className="mt-3">
          {cta}
        </Button>
      )}
    </Card>
  );
}

export default function Onboarding() {
  const { me, refreshMe, skipStripe } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packAddress, setPackAddress] = useState("");
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const paid = Boolean(me?.stripeConnected);
  const hasPlan = Boolean(me?.hasPlan);
  const hasBook = (me?.customerCount ?? 0) > 0;
  const packDone = Boolean(me?.packRequestedAt);

  async function connectStripe() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/connect-link");
      const result = await WebBrowser.openAuthSessionAsync(url, "tradesura://onboarding");
      const err = stripeResultError(result);
      if (err) setError(err);
      else if (result.type === "success") await refreshMe();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start payment setup.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPack() {
    setPackBusy(true);
    setPackError(null);
    try {
      await api("/api/onboarding/pack", {
        method: "POST",
        body: JSON.stringify({ address: packAddress.trim() }),
      });
      await refreshMe();
    } catch (e) {
      setPackError(e instanceof ApiError ? e.message : "Couldn't save your address.");
    } finally {
      setPackBusy(false);
    }
  }

  function stepState(done: boolean, isNext: boolean): StepState {
    if (done) return "done";
    return isNext ? "next" : "later";
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-6 pt-4">
        <Text className="font-bold text-2xl uppercase tracking-wide text-ink">
          {me?.firstName ? `Welcome, ${me.firstName}` : "Welcome"}
        </Text>
        <Text className="mb-1 font-sans text-sm text-muted">
          Four steps and you&apos;re earning. About 8 minutes.
        </Text>

        <StepCard
          n={1}
          title="Get paid"
          body={
            paid
              ? "Payouts ready — you'll be paid every week."
              : "Stripe handles your details — TradeSura never sees your bank login."
          }
          state={stepState(paid, !paid)}
          cta={me?.stripeDetailsSubmitted ? "Finish payment setup" : "Set up payments"}
          onPress={connectStripe}
        >
          {busy && <Text className="mt-2 font-sans text-xs text-muted">Opening…</Text>}
          {error && <Text className="mt-2 font-sans text-xs text-danger">{error}</Text>}
        </StepCard>

        <StepCard
          n={2}
          title="Your first plan"
          body={
            hasPlan
              ? "Your plan page is live — customers can join it now."
              : "We've drafted Boiler Care at £12/month — approve it or set your own price."
          }
          state={stepState(hasPlan, paid && !hasPlan)}
          cta="Set up my plan"
          onPress={() => router.push("/(tabs)/plans")}
        />

        <StepCard
          n={3}
          title="Your customers"
          body={
            hasBook
              ? `${me?.customerCount} customer${me?.customerCount === 1 ? "" : "s"} imported — each one is a potential £144/yr.`
              : "Import your book — every contact is a potential £144/yr."
          }
          state={stepState(hasBook, paid && hasPlan && !hasBook)}
          cta="Import my book"
          onPress={() => router.push("/customers/import-contacts")}
        />

        <StepCard
          n={4}
          title="Your founding pack"
          body={
            packDone
              ? "On its way — free QR cards and a van sticker."
              : "Free cards & van sticker with your personal QR code — hand one over at every job."
          }
          state={stepState(packDone, paid && hasPlan && hasBook && !packDone)}
        >
          {!packDone && (
            <View className="mt-2.5 gap-2">
              <TextInput
                value={packAddress}
                onChangeText={setPackAddress}
                placeholder="Full postal address"
                placeholderTextColor="#6E86A3"
                multiline
                className="min-h-[64px] rounded-[10px] border border-line bg-paper px-3 py-2.5 font-sans text-sm text-ink"
              />
              {packError && <Text className="font-sans text-xs text-danger">{packError}</Text>}
              <Button
                onPress={requestPack}
                variant="ghost"
                disabled={packBusy || packAddress.trim().length < 10}
              >
                {packBusy ? "Saving…" : "Send my pack"}
              </Button>
            </View>
          )}
        </StepCard>

        <Button
          onPress={() => {
            if (!paid) skipStripe();
            router.replace("/(tabs)");
          }}
          variant={paid ? "flame" : "ghost"}
          className="mt-1"
        >
          {paid ? "Go to my dashboard" : "Skip setup for now"}
        </Button>
        <Text className="pt-1 text-center font-mono text-[10px] text-faint">
          Paid out to your bank every week · Powered by Stripe
        </Text>
      </ScrollView>
    </View>
  );
}
