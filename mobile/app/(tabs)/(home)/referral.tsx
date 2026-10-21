import { useCallback, useState } from "react";
import { View, Text, ScrollView, Share, Linking, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";
import { Skeleton, Bone, TextBone, LoadingImage } from "@/components/skeleton";
import { Icon, type IconName } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import { useAuth } from "@/lib/auth-context";
import { copyText } from "@/lib/clipboard";

type Invitee = {
  name: string;
  stage: "signed_up" | "verified" | "plan_live" | "earning";
  activePlans: number;
  earnedPence: number;
  ratePercent: number;
};
type Data = {
  link: string;
  qrDataUrl: string;
  cardUrl: string;
  firstYearPercent: number;
  lifetimePercent: number;
  firstYearMonths: number;
  totalEarnedPence: number;
  hasPayout: boolean;
  invitees: Invitee[];
};

// Build Review 2, ruling 4 — the ladder per invitee now ends in "Earning"
// (their customers are paying, so you are) instead of a one-off £50.
const STAGE_LABEL: Record<Invitee["stage"], string> = {
  signed_up: "Signed up",
  verified: "Verified",
  plan_live: "Plan live",
  earning: "Earning",
};
const STAGE_INDEX: Record<Invitee["stage"], number> = {
  signed_up: 0,
  verified: 1,
  plan_live: 2,
  earning: 3,
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

// The deal hero, the income card and QR (as ring-spinner panels, since
// they're images), then the referrals list.
function ReferralSkeleton() {
  return (
    <Skeleton label="Loading your invite" className="gap-3.5">
      <Card variant="hero" className="items-center py-5">
        <Bone width={90} height={36} radius={8} />
        <TextBone width={210} size={14} style={{ marginTop: 4 }} />
        <TextBone width={240} size={12} style={{ marginTop: 2 }} />
      </Card>
      <Card className="items-center border-line-strong py-4">
        <Bone width={260} height={137} radius={10} />
        <TextBone width={170} size={11} style={{ marginTop: 8 }} />
      </Card>
      <Card className="items-center py-4">
        <Bone width={140} height={140} radius={8} />
        <TextBone width={220} size={11} style={{ marginTop: 8 }} />
        <TextBone width={200} size={12} style={{ marginTop: 6 }} />
      </Card>
    </Skeleton>
  );
}

// The target's worked example: 30 customers on £12 plans, at the 20% fee.
const EXAMPLE_CUSTOMERS = 30;
const EXAMPLE_PLAN_PENCE = 1200;
const FEE_RATE = 0.2;

function ShareChip({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-line-strong py-3"
    >
      <Icon name={icon} size={17} />
      <Text className="text-[14.5px] text-ink">{label}</Text>
    </Pressable>
  );
}

export default function Referral() {
  const { me, refreshMe } = useAuth();
  const [copied, setCopied] = useState(false);
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

  // Any share ticks off the getting-started hub's "Invite engineers" step.
  function markShared() {
    api("/api/referral/shared", { method: "POST" })
      .then(() => refreshMe())
      .catch(() => {});
  }

  function inviteText() {
    return `I'm using TradeSura to put my customers on monthly care plans — free account, you keep 80%, paid every Friday. Worth a look: ${data?.link ?? ""}`;
  }

  async function share() {
    if (!data) return;
    const msg = inviteText();
    const wa = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    const canWa = await Linking.canOpenURL(wa).catch(() => false);
    markShared();
    if (canWa) return Linking.openURL(wa);
    await Share.share({ message: msg });
  }

  async function text() {
    if (!data) return;
    markShared();
    await Linking.openURL(`sms:&body=${encodeURIComponent(inviteText())}`).catch(() =>
      Share.share({ message: inviteText() }),
    );
  }

  async function copy() {
    if (!data) return;
    markShared();
    if ((await copyText(data.link)) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function later() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
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


  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader
          title="Getting started · Invite engineers"
          right={
            <Pressable onPress={later} hitSlop={10}>
              <Text className="text-[14px] text-muted">Skip for now</Text>
            </Pressable>
          }
        />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {!data && !error && <ReferralSkeleton />}

        {data && (
          <>
            {/* 2026 Build Guide TARGET_invite_step, with Build Review 2's
                affiliate deal (ruling 4). Green is only ever real money. */}
            <View className="flex-row items-center justify-center gap-4 pt-2">
              <Icon name="person" size={52} color="#5fa3f0" />
              <RingMark size={84} />
              <Icon name="person" size={52} color="#3dd68c" />
            </View>
            <View>
              <Text className="text-center text-[26px] font-extrabold text-ink">Know another gas engineer?</Text>
              <Text className="mt-1.5 text-center text-[15px] text-muted">
                Invite them to TradeSura and earn from every plan they sell.
              </Text>
            </View>

            <Card>
              <Micro className="text-flame">The deal</Micro>
              <View className="mt-2 flex-row items-center gap-4">
                <Text className="w-[104px] text-[46px] font-extrabold text-copper">{data.firstYearPercent}%</Text>
                <Text className="flex-1 text-[16px] leading-[22px] text-ink">
                  of our fee on every plan they sell, for their first year
                </Text>
              </View>
              <View className="mt-1 flex-row items-center gap-4">
                <Text className="w-[104px] text-[46px] font-extrabold text-copper">{data.lifetimePercent}%</Text>
                <Text className="flex-1 text-[16px] leading-[22px] text-ink">for life after that</Text>
              </View>
              <Text className="mt-2 text-[13.5px] text-muted">Paid with your Friday payouts. One level only.</Text>
              {data.totalEarnedPence > 0 && (
                <Text className="mt-2 text-[15px] font-semibold text-copper">
                  {pounds(data.totalEarnedPence)} earned so far
                </Text>
              )}
            </Card>

            <Card>
              <Micro className="text-flame">For example</Micro>
              <Text className="mt-1.5 text-[15px] text-ink">
                An engineer you invite gets {EXAMPLE_CUSTOMERS} customers on £{EXAMPLE_PLAN_PENCE / 100} plans.
              </Text>
              <Text className="mt-1 text-[15px] font-semibold text-ok">
                You earn about £
                {Math.round((EXAMPLE_CUSTOMERS * EXAMPLE_PLAN_PENCE * FEE_RATE * 12 * data.firstYearPercent) / 10000)} in
                their first year, then about £
                {Math.round((EXAMPLE_CUSTOMERS * EXAMPLE_PLAN_PENCE * FEE_RATE * 12 * data.lifetimePercent) / 10000)} a year.
              </Text>
              <Text className="mt-1 text-[12.5px] text-muted">Example only</Text>
            </Card>

            <Card>
              <Micro className="text-flame">Your invite link</Micro>
              <Text selectable className="mt-1.5 text-[19px] font-bold text-ink">
                {data.link.replace(/^https?:\/\/(www\.)?/, "")}
              </Text>
              {me?.slug && <Text className="mt-0.5 text-[14px] text-muted">Your code: {me.slug}</Text>}
              <View className="mt-3 flex-row gap-2">
                <ShareChip icon="message" label="WhatsApp" onPress={share} />
                <ShareChip icon="chat" label="Text" onPress={text} />
                <ShareChip icon="copy" label={copied ? "Copied" : "Copy"} onPress={copy} />
              </View>
            </Card>

            <Button onPress={share}>Share my invite</Button>
            <Pressable onPress={later} className="items-center py-1">
              <Text className="text-[15px] font-semibold text-flame">I&apos;ll do this later</Text>
            </Pressable>

            {/* Part 14 — "Share my income card... soft-gated ('Unlocks with
                your first payout') until there's a real card to share." */}
            <Card className="items-center border-line-strong py-4">
              <LoadingImage
                uri={data.cardUrl}
                width={260}
                height={137}
                radius={10}
                resizeMode="cover"
                blurRadius={data.hasPayout ? 0 : 8}
                accessibilityLabel="Your income card"
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
              <LoadingImage
                uri={data.qrDataUrl}
                width={140}
                height={140}
                resizeMode="contain"
                accessibilityLabel="QR code for your invite link"
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
                  No referrals yet. Share your link to get started.
                </Text>
              ) : (
                data.invitees.map((r, i) => (
                  <View key={i} className="border-b border-line-soft py-2.5 last:border-b-0">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-bold text-sm text-ink">{r.name}</Text>
                      <Pill tone="info">{STAGE_LABEL[r.stage]}</Pill>
                    </View>
                    {r.stage === "earning" ? (
                      <View className="mt-1 flex-row items-center justify-between">
                        <Text className="font-sans text-xs text-muted">
                          {r.activePlans} plan{r.activePlans === 1 ? "" : "s"} live · you get {r.ratePercent}% of our fee
                        </Text>
                        <Text className="font-mono text-sm font-semibold text-copper">
                          {pounds(r.earnedPence)}
                        </Text>
                      </View>
                    ) : (
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
                Every installer is an affiliate. For each engineer you bring in, you earn{" "}
                {data.firstYearPercent}% of TradeSura&apos;s fee on every plan they sell for their
                first {data.firstYearMonths} months, then {data.lifetimePercent}% for as long as they
                use TradeSura. It goes into your Friday payout. One level only — you don&apos;t earn on
                their referrals. Self-referrals and same-household referrals are voided.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
