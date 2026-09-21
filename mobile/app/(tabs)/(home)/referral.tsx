import { useCallback, useState } from "react";
import { View, Text, ScrollView, Share, Linking, Image } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";

type Invitee = {
  name: string;
  stage: "signed_up" | "verified" | "plan_live" | "paid";
  bountyPaid: boolean;
};
type Data = {
  link: string;
  qrDataUrl: string;
  cardUrl: string;
  bountyPence: number;
  hasPayout: boolean;
  paidCount: number;
  invitees: Invitee[];
};

// Build Guide v2 Part 14 — "The referral ladder per invitee: Signed up →
// Verified → Plan live → £50 paid."
const STAGE_LABEL: Record<Invitee["stage"], string> = {
  signed_up: "SIGNED UP",
  verified: "VERIFIED",
  plan_live: "PLAN LIVE",
  paid: "£50 PAID",
};
const STAGE_INDEX: Record<Invitee["stage"], number> = {
  signed_up: 0,
  verified: 1,
  plan_live: 2,
  paid: 3,
};

export default function Referral() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

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

  // Review #6 — the name-stamped income card was only ever previewed on
  // screen, never actually attached to a share (spec Screen 13's "post it
  // in the group" flex, distinct from the WhatsApp invite text above).
  //
  // expo-sharing / expo-file-system's downloadFileAsync would give a real
  // local-file attachment, but their native modules aren't linked into the
  // currently-running dev-client binary (added to package.json without a
  // native rebuild — same class of issue as expo-linear-gradient earlier).
  // Core RN's Share API needs no native module and is already used above;
  // its `url` field is iOS-only per RN's own docs, so Android still falls
  // back to text-only here. Revert to the real attachment once a rebuild
  // (`npx expo run:ios`/a new dev-client build) links expo-sharing in.
  async function shareCard() {
    if (!data) return;
    setCardBusy(true);
    try {
      await Share.share({ url: data.cardUrl, message: data.link });
    } catch {
      setError("Couldn't share the card — try again.");
    } finally {
      setCardBusy(false);
    }
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
                Paid into your payout when their first plan goes live
              </Text>
            </Card>

            {/* Part 14 — "Share my income card... soft-gated ('Unlocks with
                your first payout') until there's a real card to share." */}
            <Card className="items-center border-line-strong py-4">
              <Image
                source={{ uri: data.cardUrl }}
                style={{ width: 260, height: 137, borderRadius: 10 }}
                resizeMode="cover"
                blurRadius={data.hasPayout ? 0 : 8}
              />
              <Text className="mt-2 font-sans text-[11px] text-faint">
                {data.hasPayout
                  ? "Post it in the group — let them ask."
                  : "Unlocks with your first payout."}
              </Text>
              {data.hasPayout && (
                <Button
                  variant="ghost"
                  onPress={shareCard}
                  disabled={cardBusy}
                  className="mt-3 w-full"
                >
                  {cardBusy ? "Preparing…" : "Share my income card"}
                </Button>
              )}
            </Card>

            <Card className="items-center py-4">
              <Image
                source={{ uri: data.qrDataUrl }}
                style={{ width: 140, height: 140 }}
                resizeMode="contain"
              />
              <Text className="mt-2 font-sans text-[11px] text-faint">
                Or let them scan or copy your invite link.
              </Text>
              <Text selectable className="mt-1.5 font-mono text-xs text-flame-deep">
                {data.link}
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
                  <View key={i} className="border-b border-line-soft py-2.5 last:border-b-0">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-bold text-sm text-ink">{r.name}</Text>
                      {r.bountyPaid ? (
                        <Pill tone="ok">{bounty} PAID</Pill>
                      ) : (
                        <Pill tone="info">{STAGE_LABEL[r.stage]}</Pill>
                      )}
                    </View>
                    {!r.bountyPaid && (
                      <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-soft">
                        <View
                          className="h-full rounded-full bg-flame"
                          style={{ width: `${(STAGE_INDEX[r.stage] / 3) * 100}%` }}
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
                payout once their first plan goes live. Self-referrals and same-household gaming
                are voided.
              </Text>
            </Card>
          </>
        )}
        <Button onPress={share} disabled={!data}>
          Invite on WhatsApp
        </Button>
      </ScrollView>
    </View>
  );
}
