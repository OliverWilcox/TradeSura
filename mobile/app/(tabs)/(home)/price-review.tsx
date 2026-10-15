import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { CenteredSpinner } from "@/components/skeleton";

// Build Review 2, ruling 3 — annual price review. At most once a year per
// customer, 30 days' notice by text and email with the old price, new price,
// start date and a free cancel link. The server holds every rule; this
// screen previews who it reaches and confirms.

type Preview = {
  noticeDays: number;
  capPercent: number | null;
  effectiveAt: string;
  currentPricePence: number;
  customers: { name: string; pricePence: number; eligible: boolean; pending: boolean; earliest: string }[];
};

const MIN_PENCE = 1000; // mirrors TIER_PRICE_MIN_PENCE

function pounds(p: number) {
  return `£${(p / 100).toFixed(2)}`;
}
function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function PriceReview() {
  const { tierId } = useLocalSearchParams<{ tierId: string }>();
  const [data, setData] = useState<Preview | null>(null);
  const [priceText, setPriceText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sent: number; effectiveAt: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<Preview>(`/api/tiers/${tierId}/price-review`);
      setData(d);
      setPriceText((t) => t || String(Math.round(d.currentPricePence / 100)));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the price review.");
    }
  }, [tierId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const newPence = Number(priceText || "0") * 100;
  const eligible = data?.customers.filter((c) => c.eligible) ?? [];
  const waiting = data?.customers.filter((c) => !c.eligible) ?? [];
  const capHit =
    data?.capPercent != null &&
    eligible.some((c) => newPence > c.pricePence * (1 + (data.capPercent as number) / 100));
  const invalid =
    newPence < MIN_PENCE
      ? "The minimum plan price is £10 a month."
      : capHit
        ? `A price review can raise the price by at most ${data?.capPercent}%.`
        : null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sent: number; effectiveAt: string }>(`/api/tiers/${tierId}/price-review`, {
        method: "POST",
        body: JSON.stringify({ newPricePence: newPence }),
      });
      setDone(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the price review.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Annual price review" />
      </SafeAreaView>
      {!data && !error && <CenteredSpinner label="Loading price review" />}
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {done && (
          <Card>
            <Text className="text-base font-bold text-ink">
              Notice sent to {done.sent} customer{done.sent === 1 ? "" : "s"}
            </Text>
            <Text className="mt-1 font-sans text-sm text-muted">
              They&apos;ve had a text and an email with the old and new price. The new price starts on{" "}
              {longDate(done.effectiveAt)}. New customers see it from today.
            </Text>
            <Button className="mt-3" onPress={() => router.back()}>
              Done
            </Button>
          </Card>
        )}

        {data && !done && (
          <>
            <Text className="px-1 font-sans text-sm text-muted">
              Once a year you can change what your current customers pay. They get{" "}
              {data.noticeDays} days&apos; notice by text and email, with a free way to cancel.
            </Text>

            <Card>
              <Micro className="mb-1 text-center">New monthly price</Micro>
              <View className="flex-row items-center justify-center py-2">
                <Text className="font-mono text-3xl font-semibold text-ink">£</Text>
                <TextInput
                  value={priceText}
                  onChangeText={(v) => {
                    setPriceText(v.replace(/[^\d]/g, "").slice(0, 4));
                    setConfirming(false);
                  }}
                  keyboardType="number-pad"
                  maxLength={4}
                  accessibilityLabel="New monthly price in pounds"
                  className="w-[84px] p-0 text-center font-mono text-3xl font-semibold text-ink"
                />
              </View>
              <Text className="text-center font-sans text-xs text-muted">
                Starts {longDate(data.effectiveAt)}
                {data.capPercent != null ? ` · at most ${data.capPercent}% higher` : ""}
              </Text>
              {invalid && <Text className="mt-1 text-center font-sans text-xs text-warn">{invalid}</Text>}
            </Card>

            <Card>
              <Micro className="mb-1">Who gets the notice</Micro>
              {eligible.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  No one yet — each customer can have one price review a year.
                </Text>
              ) : (
                eligible.map((c, i) => (
                  <View key={i} className="flex-row justify-between border-b border-line-soft py-2 last:border-b-0">
                    <Text className="font-sans text-sm text-ink">{c.name}</Text>
                    <Text className="font-mono text-xs text-muted">
                      {pounds(c.pricePence)} → {newPence >= MIN_PENCE ? pounds(newPence) : "—"}
                    </Text>
                  </View>
                ))
              )}
              {waiting.length > 0 && (
                <Text className="mt-2 font-sans text-xs text-faint">
                  {waiting.length} other{waiting.length === 1 ? "" : "s"} can&apos;t be reviewed yet (a review is
                  pending, or they joined or were last reviewed less than a year ago). They keep their price.
                </Text>
              )}
            </Card>

            {!confirming ? (
              <Button onPress={() => setConfirming(true)} disabled={Boolean(invalid) || eligible.length === 0}>
                Review the price
              </Button>
            ) : (
              <Card>
                <Text className="font-sans text-sm text-ink">
                  Send the notice to {eligible.length} customer{eligible.length === 1 ? "" : "s"}? Their price
                  becomes {pounds(newPence)} a month from {longDate(data.effectiveAt)}. You can&apos;t undo this.
                </Text>
                <View className="mt-3 gap-2">
                  <Button onPress={send} disabled={busy}>
                    {busy ? "Sending…" : "Send the notice"}
                  </Button>
                  <Button variant="ghost" onPress={() => setConfirming(false)} disabled={busy}>
                    Not now
                  </Button>
                </View>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
