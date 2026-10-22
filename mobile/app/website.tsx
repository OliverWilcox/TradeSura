import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Button, Tick } from "@/components/ui";
import { Icon } from "@/components/icon";
import { CenteredSpinner } from "@/components/skeleton";
import { checkEmail } from "@/lib/validate";
import { copyText } from "@/lib/clipboard";

// Getting started · "Connect your website" — the embed snippet (public/
// embed.js on the web app), a plain-link fallback, and an email-it-to-my-
// web-person option. The step ticks itself off the first time the embed
// loads on a real site.

type Website = { snippet: string; link: string; connected: boolean; host: string | null };

export default function WebsiteScreen() {
  const [data, setData] = useState<Website | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function copy(what: "code" | "link", text: string) {
    if ((await copyText(text)) === "copied") {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  useFocusEffect(
    useCallback(() => {
      api<Website>("/api/me/website")
        .then(setData)
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this."));
    }, []),
  );

  async function send() {
    const invalid = checkEmail(to);
    if (invalid) {
      setSendError(invalid);
      return;
    }
    setSendBusy(true);
    setSendError(null);
    try {
      await api("/api/me/website", { method: "POST", body: JSON.stringify({ to: to.trim() }) });
      setSentTo(to.trim());
      setTo("");
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "Couldn't send that — try again.");
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started · Your website" />
      </SafeAreaView>
      {!data ? (
        error ? (
          <Text className="p-6 text-center text-sm text-danger">{error}</Text>
        ) : (
          <CenteredSpinner label="Loading" />
        )
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
            <View>
              <Text className="text-[22px] font-bold text-ink">Sell plans on your website too</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                Paste one snippet and your live plans appear on your site, always up to date. Customers
                tap Join and finish on your plan page, so no payment details touch your website.
              </Text>
            </View>

            {data.connected && (
              <View className="flex-row items-center gap-2.5 rounded-2xl border border-line-strong px-4 py-3">
                <Tick size={14} />
                <Text className="flex-1 text-[14px] text-ink">
                  Connected{data.host ? ` — seen on ${data.host}` : ""}
                </Text>
              </View>
            )}

            <Card>
              <View className="flex-row items-center gap-2">
                <Icon name="code" size={18} color="#5fa3f0" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Website code</Text>
              </View>
              <View className="mt-2.5 rounded-xl border border-line-strong bg-bg p-3">
                <Text selectable className="tabular-nums text-[12.5px] leading-[19px] text-ink">
                  {data.snippet}
                </Text>
              </View>
              <Text className="mt-2 text-[12.5px] text-muted">
                Works with WordPress, Wix, Squarespace and most site builders: add an HTML or embed
                block where the plans should go.
              </Text>
              <Button variant="ghost" className="mt-3" onPress={() => copy("code", data.snippet)}>
                {copied === "code" ? "Copied" : "Copy the code"}
              </Button>
            </Card>

            <Card>
              <View className="flex-row items-center gap-2">
                <Icon name="mail" size={18} color="#5fa3f0" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">
                  Someone else runs your site?
                </Text>
              </View>
              <Text className="mt-1.5 text-[14px] text-muted">We&apos;ll email them the code and how to add it.</Text>
              <TextInput
                value={to}
                onChangeText={(v) => {
                  setTo(v);
                  setSendError(null);
                }}
                placeholder="their@email.com"
                placeholderTextColor="#6e86a3"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className="mt-2.5 min-h-[48px] rounded-xl border border-line-strong bg-bg px-3.5 text-[16px] text-ink"
              />
              {sendError && <Text className="mt-1.5 text-[13px] text-danger">{sendError}</Text>}
              {sentTo && !sendError && (
                <Text className="mt-1.5 text-[13px] text-ink">Sent to {sentTo}.</Text>
              )}
              <Button variant="ghost" className="mt-3" onPress={send} disabled={sendBusy}>
                {sendBusy ? "Sending…" : "Email the code"}
              </Button>
            </Card>

            <Card>
              <View className="flex-row items-center gap-2">
                <Icon name="link" size={18} color="#5fa3f0" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Or just a link</Text>
              </View>
              <Text className="mt-1.5 text-[14px] text-muted">
                Add a &ldquo;Care plans&rdquo; button or menu item that points here:
              </Text>
              <Text selectable className="mt-1.5 tabular-nums text-[13px] text-ink">
                {data.link}
              </Text>
              <Pressable onPress={() => copy("link", data.link)} className="mt-2.5">
                <Text className="text-[14px] font-semibold text-flame">
                  {copied === "link" ? "Copied" : "Copy the link"}
                </Text>
              </Pressable>
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
