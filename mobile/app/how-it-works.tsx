import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppHeader, Card, Micro } from "@/components/ui";

// Build Guide v2 Part 14 — "How it works. The four steps, the maths, and
// what to say at the door of the job." Absorbs the old "How to sell more
// plans" content (cut from Account, Part 13) — one home for it. Never
// gated (Part 6.5: "Invite an engineer / How it works: Never gated — full
// brightness always").
const STEPS = [
  { n: 1, title: "Build your plan", body: "Pick what's included and set your price — takes a couple of minutes." },
  { n: 2, title: "Offer it at the end of a job", body: "While the boiler's still warm — most offers take under 90 seconds." },
  { n: 3, title: "They set up Direct Debit", body: "On their own phone, or yours if they're standing right there." },
  { n: 4, title: "You get paid every Friday", body: "Your 80% of that week's cleared collections, straight to your bank." },
] as const;

// Duplicated from offer/index.tsx's SCRIPT by hand — small, non-compliance
// display copy (mobile/CLAUDE.md's convention).
const SCRIPT =
  "“I put all my customers on a care plan now — £12 a month and your annual service is included. I’ll text you the link, have a look tonight.”";

export default function HowItWorks() {
  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="How it works" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <Card>
          <Micro className="mb-2">The four steps</Micro>
          {STEPS.map((s) => (
            <View key={s.n} className="flex-row gap-3 border-b border-line-soft py-2.5 last:border-b-0">
              <Text className="font-mono text-sm font-bold text-flame-deep">{s.n}</Text>
              <View className="shrink">
                <Text className="font-semibold text-sm text-ink">{s.title}</Text>
                <Text className="mt-0.5 font-sans text-xs text-muted">{s.body}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card variant="hero">
          <Micro>The maths</Micro>
          {/* Build Guide v2 review 17 Sept, B4 — "the money disagrees with
              itself" between this card and Payouts: this used to show a
              clean 80% (£115.20/yr on £12/mo), while Payouts' transparency
              card correctly deducts processing (~32p/collection) on top of
              the 20% fee, landing at £111.36/yr — a real £3.84/yr gap on
              the same plan. CLAUDE.md's Stripe section is explicit that
              20%-plus-processing is the intended, permanent model (not a
              placeholder), so this card is the one that was wrong — fixed
              to the same number Payouts already shows, computed the same
              way appFeePence + BACS_PROCESSING_FEE_PENCE does server-side
              (lib/clauses.ts). If TRADESURA_FEE_RATE or the processing
              estimate ever change, this example drifts again unless it's
              updated alongside them — there's no shared source these two
              screens both read from yet. */}
          <Text className="mt-1 font-sans text-sm text-white">
            A £12/month plan puts <Text className="font-mono font-bold text-copper">£111.36</Text>{" "}
            a year in your pocket after TradeSura&apos;s 20% fee and processing.
          </Text>
          <Text className="mt-1.5 font-sans text-xs text-night-muted">
            50 customers on that plan is <Text className="font-mono font-bold text-copper">£5,568</Text>{" "}
            a year, paid weekly, for work you were already doing.
          </Text>
        </Card>

        <Card>
          <Micro className="mb-1.5">What to say at the door</Micro>
          <Text className="font-sans text-sm text-ink">{SCRIPT}</Text>
          <Text className="mt-2 font-sans text-[11px] text-faint">
            Text the link there and then — most people set it up that evening.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
