import { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { cardExpiryOf } from "@/lib/validate";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/ui";
import { IdCardPicker, type IdCardState } from "@/components/id-card-picker";

// For engineers who tapped "I'll add my ID photo later" at signup (30 Sept
// build notes, step 2 item 10) — reached from the dashboard strip "Add your
// Gas Safe ID to go live", and from Account to replace a card that's
// expiring. The badge stays pending until a reviewer has it. The expiry on
// the card goes with the photo; the register is re-checked before then.
export default function AddId() {
  const { me, refreshMe } = useAuth();
  const [card, setCard] = useState<IdCardState>({ phase: "empty" });
  const [expiry, setExpiry] = useState("");
  const [expiryError, setExpiryError] = useState<string | null>(null);

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="bg-bg-deep">
        <AppHeader title={me?.gasSafeVerifiedAt ? "Your Gas Safe ID" : "Add your Gas Safe ID"} />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-10 pt-5">
        <Text className="text-[15px] leading-[21px] text-white/85">
          We check every member&apos;s registration, usually within 24 hours. Your Verified Member
          badge goes live once we have a photo of your card.
        </Text>
        {/* Review 4 — the number they already gave at sign-up, so they can
            check the card matches it. */}
        {me?.gasSafeNo && (
          <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-line-strong px-4 py-3">
            <Text className="text-[14px] text-muted">Gas Safe registration number</Text>
            <Text className="tabular-nums text-[16px] font-semibold text-ink">{me.gasSafeNo}</Text>
          </View>
        )}
        <Text className="mb-1.5 mt-4 text-[14px] font-medium text-white">Expiry date on the card</Text>
        <TextInput
          value={expiry}
          onChangeText={(v) => {
            setExpiry(v);
            setExpiryError(null);
          }}
          placeholder="DD/MM/YYYY"
          placeholderTextColor="#6e86a3"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          className={`min-h-[52px] rounded-xl border-[1.5px] bg-[#081321] px-4 text-[17px] text-white ${expiryError ? "border-danger" : "border-white/20"}`}
        />
        {expiryError && <Text className="mt-1 text-[13px] text-danger">{expiryError}</Text>}
        <View className="mt-4">
          <IdCardPicker
            value={card}
            onChange={setCard}
            upload={async (photo) => {
              const checked = cardExpiryOf(expiry);
              if ("error" in checked) {
                setExpiryError(checked.error);
                throw new Error(checked.error);
              }
              await api("/api/settings/gas-safe-card", {
                method: "POST",
                body: JSON.stringify({ base64: photo.base64, mimeType: photo.mimeType, expiresOn: checked.iso }),
              });
              await refreshMe();
            }}
          />
        </View>
        <Text className="mt-2.5 text-[12.5px] leading-[17px] text-white/60">
          Needed for your Verified Member badge. Only used to verify you — never shown to customers.
        </Text>
        {card.phase === "added" && (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            className="mt-6 min-h-[54px] items-center justify-center rounded-2xl bg-white"
          >
            <Text className="text-[16px] font-bold text-on-light">Done</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
