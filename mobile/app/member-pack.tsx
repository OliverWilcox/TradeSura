import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, Image, type ImageSourcePropType } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button, Tick } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";

// Getting started · "Member pack" — posted once the Gas Safe badge goes live.
// Review 4: show the real pack (each item), the posting address with Change,
// and where it's up to. `image` takes a photo of the real item once we have
// them (drop it in assets/pack/); until then the item's icon stands in.
const PACK_ITEMS: { label: string; detail: string; icon: IconName; image?: ImageSourcePropType }[] = [
  { label: "Van stickers", detail: "Verified Member for both sides of the van", icon: "van" },
  { label: "Window sticker", detail: "For your office or front window", icon: "shield" },
  { label: "QR labels", detail: "Stick one on each boiler you service", icon: "qr" },
  { label: "Quick-start booklet", detail: "Offering plans in under 90 seconds", icon: "booklet" },
  { label: "Leaflets", detail: "To leave with customers after a job", icon: "leaflets" },
  { label: "Cover letter", detail: "Welcome to TradeSura", icon: "document" },
  { label: "Envelope", detail: "Posted to you, free", icon: "mail" },
];

type Stage = "address" | "waiting" | "packing" | "posted";

function stageOf(me: { packRequestedAt?: string | null; packShippedAt?: string | null; gasSafeVerifiedAt?: string | null } | null): Stage {
  if (me?.packShippedAt) return "posted";
  if (!me?.packRequestedAt) return "address";
  return me.gasSafeVerifiedAt ? "packing" : "waiting";
}

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

type Parts = { lines: string[]; town: string; postcode: string };
type Addresses = {
  trading: Parts | null;
  correspondence: string | null;
  correspondenceParts: Parts | null;
  correspondenceSameAsTrading: boolean;
  confirmed: boolean;
};

export default function MemberPack() {
  const { me, refreshMe } = useAuth();
  const stage = stageOf(me);
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<{ addresses: Addresses }>("/api/settings")
        .then((r) => setAddresses(r.addresses))
        .catch(() => {});
    }, []),
  );

  const postTo = addresses?.correspondence ?? me?.packAddress ?? null;

  // Packs wait until the engineer confirms where post goes (or an admin
  // checks it). Confirming saves the addresses as they are; one that can't
  // be read as an address goes to the Addresses screen instead.
  async function confirm() {
    const correspondence = addresses?.correspondenceSameAsTrading ? "same" : addresses?.correspondenceParts;
    if (!addresses?.trading || !correspondence || !postTo) {
      router.push("/addresses");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/addresses", {
        method: "PUT",
        body: JSON.stringify({ trading: addresses.trading, correspondence }),
      });
      // Not asked for yet (older accounts): this asks for it too.
      if (stage === "address") {
        await api("/api/onboarding/pack", { method: "POST", body: JSON.stringify({ address: postTo }) });
      }
      setAddresses({ ...addresses, confirmed: true });
      await refreshMe();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't confirm your address.");
    } finally {
      setBusy(false);
    }
  }

  const needsConfirm = stage !== "posted" && addresses !== null && (!addresses.confirmed || stage === "address");

  const status: Record<Exclude<Stage, "address">, { title: string; body: string; amber: boolean }> = {
    waiting: {
      title: "Waiting · posts when your badge goes live",
      body: "We post your pack as soon as your Gas Safe check is done.",
      amber: true,
    },
    packing: { title: "Being packed · posts this week", body: "Your badge is live, so your pack is on its way.", amber: false },
    posted: {
      title: me?.packShippedAt ? `Posted on ${longDate(me.packShippedAt)}` : "Posted",
      body: "It usually arrives in 2 to 3 working days. Not arrived after a week? Email info@tradesura.com.",
      amber: false,
    },
  };

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Member pack" />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4">
        <View>
          <Text className="text-[22px] font-bold text-ink">Your free member pack</Text>
          <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
            Everything you need to show customers you&apos;re a Verified Member. It posts when your Gas Safe badge
            goes live.
          </Text>
        </View>

        {stage !== "address" && (
          <Card className={status[stage].amber ? "border-warn bg-warn-tint" : undefined}>
            <View className="flex-row items-center gap-2">
              {stage === "waiting" ? <Icon name="pending" size={16} color="#F2B84B" /> : <Tick size={14} />}
              <Text className={`text-[15px] font-semibold ${status[stage].amber ? "text-warn" : "text-ink"}`}>
                {status[stage].title}
              </Text>
            </View>
            <Text className="mt-1.5 text-[14px] text-muted">{status[stage].body}</Text>
          </Card>
        )}

        <Card>
          <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">What&apos;s in the pack</Text>
          <View className="mt-3 flex-row flex-wrap justify-between gap-y-3">
            {PACK_ITEMS.map((item) => (
              <View key={item.label} className="w-[48%] overflow-hidden rounded-xl border border-line bg-bg">
                <View className="h-[88px] items-center justify-center bg-panel">
                  {item.image ? (
                    <Image source={item.image} className="h-full w-full" resizeMode="cover" accessibilityLabel={item.label} />
                  ) : (
                    <Icon name={item.icon} size={34} color="#5FA3F0" />
                  )}
                </View>
                <View className="px-2.5 py-2">
                  <Text className="text-[13.5px] font-semibold text-ink">{item.label}</Text>
                  <Text className="mt-0.5 text-[11.5px] leading-[15px] text-faint">{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        <Card className={needsConfirm ? "border-warn" : undefined}>
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">
              {stage === "address" ? "Where should we post it?" : "Posting to"}
            </Text>
            {stage !== "posted" && postTo && (
              <Pressable onPress={() => router.push("/addresses")} hitSlop={10} accessibilityRole="button">
                <Text className="text-[13px] font-semibold text-flame">Change</Text>
              </Pressable>
            )}
          </View>
          <Text className="mt-2 text-[15px] leading-[21px] text-ink">
            {postTo ? postTo.replace(/\s*\n\s*/g, ", ") : "No address saved"}
          </Text>
          {needsConfirm && (
            <>
              <Text className="mt-2 text-[13.5px] leading-[19px] text-warn">
                {postTo
                  ? "Is this where your post should go? We hold your pack until you confirm."
                  : "Add the address we should post it to."}
              </Text>
              {error && <Text className="mt-1.5 text-[13px] text-danger">{error}</Text>}
              <Button className="mt-3" onPress={postTo ? confirm : () => router.push("/addresses")} disabled={busy}>
                {busy ? "Saving…" : postTo ? (stage === "address" ? "Send my pack here" : "Yes, post it here") : "Add my address"}
              </Button>
            </>
          )}
        </Card>

        {stage !== "address" && (
          <Button variant="ghost" onPress={() => router.back()}>
            Done
          </Button>
        )}
      </ScrollView>
    </View>
  );
}
