import { useEffect, useState } from "react";
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button } from "@/components/ui";
import { Toggle } from "@/components/toggle";
import { Skeleton, TextBone } from "@/components/skeleton";
import { AddressLookupField, type AddressValue } from "@/components/address-lookup";

// Engineer record 1 (lib/addresses.ts): the trading address sets the town
// and town page; post, including the member pack, goes to the trading
// address or one of its own. Saving here also confirms where the pack goes
// (packs wait for that, lib/admin/member-packs.ts).

type Parts = { lines: string[]; town: string; postcode: string };
type Addresses = {
  trading: Parts | null;
  correspondenceParts: Parts | null;
  correspondenceSameAsTrading: boolean;
};

const EMPTY: AddressValue = { line1: "", town: "", postcode: "" };

function toValue(a: Parts | null): AddressValue {
  return a ? { line1: a.lines.join(", "), town: a.town, postcode: a.postcode } : EMPTY;
}

function toInput(v: AddressValue) {
  return { lines: [v.line1.trim()], town: v.town.trim(), postcode: v.postcode.trim() };
}

function missing(v: AddressValue): string | null {
  if (!v.line1.trim()) return "Enter the first line of the address.";
  if (!v.town.trim()) return "Enter the town.";
  if (!v.postcode.trim()) return "Enter the postcode.";
  return null;
}

export default function AddressesScreen() {
  const { refreshMe } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [trading, setTrading] = useState<AddressValue>(EMPTY);
  const [post, setPost] = useState<AddressValue>(EMPTY);
  const [same, setSame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "trading" | "correspondence"; text: string } | null>(null);

  useEffect(() => {
    api<{ addresses: Addresses }>("/api/settings")
      .then(({ addresses }) => {
        setTrading(toValue(addresses.trading));
        setSame(addresses.correspondenceSameAsTrading);
        if (!addresses.correspondenceSameAsTrading) setPost(toValue(addresses.correspondenceParts));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    const t = missing(trading);
    if (t) return setError({ field: "trading", text: t });
    const c = same ? null : missing(post);
    if (c) return setError({ field: "correspondence", text: c });
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings/addresses", {
        method: "PUT",
        body: JSON.stringify({ trading: toInput(trading), correspondence: same ? "same" : toInput(post) }),
      });
      await refreshMe();
      router.back();
    } catch (e) {
      const field = e instanceof ApiError && (e.body as { field?: string } | undefined)?.field === "correspondence" ? "correspondence" : "trading";
      setError({ field, text: e instanceof ApiError ? e.message : "Couldn't save your addresses." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Addresses" />
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-3.5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          {!loaded ? (
            <Card>
              <Skeleton label="Loading your addresses" className="gap-2">
                <TextBone width="50%" size={14} />
                <TextBone width="80%" size={14} />
              </Skeleton>
            </Card>
          ) : (
            <>
              <Card>
                <Text className="text-[15px] font-semibold text-ink">Trading address</Text>
                <Text className="mt-0.5 text-[12.5px] leading-[18px] text-muted">
                  Where you work from. It sets your town and your town page.
                </Text>
                <View className="mt-3">
                  <AddressLookupField
                    value={trading}
                    onChange={(v) => {
                      setTrading(v);
                      setError(null);
                    }}
                  />
                </View>
                {error?.field === "trading" && <Text className="mt-1.5 text-[13px] text-danger">{error.text}</Text>}
              </Card>

              <Card>
                <View className="flex-row items-center justify-between gap-3">
                  <View className="shrink">
                    <Text className="text-[15px] font-semibold text-ink">Send my post here too</Text>
                    <Text className="mt-0.5 text-[12.5px] leading-[18px] text-muted">
                      Your member pack and any letters from us.
                    </Text>
                  </View>
                  <Toggle
                    value={same}
                    onValueChange={(v) => {
                      setSame(v);
                      setError(null);
                    }}
                    accessibilityLabel="Send my post to my trading address"
                  />
                </View>
                {!same && (
                  <View className="mt-3 border-t border-line-soft pt-3">
                    <Text className="mb-2 text-[13px] font-semibold text-ink">Where your post goes</Text>
                    <AddressLookupField
                      value={post}
                      onChange={(v) => {
                        setPost(v);
                        setError(null);
                      }}
                    />
                    {error?.field === "correspondence" && (
                      <Text className="mt-1.5 text-[13px] text-danger">{error.text}</Text>
                    )}
                  </View>
                )}
              </Card>

              <Button onPress={save} disabled={busy}>
                {busy ? "Saving…" : "Save addresses"}
              </Button>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
