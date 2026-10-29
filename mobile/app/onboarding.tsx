import { useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { goLiveSteps, growSteps, packStatus, type SetupStep, type StepTone } from "@/lib/setup-steps";
import { Button } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { RingMarkProgress } from "@/components/ring-mark";
import { StripeBadge } from "@/components/stripe-badge";

// Matt's Getting Started layout (Review 4, 28 Oct). GO LIVE: the three steps
// needed to take customers, counted by the ring. GROW: any time, optional.
// The member pack is a status card. Once the three are done the hub becomes
// the "You're live" screen. State comes from /api/me (lib/setup-steps.ts).

const PILL: Record<StepTone, { box: string; text: string }> = {
  done: { box: "bg-ok/15", text: "text-ok" },
  amber: { box: "bg-warn-tint", text: "text-warn" },
  grey: { box: "bg-white/10", text: "text-muted" },
  red: { box: "bg-danger-tint", text: "text-danger" },
};

function StatusPill({ tone, label }: { tone: StepTone; label: string }) {
  return (
    <View className={`mt-1.5 self-start rounded-md px-2 py-0.5 ${PILL[tone].box}`}>
      <Text className={`text-[12px] font-semibold ${PILL[tone].text}`}>{label}</Text>
    </View>
  );
}

// Looks like a button; the whole row is the tap target (no nested buttons).
function SmallButton({ label, primary }: { label: string; primary?: boolean }) {
  return (
    <View className={`rounded-xl px-3.5 py-2 ${primary ? "bg-white" : "border border-line-strong"}`}>
      <Text className={`text-[13.5px] font-bold ${primary ? "text-on-light" : "text-ink"}`}>{label}</Text>
    </View>
  );
}

function GoLiveRow({ n, step, current }: { n: number; step: SetupStep; current: boolean }) {
  const open = () => router.push(step.href);
  return (
    <Pressable
      onPress={open}
      disabled={step.done || step.waiting}
      accessibilityRole="button"
      accessibilityLabel={`${step.title}: ${step.status}`}
      className={`flex-row items-center gap-3.5 rounded-2xl border px-3.5 py-3.5 ${current ? "border-[1.5px] border-flame" : "border-line-strong"}`}
    >
      {step.done ? (
        <View className="h-10 w-10 items-center justify-center rounded-full bg-ok">
          <Icon name="check" size={18} color="#0f2140" weight="bold" />
        </View>
      ) : (
        <View className="h-10 w-10 items-center justify-center rounded-full border border-line-strong">
          <Text className="text-[17px] font-semibold text-ink">{n}</Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="text-[16.5px] font-semibold text-ink">{step.title}</Text>
        <Text className="mt-0.5 text-[13px] text-muted">
          {step.sub}
          {step.money && <Text className="font-semibold text-ok">{step.money}</Text>}
        </Text>
        <StatusPill tone={step.tone} label={step.status} />
      </View>
      {!step.done && !step.waiting && step.cta && <SmallButton label={step.cta} primary={current} />}
    </Pressable>
  );
}

const GROW_ICON: Record<string, IconName> = {
  profile: "search",
  website: "code",
  customers: "customers",
  invite: "share",
};

function GrowRow({ step }: { step: SetupStep }) {
  const open = () => router.push(step.href);
  return (
    <Pressable
      onPress={open}
      disabled={step.locked}
      accessibilityRole="button"
      accessibilityLabel={`${step.title}: ${step.locked ? "opens once your first plan is live" : step.status}`}
      className={`flex-row items-center gap-3 rounded-2xl border border-line-strong px-3.5 py-3 ${step.locked ? "opacity-60" : ""}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-lg bg-white/5">
        <Icon name={GROW_ICON[step.key] ?? "chevron"} size={17} color="#5fa3f0" />
      </View>
      <View className="flex-1">
        <Text className="text-[15.5px] font-semibold text-ink">{step.title}</Text>
        {step.key === "invite" && !step.done ? (
          <Text className="mt-0.5 text-[13px] font-semibold text-ok">{step.sub}</Text>
        ) : step.locked ? (
          <Text className="mt-0.5 text-[13px] text-muted">{step.sub}</Text>
        ) : (
          <StatusPill tone={step.tone} label={step.status} />
        )}
      </View>
      {step.locked ? (
        <Icon name="lock" size={16} color="#c9d6e6" weight="semibold" />
      ) : (
        step.cta && <SmallButton label={step.cta} />
      )}
    </Pressable>
  );
}

const PACK_ITEMS = ["Van stickers", "Window sticker", "Quick-start booklet", "Leaflets", "QR labels"];

function MemberPackCard() {
  const { me } = useAuth();
  const pack = packStatus(me);
  const address = me?.packAddress?.replace(/\s*\n\s*/g, ", ");
  return (
    <View className="gap-2 rounded-2xl border border-dashed border-line-strong px-3.5 py-3.5">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-white/5">
          <Icon name="mail" size={17} color="#5fa3f0" />
        </View>
        <View className="flex-1">
          <Text className="text-[15.5px] font-semibold text-ink">Your member pack</Text>
          <Text className="mt-0.5 text-[13px] text-muted">{pack.line}</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-1.5">
        {PACK_ITEMS.map((item) => (
          <View key={item} className="w-[58px] items-center justify-center rounded-md border border-line-strong bg-white/5 px-1 py-2">
            <Text className="text-center text-[9.5px] leading-[12px] text-muted">{item}</Text>
          </View>
        ))}
      </View>
      <Text className="text-[13px] text-muted">
        {address ? `To: ${address} · ` : ""}
        <Text className="font-semibold text-flame" onPress={() => router.push("/member-pack")}>
          {address ? "Change" : "Add address"}
        </Text>
      </Text>
      <StatusPill tone={pack.tone} label={pack.status} />
    </View>
  );
}

function Footer() {
  return (
    <>
      {/* Part 5 — "How TradeSura works", never gated. */}
      <Pressable onPress={() => router.push("/how-it-works")} className="items-center py-1">
        <Text className="text-[15px] font-semibold text-flame">How TradeSura works</Text>
      </Pressable>
      <View className="items-center">
        <StripeBadge height={22} />
      </View>
    </>
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

  const live = goLiveSteps(me);
  const grow = growSteps(me);
  const done = live.filter((s) => s.done).length;
  const currentIdx = live.findIndex((s) => !s.done && !s.waiting);
  const isLive = done === live.length;

  // "Skip for now" / "Go to dashboard": Home, and setup exits stop pulling
  // back here (lib/setup-exit.ts reads the same skipped flag).
  function toDashboard() {
    skipStripe();
    router.replace("/");
  }

  if (isLive) {
    const keepGrowing = grow.filter((s) => !s.done);
    return (
      <View className="flex-1 bg-bg">
        <SafeAreaView edges={["top"]} className="flex-1">
          <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-8">
            <View className="items-center">
              <View className="items-center justify-center" style={{ width: 130, height: 130 }}>
                <RingMarkProgress size={130} progress={1} />
                <View className="absolute">
                  <Icon name="check" size={40} color="#ffffff" weight="bold" />
                </View>
              </View>
              <Text className="mt-5 text-center text-[30px] font-extrabold leading-[36px] text-ink">
                {me?.firstName ? `You're live, ${me.firstName}!` : "You're live!"}
              </Text>
              <Text className="mt-2 text-center text-[15px] text-muted">
                Your Verified Member badge is on, payments are switched on
                {me?.firstPlan ? ` and ${me.firstPlan.name} is ready to sell.` : "."}
              </Text>
            </View>
            <Button className="mt-3" onPress={() => router.push("/offer")}>
              {(me?.activePlans ?? 0) > 0 ? "Offer a plan" : "Offer your first plan"}
            </Button>
            <Button variant="ghost" onPress={toDashboard}>
              Go to dashboard
            </Button>

            {keepGrowing.length > 0 && (
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-flame">Keep growing</Text>
                <Text className="text-[12.5px] text-muted">Any time</Text>
              </View>
            )}
            {keepGrowing.map((s) => (
              <GrowRow key={s.key} step={s} />
            ))}
            <MemberPackCard />
            <Footer />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  const next = live[currentIdx];
  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-3">
          {/* One "Skip to dashboard" at the top, as on the design. */}
          <View className="flex-row justify-end">
            <Pressable
              onPress={toDashboard}
              accessibilityRole="button"
              className="rounded-full border border-line-strong px-3.5 py-1.5"
            >
              <Text className="text-[13.5px] font-semibold text-flame">Skip to dashboard</Text>
            </Pressable>
          </View>

          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-[30px] font-extrabold leading-[36px] text-ink" numberOfLines={1} adjustsFontSizeToFit>
                Getting started
              </Text>
              <Text className="mt-1 text-[21px] font-bold text-ink">
                {me?.firstName ? `Welcome, ${me.firstName}` : "Welcome"}
              </Text>
            </View>
            <View className="items-center justify-center" style={{ width: 88, height: 88 }}>
              <RingMarkProgress size={88} progress={done / live.length} />
              <View className="absolute items-center">
                <Text className="text-[17px] font-extrabold text-ink">
                  {done} of {live.length}
                </Text>
                <Text className="text-[10px] text-muted">to go live</Text>
              </View>
            </View>
          </View>
          <Text className="text-[15px] text-muted">Three steps and you can take customers. About 5 minutes.</Text>

          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-flame">Go live</Text>
            <Text className="text-[12.5px] text-muted">Needed to take customers</Text>
          </View>
          {live.map((s, i) => (
            <GoLiveRow key={s.key} n={i + 1} step={s} current={next?.key === s.key} />
          ))}

          <Button variant="ghost" className="mt-1" onPress={toDashboard}>
            Skip for now · go to dashboard
          </Button>
          <Text className="-mt-1 text-center text-[13px] text-muted">You can finish these any time from Home.</Text>

          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-flame">Grow</Text>
            <Text className="text-[12.5px] text-muted">Any time · optional</Text>
          </View>
          {grow.map((s) => (
            <GrowRow key={s.key} step={s} />
          ))}
          <MemberPackCard />
          <Footer />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
