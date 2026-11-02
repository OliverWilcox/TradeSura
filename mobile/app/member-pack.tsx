import { useState } from "react";
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, Pressable, Image, type ImageSourcePropType } from "react-native";
import { router } from "expo-router";
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

export default function MemberPack() {
  const { me, refreshMe } = useAuth();
  const stage = stageOf(me);
  const [address, setAddress] = useState(me?.packAddress ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (address.trim().length < 10) {
      setError("Enter your full postal address, including the postcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // First time asks for the pack; after that only the address moves.
      const path = stage === "address" ? "/api/onboarding/pack" : "/api/settings/pack-address";
      await api(path, { method: "POST", body: JSON.stringify({ address: address.trim() }) });
      await refreshMe();
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your address.");
    } finally {
      setBusy(false);
    }
  }

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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
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

          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">
                {stage === "address" ? "Where should we post it?" : "Posting to"}
              </Text>
              {(stage === "waiting" || stage === "packing") && !editing && (
                <Pressable onPress={() => setEditing(true)} hitSlop={10}>
                  <Text className="text-[13px] font-semibold text-flame">Change</Text>
                </Pressable>
              )}
            </View>
            {stage === "address" || editing ? (
              <>
                <TextInput
                  value={address}
                  onChangeText={(v) => {
                    setAddress(v);
                    setError(null);
                  }}
                  placeholder="Full postal address, including postcode"
                  placeholderTextColor="#6e86a3"
                  multiline
                  textAlignVertical="top"
                  className="mt-2 min-h-[96px] rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] text-ink"
                />
                {error && <Text className="mt-1.5 text-[13px] text-danger">{error}</Text>}
                <Button className="mt-3" onPress={save} disabled={busy}>
                  {busy ? "Saving…" : stage === "address" ? "Send my pack" : "Save address"}
                </Button>
                {editing && (
                  <Pressable
                    onPress={() => {
                      setEditing(false);
                      setAddress(me?.packAddress ?? "");
                      setError(null);
                    }}
                    className="mt-2 items-center py-1"
                  >
                    <Text className="text-[13px] text-muted">Cancel</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <Text className="mt-2 text-[15px] leading-[21px] text-ink">{me?.packAddress || "No address saved"}</Text>
            )}
          </Card>

          {stage !== "address" && (
            <Button variant="ghost" onPress={() => router.back()}>
              Done
            </Button>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
