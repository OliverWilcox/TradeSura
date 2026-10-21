import { useState, type ReactNode } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getConnectLinkWithRetry, stripeResultError } from "@/lib/stripe";
import { AppHeader, Button, OpeningStripe } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { StripeBadge } from "@/components/stripe-badge";

// 2026 Build Guide TARGET_pre_stripe — "Get paid every Friday". Sets
// expectations before handing over to Stripe's hosted onboarding: how the
// money flows, why Stripe asks questions, and what to have ready.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="rounded-2xl border border-line-strong p-4">
      <Text className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.1em] text-flame">{title}</Text>
      {children}
    </View>
  );
}

function FlowRow({ icon, n, children }: { icon: IconName; n: number; children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-3.5 py-2">
      <Icon name={icon} size={22} />
      <Text className="w-4 text-[18px] font-bold text-ink">{n}</Text>
      <Text className="flex-1 text-[15.5px] text-ink">{children}</Text>
    </View>
  );
}

export default function GetPaid() {
  const { me, refreshMe, skipStripe } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connectStripe() {
    setBusy(true);
    setError(null);
    try {
      // Build Guide v2 review 17 Sept, B3 — see lib/stripe.ts's
      // getConnectLinkWithRetry for why a single retry belongs here.
      const { url } = await getConnectLinkWithRetry();
      // Build Guide v2 Part 17.1 — an ephemeral session kills iOS's "wants
      // to use stripe.com" prompt (ignored, harmlessly, on Android).
      const result = await WebBrowser.openAuthSessionAsync(url, "tradesura://onboarding", {
        preferEphemeralSession: true,
      });
      const err = stripeResultError(result);
      if (err) setError(err);
      else if (result.type === "success") {
        await refreshMe();
        router.back();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start payment setup.");
    } finally {
      setBusy(false);
    }
  }

  const cta = me?.stripeDetailsSubmitted ? "Finish with Stripe" : "Continue to Stripe";

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started · Get paid" />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-3 px-4 pb-8 pt-5">
        <View className="flex-row items-center justify-center gap-6 py-3">
          <View className="h-24 w-16 items-center justify-center rounded-2xl border-2 border-white/80">
            <Icon name="phone" size={30} color="#3dd68c" />
          </View>
          <Icon name="chevron" size={26} color="#c9d6e6" />
          <View className="items-center justify-center">
            <Icon name="bank" size={64} color="#c9d6e6" />
            <View className="absolute -bottom-1 -right-3 h-9 w-9 items-center justify-center rounded-full bg-ok">
              <Icon name="pound" size={18} color="#0f2140" weight="bold" />
            </View>
          </View>
        </View>
        <Text className="text-[28px] font-extrabold text-ink">Get paid every Friday</Text>

        <Section title="How your money flows">
          <FlowRow icon="calendar" n={1}>
            Your customer pays monthly by Direct Debit
          </FlowRow>
          <FlowRow icon="person" n={2}>
            You keep <Text className="font-bold text-ink">80%</Text>
          </FlowRow>
          <FlowRow icon="bank" n={3}>
            Paid into your bank every Friday
          </FlowRow>
        </Section>

        <Section title="Why Stripe asks a few questions">
          <Text className="text-[15.5px] leading-[23px] text-ink">
            The law requires every business that takes payments to be checked. It&apos;s a one-off.
            We&apos;ve already filled in what we can from your sign-up, so you just check it.
          </Text>
        </Section>

        <Section title="Have these ready · about 3 minutes">
          {[
            "Your bank sort code and account number",
            "Your date of birth and home address",
            "Sometimes a photo of your driving licence or passport",
          ].map((t) => (
            <View key={t} className="flex-row items-center gap-3 py-1.5">
              <View className="h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-flame">
                <Icon name="check" size={13} color="#5fa3f0" weight="bold" />
              </View>
              <Text className="flex-1 text-[15px] text-ink">{t}</Text>
            </View>
          ))}
        </Section>

        <View className="flex-row gap-2.5 px-1">
          <Icon name="lock" size={16} color="#9fb6d0" />
          <Text className="flex-1 text-[13.5px] leading-[20px] text-muted">
            TradeSura never sees your bank login. Stripe is regulated by the FCA. Stop halfway and
            we&apos;ll save your progress.
          </Text>
        </View>

        <View className="py-1">
          <StripeBadge />
        </View>

        {error && (
          <Text className="px-1 text-sm text-danger">
            {error} Tap &ldquo;{cta}&rdquo; to try again.
          </Text>
        )}

        <Button onPress={connectStripe} disabled={busy}>
          {cta}
        </Button>
        {busy && <OpeningStripe />}
        <Pressable
          onPress={() => {
            skipStripe();
            router.back();
          }}
          className="items-center py-2.5"
        >
          <Text className="text-[15px] font-semibold text-flame">I&apos;ll do this later</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
