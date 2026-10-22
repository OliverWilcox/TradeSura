import { useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { setupSteps, type SetupStep } from "@/lib/setup-steps";
import { Icon } from "@/components/icon";
import { RingProgress } from "@/components/ring-progress";
import { StripeBadge } from "@/components/stripe-badge";
import { StripeStatusCard } from "@/components/stripe-status-card";

// 2026 Build Guide TARGET_getting_started_hub — seven numbered steps, a
// progress ring, and the Gas Safe check status. Steps can be done in any
// order; the first unfinished one is highlighted with its button inline.
// State is derived from /api/me (lib/setup-steps.ts), never stored.

function StepRow({ n, step, current }: { n: number; step: SetupStep; current: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(step.href)}
      accessibilityRole="button"
      accessibilityLabel={`Step ${n}: ${step.title}${step.done ? ", done" : ""}`}
      className={`flex-row items-center gap-3.5 rounded-2xl border px-3.5 py-3.5 ${current ? "border-[1.5px] border-flame" : "border-line-strong"}`}
    >
      <View className="h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-paper">
        <Text className="text-[20px] font-semibold text-ink">{n}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-[17px] font-semibold text-ink">{step.title}</Text>
        <Text className="mt-0.5 text-[13.5px] text-muted">
          {step.sub}
          {step.money && <Text className="font-semibold text-ok">{step.money}</Text>}
        </Text>
      </View>
      {step.done ? (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-ok">
          <Icon name="check" size={18} color="#0f2140" weight="bold" />
        </View>
      ) : current ? (
        <View className="flex-row items-center gap-1.5">
          <View className="rounded-xl bg-white px-3 py-2">
            <Text className="text-[13.5px] font-bold text-on-light">{step.cta}</Text>
          </View>
          <Icon name="chevron" size={15} color="#c9d6e6" weight="semibold" />
        </View>
      ) : (
        <Icon name="chevron" size={15} color="#c9d6e6" weight="semibold" />
      )}
    </Pressable>
  );
}

export default function Onboarding() {
  const { me, refreshMe, skipStripe } = useAuth();

  // Steps come from the profile — re-read it whenever the hub comes back
  // into view (returning from the wizard, Stripe, an import…).
  useFocusEffect(
    useCallback(() => {
      refreshMe();
    }, [refreshMe]),
  );

  const steps = setupSteps(me);
  const done = steps.filter((s) => s.done).length;
  const currentIdx = steps.findIndex((s) => !s.done);
  const verified = Boolean(me?.gasSafeVerifiedAt);
  const rejected = Boolean(me?.gasSafeRejectedAt) && !verified;
  const inReview = Boolean(me?.gasSafeReviewRequestedAt) && !verified && !rejected;

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 pb-8 pt-4">
          <View className="flex-row items-start justify-between">
            {/* One line on a 6.1" phone, as on the target. */}
            <Text className="flex-1 pt-6 text-[30px] font-extrabold leading-[36px] text-ink" numberOfLines={1} adjustsFontSizeToFit>
              Getting started
            </Text>
            <View className="items-center justify-center" style={{ width: 96, height: 96 }}>
              <RingProgress size={96} strokeWidth={12} progress={done / steps.length} />
              <Text className="absolute text-[18px] font-semibold text-ink">
                {done} of {steps.length}
              </Text>
            </View>
          </View>

          <View>
            <Text className="text-[26px] font-bold text-ink">
              {me?.firstName ? `Welcome, ${me.firstName}` : "Welcome"}
            </Text>
            <Text className="mt-1 text-[15px] text-muted">
              A few quick steps and you&apos;re earning. About 10 minutes in total.
            </Text>
          </View>

          {inReview && (
            <View className="flex-row items-center justify-center gap-2 rounded-xl border border-warn/50 bg-warn-tint px-3 py-2.5">
              <Icon name="clock" size={17} color="#F5B544" />
              <Text className="text-[14px] text-warn">Gas Safe check in progress · usually within 24 hours</Text>
            </View>
          )}
          {rejected && (
            <Pressable
              onPress={() => router.push("/more")}
              className="flex-row items-center justify-center gap-2 rounded-xl border border-danger/50 bg-danger-tint px-3 py-2.5"
            >
              <Icon name="warning" size={16} color="#ff6b6b" />
              <Text className="text-[14px] text-danger">Your Gas Safe check needs attention — tap to see why</Text>
            </Pressable>
          )}

          <StripeStatusCard state={me?.stripeState} />

          {steps.map((s, i) => (
            <StepRow key={s.key} n={i + 1} step={s} current={i === currentIdx} />
          ))}

          {/* Part 5 — "How TradeSura works", never gated. */}
          <Pressable onPress={() => router.push("/how-it-works")} className="py-1">
            <Text className="text-[15px] font-semibold text-flame">How TradeSura works</Text>
          </Pressable>

          <View className="items-start">
            <StripeBadge caption="Paid out every Friday" height={22} light />
          </View>

          <Pressable
            onPress={() => {
              if (!me?.stripeConnected) skipStripe();
              router.replace("/");
            }}
            className="items-center py-3"
          >
            <Text className="text-[15px] text-muted">
              {done === steps.length ? "Go to my dashboard" : "Skip setup for now"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
