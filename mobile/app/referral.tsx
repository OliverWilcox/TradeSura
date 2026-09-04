import { useCallback, useState } from "react";
import { View, Text, ScrollView, Share, Linking, Image } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";

type Invitee = {
  name: string;
  activePlans: number;
  required: number;
  stage: "invited" | "signed_up" | "building" | "paid";
  bountyPaid: boolean;
};
type Data = {
  link: string;
  cardUrl: string;
  bountyPence: number;
  requiredPlans: number;
  paidCount: number;
  invitees: Invitee[];
};

export default function Referral() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/referral"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function share() {
    if (!data) return;
    const msg = `I'm using TradeSura to put my customers on monthly care plans — free account, you keep 80%, paid weekly. Worth a look: ${data.link}`;
    const wa = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    const canWa = await Linking.canOpenURL(wa);
    if (canWa) return Linking.openURL(wa);
    await Share.share({ message: msg });
  }

  const bounty = data ? `£${(data.bountyPence / 100).toFixed(0)}` : "£50";

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Refer an engineer" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {data && (
          <>
            {/* E10 — the £50 hero card, the screen's money moment. */}
            <Card variant="hero" className="items-center py-5">
              <Text className="font-mono font-semibold text-4xl text-copper">{bounty}</Text>
              <Text className="mt-1 font-semibold text-sm text-white">
                for every engineer you bring in
              </Text>
              <Text className="mt-0.5 font-sans text-xs text-night-muted">
                Paid into your payout when they get {data.requiredPlans} plans live
              </Text>
            </Card>

            {/* Share card preview — the branded image your invite link shows. */}
            <Card className="items-center border-line-strong py-4">
              <Image
                source={{ uri: data.cardUrl }}
                style={{ width: 260, height: 137, borderRadius: 10 }}
                resizeMode="cover"
              />
              <Text className="mt-2 font-sans text-[11px] text-faint">
                This is what your invite link shows.
              </Text>
            </Card>

            <Card>
              <Micro className="mb-1.5">Your referrals</Micro>
              {data.invitees.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  No referrals yet — share your link below.
                </Text>
              ) : (
                data.invitees.map((r, i) => (
                  <View
                    key={i}
                    className="border-b border-line-soft py-2.5 last:border-b-0"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="font-bold text-sm text-ink">{r.name}</Text>
                      {r.bountyPaid ? (
                        <Pill tone="ok">{bounty} PAID ✓</Pill>
                      ) : (
                        <Pill tone="info">
                          {r.activePlans}/{r.required} PLANS
                        </Pill>
                      )}
                    </View>
                    {!r.bountyPaid && (
                      <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-soft">
                        <View
                          className="h-full rounded-full bg-ok"
                          style={{ width: `${Math.min(100, (r.activePlans / r.required) * 100)}%` }}
                        />
                      </View>
                    )}
                  </View>
                ))
              )}
            </Card>

            <Card>
              <Micro className="mb-1">The deal, plainly</Micro>
              <Text className="font-sans text-xs text-muted">
                Flat {bounty} per engineer — no limit, no ongoing cut. Paid in the next Friday
                payout once they have {data.requiredPlans} live plans. Self-referrals and
                same-household gaming are voided.
              </Text>
            </Card>
          </>
        )}
        <Button variant="green" onPress={share} disabled={!data}>
          Invite on WhatsApp
        </Button>
      </ScrollView>
    </View>
  );
}
