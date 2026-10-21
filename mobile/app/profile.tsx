import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Linking, KeyboardAvoidingView, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button, Tick } from "@/components/ui";
import { Icon } from "@/components/icon";
import { CenteredSpinner } from "@/components/skeleton";

// Getting started · "Get found on Google" — the engineer's free public
// profile at tradesura.com/{slug}. Publishing lets search engines index it
// (the page itself always works as the plan link).

type Profile = { profileBio: string; serviceArea: string; published: boolean; url: string; display: string };

const BIO_MAX = 600;

export default function ProfileScreen() {
  const { me, refreshMe } = useAuth();
  const [data, setData] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ field: string; explanation: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Profile>("/api/me/profile")
        .then((p) => {
          setData(p);
          setBio(p.profileBio);
          setArea(p.serviceArea);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your profile."));
    }, []),
  );

  async function save(publish: boolean) {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      await api("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({ profileBio: bio, serviceArea: area, publish }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refreshMe();
      setData((d) => (d ? { ...d, published: publish, profileBio: bio, serviceArea: area } : d));
      if (publish) router.back();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { field?: string; explanation?: string } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 422 && body?.explanation && body.field) {
        setBlocked({ field: body.field, explanation: body.explanation });
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't save your profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  const brand = me?.tradingName?.trim() || "Your business";
  const verified = Boolean(me?.gasSafeVerifiedAt);

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started · Get found" />
      </SafeAreaView>
      {!data ? (
        error ? (
          <Text className="p-6 text-center text-sm text-danger">{error}</Text>
        ) : (
          <CenteredSpinner label="Loading your profile" />
        )
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
            <View>
              <Text className="text-[22px] font-bold text-ink">Your free profile page</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                One page with your plans, your Gas Safe status and the areas you cover. Publish it
                and Google can find it when people near you search for boiler care.
              </Text>
            </View>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Your address</Text>
              <Text selectable className="mt-1.5 text-[18px] font-bold text-ink">
                {data.display}
              </Text>
              <View className="mt-2 flex-row items-center gap-2">
                {data.published ? (
                  <>
                    <Tick size={13} />
                    <Text className="text-[13px] text-ink">Published — open to search engines</Text>
                  </>
                ) : (
                  <Text className="text-[13px] text-muted">Not published yet — the page works as your plan link</Text>
                )}
              </View>
              <Pressable onPress={() => Linking.openURL(data.url)} className="mt-2.5 flex-row items-center gap-1.5">
                <Icon name="globe" size={15} color="#5fa3f0" />
                <Text className="text-[14px] font-semibold text-flame">See your page</Text>
              </Pressable>
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Areas you cover</Text>
              <TextInput
                value={area}
                onChangeText={(v) => {
                  setArea(v);
                  setBlocked(null);
                }}
                maxLength={120}
                placeholder="e.g. Brighton, Hove and Lewes"
                placeholderTextColor="#6e86a3"
                className="mt-2 min-h-[48px] rounded-xl border border-line-strong bg-bg px-3.5 text-[16px] text-ink"
              />
              <Text className="mt-1.5 text-[12.5px] text-muted">Towns or postcode areas — what people type into Google.</Text>
              {blocked?.field === "serviceArea" && (
                <Text className="mt-2 text-[13px] text-danger">{blocked.explanation}</Text>
              )}
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">About {brand}</Text>
              <TextInput
                value={bio}
                onChangeText={(v) => {
                  setBio(v.slice(0, BIO_MAX));
                  setBlocked(null);
                }}
                multiline
                maxLength={BIO_MAX}
                placeholder="How long you've been trading, the boilers you know best, what customers say about you."
                placeholderTextColor="#6e86a3"
                textAlignVertical="top"
                className="mt-2 min-h-[130px] rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] leading-[22px] text-ink"
              />
              <Text className="mt-1 text-right text-[12px] text-muted">
                {bio.length}/{BIO_MAX}
              </Text>
              {blocked?.field === "profileBio" && (
                <Text className="mt-1 text-[13px] text-danger">{blocked.explanation}</Text>
              )}
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Also on your page</Text>
              {[
                "Your live plans, with a Join button",
                verified ? "Your Gas Safe verified badge" : "Your Gas Safe badge, once it's verified",
                "How it works and common questions",
                "The gas emergency number, on every page",
              ].map((t) => (
                <View key={t} className="flex-row items-center gap-2 py-1">
                  <Tick size={12} />
                  <Text className="flex-1 text-[14px] text-ink">{t}</Text>
                </View>
              ))}
            </Card>

            {error && <Text className="px-1 text-sm text-danger">{error}</Text>}

            <Button onPress={() => save(true)} disabled={busy}>
              {busy ? "Saving…" : data.published ? "Save changes" : "Publish my profile"}
            </Button>
            {data.published ? (
              <Pressable onPress={() => save(false)} disabled={busy} className="items-center py-2">
                <Text className="text-[14px] text-muted underline">Hide from search engines</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => save(false)} disabled={busy} className="items-center py-2">
                <Text className="text-[14px] font-semibold text-flame">Save without publishing</Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
