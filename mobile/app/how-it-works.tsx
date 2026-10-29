import { useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { AppHeader } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { useAuth } from "@/lib/auth-context";
import { KEEP_PENCE_PER_CUSTOMER, formatPounds } from "@/lib/earnings";

// How It Works page — full rebuild to the 30 Sept build notes. This is where
// engineers decide to sign up, so it sells: why join, how it works, what
// they earn, what they get, and a button to start. Never gated (Part 6.5).
// Money here is always the clean 80% — TradeSura pays Stripe's processing
// (Build Review 3).

const BLUE = "#5FA3F0";

// Matt's card art (30 Sept build notes, section C) — each image carries its
// own number, title and text, so nothing is drawn over it. The words stay in
// CARDS for the screen-reader label.
// The JPGs include a dark outer frame. Show only their shared inner area;
// the transparent viewport adds no border, padding, shadow or background.
const CARD_CROP = { x: 6, y: 14, width: 788, height: 890 };
const CARD_RATIO = CARD_CROP.width / CARD_CROP.height;
const CARDS: { title: string; body: string; image?: ImageSourcePropType }[] = [
  {
    title: "Job Complete",
    image: require("../assets/how-it-works/card-1.jpg"),
    body: "Any job done — install, repair or service. The engineer shows the homeowner their care plan.",
  },
  {
    title: "Signed Up On The Spot",
    image: require("../assets/how-it-works/card-2.jpg"),
    body: "They sign up on your phone in about a minute — no forms, no homework.",
  },
  {
    title: "Confirmation Sent",
    image: require("../assets/how-it-works/card-3.jpg"),
    body: "A text with their plan, full terms and how to manage or cancel, plus a confirmation email.",
  },
  {
    title: "You Get Paid",
    image: require("../assets/how-it-works/card-4.jpg"),
    body: "Your 80% lands in your bank every Friday, month after month.",
  },
  {
    title: "Looked After Every Year",
    image: require("../assets/how-it-works/card-5.jpg"),
    body: "Automatic reminders bring you back for every visit on their plan.",
  },
];

const WHY: { icon: IconName; badge?: IconName; title: string; line: string }[] = [
  { icon: "shield", title: "Be the trusted installer", line: "Your Verified badge wins customers' trust" },
  // No handshake in SF Symbols — same pairing the Invite row already uses
  // (hand.raised on iOS, the Material handshake on Android).
  { icon: "referral", title: "Keep your customers", line: "They call you, not the next engineer on Google" },
  { icon: "calendar", badge: "coin", title: "Steady income all year", line: "Plan payments keep coming, even in quiet months" },
  { icon: "reminders", title: "Repeat work, automatically", line: "We remind your customers when they're due" },
  { icon: "boiler", badge: "verified", title: "Keep their warranty valid", line: "Many manufacturers require an annual service" },
];

const HARD_BITS = [
  "Direct Debit collection",
  "Chasing failed payments",
  "Customer reminders",
  "Import your existing customers",
  "Your own sign-up page",
  "Paid every Friday",
];

const PACK: { icon: IconName; label: string }[] = [
  { icon: "van", label: "Van stickers" },
  { icon: "home", label: "Window sticker" },
  { icon: "booklet", label: "Quick-start booklet" },
  { icon: "leaflets", label: "Leaflets" },
  { icon: "qr", label: "QR labels" },
];

const SCRIPT =
  "“I put all my customers on a care plan now — £12 a month and you’re first in my diary. Your annual service comes with it once your third payment’s gone through. It takes a minute — shall we set you up now?”";

const TIPS = [
  "Offer at every job, while you're still there.",
  "Sign them up on your phone there and then. Never leave them homework.",
  "If they say “not now”, offer again at your next visit.",
];

const FAQ = [
  {
    q: "Is it insurance?",
    a: "No. It's a service plan between you and your customer: maintenance visits and priority booking with you. Never breakdown cover or insurance.",
  },
  {
    q: "Does it cost me anything?",
    a: "No. It's free to join. TradeSura takes 20% of the plan payments you collect, and you keep 80%.",
  },
  {
    q: "What if a customer cancels?",
    a: "Their payments simply stop. Plans are monthly with no contract, so nobody's locked in, which is exactly why customers say yes.",
  },
  {
    q: "When do I get paid?",
    a: "Every Friday: your 80% of that week's cleared payments, straight to your bank.",
  },
];

// A £12 plan at 80%, in pence so the maths stays exact (1 → £9.60 / £115.20,
// 100 → £960 / £11,520 — the build notes' test values). From the shared
// earnings config, same as W0.
const KEEP_PENCE = KEEP_PENCE_PER_CUSTOMER;
const SLIDER_MIN = 1;
// 4 Oct notes 5.3 — up to a real book size (200 × £9.60 × 12 = £23,040/yr).
const SLIDER_MAX = 200;

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 text-[11.5px] font-bold uppercase tracking-[2px]" style={{ color: BLUE }}>
      {children}
    </Text>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-2xl border border-line-strong bg-paper p-4 ${className}`}>{children}</View>
  );
}

function Carousel() {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const GAP = 12;
  const PEEK = 28;
  const cardW = width - 32 - PEEK;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / (cardW + GAP));
    setIndex(Math.max(0, Math.min(CARDS.length - 1, i)));
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + GAP}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={32}
        className="-mx-4"
        contentContainerStyle={{ paddingHorizontal: 16, gap: GAP }}
      >
        {CARDS.map((c, i) => (
          <View
            key={c.title}
            style={{ width: cardW, height: cardW / CARD_RATIO, overflow: "hidden", borderRadius: cardW * 0.06, backgroundColor: "transparent" }}
            accessible
            accessibilityLabel={`Step ${i + 1} of ${CARDS.length}. ${c.title}. ${c.body}`}
          >
            {c.image ? (
              <Image
                source={c.image}
                style={{
                  position: "absolute",
                  width: cardW * 800 / CARD_CROP.width,
                  height: cardW * 969 / CARD_CROP.width,
                  left: -cardW * CARD_CROP.x / CARD_CROP.width,
                  top: -cardW * CARD_CROP.y / CARD_CROP.width,
                }}
                resizeMode="cover"
              />
            ) : (
              <View className="flex-1 p-4">
                <View className="flex-row items-center gap-2.5">
                  <View
                    className="h-8 w-8 items-center justify-center rounded-full"
                    style={{ backgroundColor: BLUE }}
                  >
                    <Text className="text-[16px] font-bold text-on-light">{i + 1}</Text>
                  </View>
                  <Text className="shrink text-[21px] font-bold text-white">{c.title}</Text>
                </View>
                <Text className="mt-2 text-[14px] leading-[20px] text-white/80">{c.body}</Text>
                {/* Reserved for the card illustration. */}
                <View className="mt-4 flex-1 rounded-xl bg-white/[0.04]" />
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View className="mt-3 flex-row items-center gap-3">
        <View className="flex-1 flex-row gap-1.5">
          {CARDS.map((c, i) => {
            const filled = i <= index;
            // The last segment goes green on the last card, matching the
            // payout segment of the ring.
            const colour = !filled
              ? "rgba(255,255,255,0.15)"
              : i === CARDS.length - 1
                ? "#3DD68C"
                : BLUE;
            return <View key={c.title} className="h-1 flex-1 rounded-full" style={{ backgroundColor: colour }} />;
          })}
        </View>
        {index === 0 && <Text className="text-[12px] text-white/55">Swipe →</Text>}
      </View>
    </View>
  );
}

// One continuous track, dragged or tapped anywhere along it. Hand-rolled on
// the responder system — the app has no slider dependency and this doesn't
// earn one.
function CustomerSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<View>(null);
  const [track, setTrack] = useState({ x: 0, w: 1 });
  const THUMB = 26;

  function measure() {
    trackRef.current?.measureInWindow((x, _y, w) => setTrack({ x, w: Math.max(1, w) }));
  }

  function fromPageX(pageX: number) {
    const f = Math.max(0, Math.min(1, (pageX - track.x) / track.w));
    const v = Math.round(SLIDER_MIN + f * (SLIDER_MAX - SLIDER_MIN));
    if (v !== value) onChange(v);
  }

  const f = (value - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN);

  return (
    <View
      ref={trackRef}
      onLayout={measure}
      className="h-10 justify-center"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        measure();
        fromPageX(e.nativeEvent.pageX);
      }}
      onResponderMove={(e) => fromPageX(e.nativeEvent.pageX)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Number of customers"
      accessibilityValue={{ min: SLIDER_MIN, max: SLIDER_MAX, now: value, text: `${value} customers` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === "increment" ? 1 : -1;
        onChange(Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, value + step)));
      }}
    >
      <View className="h-1.5 rounded-full bg-white/15">
        <View className="h-full rounded-full" style={{ width: `${f * 100}%`, backgroundColor: BLUE }} />
      </View>
      <View
        pointerEvents="none"
        className="absolute rounded-full bg-white"
        style={{
          width: THUMB,
          height: THUMB,
          left: `${f * 100}%`,
          marginLeft: -THUMB / 2,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      />
    </View>
  );
}

function Earnings() {
  const [customers, setCustomers] = useState(25);
  const monthly = customers * KEEP_PENCE;
  return (
    <View>
      <Panel>
        <SectionLabel>Your earnings</SectionLabel>
        <Text className="text-center text-[15px] text-white">
          {customers} {customers === 1 ? "customer" : "customers"}
        </Text>
        <View className="px-2">
          <CustomerSlider value={customers} onChange={setCustomers} />
        </View>
        <Text className="mt-1 text-center text-[20px] font-bold text-white">
          <Text className="text-[40px] font-extrabold text-copper">{formatPounds(monthly)}</Text> a month
        </Text>
        <Text className="mt-0.5 text-center text-[20px] font-bold text-copper">
          {formatPounds(monthly * 12)} a year
        </Text>
      </Panel>
      <Text className="mt-2 text-center text-[12.5px] text-white/60">
        Based on a £12 a month plan. You set your own price.
      </Text>
    </View>
  );
}

function FaqRow({ q, a, last }: { q: string; a: string; last: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View className={last ? "" : "border-b border-line"}>
      <Pressable
        onPress={() => setOpen(!open)}
        className="min-h-[52px] flex-row items-center justify-between gap-3 py-3"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text className="shrink text-[15px] font-semibold text-white">{q}</Text>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <Icon name="chevronDown" size={14} color="#9fb6d0" weight="semibold" />
        </View>
      </Pressable>
      {open && <Text className="pb-3.5 text-[14px] leading-[20px] text-white/80">{a}</Text>}
    </View>
  );
}

export default function HowItWorks() {
  const { token, me } = useAuth();
  const signedIn = Boolean(token);
  // 4 Oct notes 5.5 — signed in, never "Start now": "Build my first plan"
  // until there is one, then no button at all (Back stays).
  const showStart = !signedIn || !me?.hasPlan;

  function start() {
    if (signedIn) router.push("/plans");
    else router.push("/sign-up");
  }

  function backHome() {
    if (signedIn) router.replace("/");
    else if (router.canGoBack()) router.back();
    else router.replace("/welcome");
  }

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="bg-bg-deep">
        <AppHeader title="How it works" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-40 pt-4">
        <Text className="text-[27px] font-extrabold leading-[32px] tracking-tight text-white">
          More trust. More customers. Paid every month.
        </Text>

        <View className="mt-4">
          <Carousel />
        </View>

        <View className="mt-7">
          <SectionLabel>Why become a member</SectionLabel>
          {WHY.map((w, i) => (
            <View
              key={w.title}
              className={`flex-row items-center gap-3.5 py-3 ${i < WHY.length - 1 ? "border-b border-line" : ""}`}
            >
              <View className="h-10 w-10 items-center justify-center">
                <Icon name={w.icon} size={28} color={BLUE} />
                {w.badge && (
                  <View className="absolute bottom-0 right-0 rounded-full bg-bg">
                    <Icon name={w.badge} size={14} color={BLUE} weight="bold" />
                  </View>
                )}
              </View>
              <View className="shrink">
                <Text className="text-[15.5px] font-bold text-white">{w.title}</Text>
                <Text className="mt-0.5 text-[13px] text-white/65">{w.line}</Text>
              </View>
            </View>
          ))}
        </View>

        <View className="mt-6">
          <Earnings />
        </View>

        <Panel className="mt-6">
          <Text className="mb-1.5 text-[17px] font-bold text-white">We handle the hard bits</Text>
          {HARD_BITS.map((b) => (
            <View key={b} className="flex-row items-center gap-2.5 py-1.5">
              <Icon name="check" size={15} color={BLUE} weight="bold" />
              <Text className="text-[14.5px] text-white">{b}</Text>
            </View>
          ))}
        </Panel>
        <Text className="mt-3 text-center text-[15px] italic text-white">
          You do the job. We do the admin.
        </Text>

        <Panel className="mt-6 items-center">
          <Text className="self-start text-[17px] font-bold text-white">Your free member pack</Text>
          {/* The real Verified Member badge, unaltered (build notes §G). */}
          <Image
            source={require("../assets/brand/verified-member-badge.png")}
            style={{ width: 150, height: 150 }}
            className="my-4"
            accessibilityLabel="TradeSura Verified Member badge"
          />
          <View className="w-full flex-row justify-between">
            {PACK.map((p) => (
              <View key={p.label} className="flex-1 items-center gap-1.5">
                <Icon name={p.icon} size={26} color={BLUE} />
                <Text className="text-center text-[12px] leading-[15px] text-white">{p.label}</Text>
              </View>
            ))}
          </View>
          <Text className="mt-3.5 text-[12.5px] text-white/60">Posted free when your badge goes live.</Text>
        </Panel>

        <Panel className="mt-6">
          <Text className="text-[17px] font-bold text-white">What to say at the job</Text>
          <Text className="mt-2 text-[15px] leading-[22px] text-white">{SCRIPT}</Text>
          <Text className="mb-1 mt-4 text-[13px] font-bold text-white">Three tips</Text>
          {TIPS.map((t) => (
            <View key={t} className="flex-row gap-2.5 py-1">
              <View className="mt-[7px] h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BLUE }} />
              <Text className="shrink text-[14px] leading-[20px] text-white/85">{t}</Text>
            </View>
          ))}
        </Panel>

        <Text className="mb-1 mt-7 text-[19px] font-bold text-white">Quick answers</Text>
        <View className="rounded-2xl border border-line-strong bg-paper px-4">
          {FAQ.map((f, i) => (
            <FaqRow key={f.q} q={f.q} a={f.a} last={i === FAQ.length - 1} />
          ))}
        </View>
      </ScrollView>

      {/* Sticky — always visible while scrolling (build notes §J). */}
      <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0 border-t border-line bg-bg px-4 pt-3">
        {showStart && (
          <Pressable
            onPress={start}
            className="min-h-[54px] items-center justify-center rounded-2xl bg-white"
            accessibilityRole="button"
          >
            <Text className="text-[16px] font-extrabold text-on-light">
              {signedIn ? "Build my first plan" : "Start now — it's free"}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={backHome} hitSlop={6} className="items-center py-2.5">
          <Text className="text-[13px] text-white/60">Back to home</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}
