import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Animated,
  Easing,
  AccessibilityInfo,
  Share,
  Linking,
  Modal,
  Image,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import { offerLock } from "@/lib/offer-lock";

// 2026 Build Guide TARGET_plan_live — the celebration after "Make this plan
// live": the ring, a moment of confetti, what each customer is worth, the
// plan link to share, and what to do next.

type Link = { url: string; display: string; qrDataUrl: string };

const FEE_RATE = 0.2;
const CONFETTI = [
  { x: 0.08, y: 0.1, r: 30, c: "#5FA3F0" },
  { x: 0.26, y: 0.05, r: -20, c: "#5FA3F0" },
  { x: 0.2, y: 0.4, r: 40, c: "#3DD68C" },
  { x: 0.1, y: 0.62, r: -35, c: "#5FA3F0" },
  { x: 0.24, y: 0.82, r: 20, c: "#5FA3F0" },
  { x: 0.72, y: 0.08, r: -30, c: "#5FA3F0" },
  { x: 0.88, y: 0.12, r: 25, c: "#3DD68C" },
  { x: 0.92, y: 0.52, r: -25, c: "#3DD68C" },
  { x: 0.78, y: 0.56, r: 35, c: "#5FA3F0" },
  { x: 0.88, y: 0.74, r: -15, c: "#5FA3F0" },
  { x: 0.74, y: 0.86, r: 45, c: "#3DD68C" },
];

function Confetti({ width, height, reduceMotion }: { width: number; height: number; reduceMotion: boolean }) {
  const [fall] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(fall, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fall, reduceMotion]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {CONFETTI.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x * width,
            top: p.y * height,
            width: 16,
            height: 10,
            borderRadius: 2,
            backgroundColor: p.c,
            opacity: fall.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [
              { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
              { rotate: `${p.r}deg` },
            ],
          }}
        />
      ))}
    </View>
  );
}

function NextRow({
  icon,
  title,
  sub,
  onPress,
  last,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-4 py-3.5 ${last ? "" : "border-b border-line-strong"}`}
    >
      <Icon name={icon} size={26} color="#5fa3f0" />
      <View className="flex-1">
        <Text className="text-[16px] font-semibold text-ink">{title}</Text>
        <Text className="mt-0.5 text-[13.5px] text-muted">{sub}</Text>
      </View>
      <Icon name="chevron" size={15} color="#c9d6e6" weight="semibold" />
    </Pressable>
  );
}

export default function PlanLive() {
  const { me } = useAuth();
  const { name, pricePence } = useLocalSearchParams<{ name: string; pricePence: string }>();
  const { width } = useWindowDimensions();
  const [link, setLink] = useState<Link | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => setReduceMotion(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      api<Link>("/api/me/plan-link").then(setLink).catch(() => {});
    }, []),
  );

  const price = Number(pricePence) || 0;
  const yearly = Math.round(((price - Math.floor(price * FEE_RATE)) * 12) / 100);
  const brand = me?.tradingName?.trim() || "you";
  const display = link?.display ?? (me?.slug ? `tradesura.com/p/${me.slug}` : "your plan link");
  // Review 3 — offers (and sharing the plan link) wait for the Gas Safe check
  // and payments; until then the money strip becomes an amber bar.
  const lock = offerLock(me ? { ...me, hasPlan: true } : me);
  const shareText = `Here are my care plans — pick one and pay monthly by Direct Debit: ${link?.url ?? ""}`;

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    if (!link) return;
    if ((await copyText(link.url)) === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  async function whatsapp() {
    const wa = `whatsapp://send?text=${encodeURIComponent(shareText)}`;
    if (await Linking.canOpenURL(wa).catch(() => false)) return Linking.openURL(wa);
    await Share.share({ message: shareText }).catch(() => {});
  }

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <ScrollView contentContainerClassName="px-4 pb-6">
          <View className="items-center pb-4 pt-6">
            <Confetti width={width - 32} height={200} reduceMotion={reduceMotion} />
            <RingMark size={150} />
          </View>
          <Text className="text-center text-[30px] font-extrabold leading-[36px] text-ink">
            {name} is live!
          </Text>
          <Text className="mt-2 text-center text-[15px] text-muted">
            {lock
              ? `Nice one, ${brand}. Customers can join once payments are set up and your Gas Safe check is done.`
              : `Nice one, ${brand}. Customers can join from today.`}
          </Text>

          {lock ? (
            <Pressable
              onPress={() => router.push(lock.href)}
              className="mt-5 flex-row items-center gap-2.5 rounded-2xl border border-warn/50 bg-warn-tint px-4 py-3.5"
            >
              <Icon name="warning" size={17} color="#F5B544" />
              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-warn">
                  {lock.href === "/more" ? "Waiting for your Gas Safe check" : "Set up payments to start taking customers"}
                </Text>
                <Text className="mt-0.5 text-[13px] text-warn">{lock.reason}</Text>
              </View>
              <Icon name="chevron" size={14} color="#F5B544" weight="semibold" />
            </Pressable>
          ) : (
            price > 0 && (
              <View className="mt-5 items-center rounded-2xl border border-line-strong px-4 py-3.5">
                <Text className="text-center text-[16px] font-semibold text-ok">
                  Every customer on this plan = £{yearly} a year to you
                </Text>
              </View>
            )
          )}

          <View className="mt-3 rounded-2xl border border-line-strong p-4">
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Your plan link</Text>
            <Text
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              className="mt-1.5 text-[22px] font-bold text-ink"
            >
              {display}
            </Text>
            <View className="mt-3 flex-row gap-2">
              {[
                { icon: "copy" as const, label: copied ? "Copied" : "Copy link", onPress: copyLink },
                { icon: "message" as const, label: "WhatsApp", onPress: whatsapp },
                { icon: "qr" as const, label: "Show QR", onPress: () => setQrOpen(true) },
              ].map((b) => (
                <Pressable
                  key={b.label}
                  onPress={b.onPress}
                  disabled={!link || Boolean(lock)}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-line-strong py-3 ${link && !lock ? "" : "opacity-50"}`}
                >
                  <Icon name={b.icon} size={17} />
                  <Text className="text-[14px] text-ink">{b.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="mt-3 rounded-2xl border border-line-strong px-4 pt-3">
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">What&apos;s next</Text>
            <NextRow
              icon="search"
              title="Get found on Google"
              sub="Your free profile page"
              onPress={() => router.push("/profile")}
            />
            <NextRow
              icon="globe"
              title="Add your plans to your website"
              sub="Sell plans there too"
              onPress={() => router.push("/website")}
            />
            <NextRow
              icon="customers"
              title="Invite engineers you know"
              sub="Earn 25% of our fee on their plans"
              onPress={() => router.push("/referral")}
              last
            />
          </View>

          <View className="mt-4 gap-2.5">
            {lock ? (
              <>
                <Button onPress={() => router.push(lock.href)}>{lock.cta}</Button>
                <Button variant="ghost" onPress={() => router.push("/demo")}>
                  Try it in demo mode
                </Button>
              </>
            ) : (
              <Button onPress={() => router.replace("/offer")}>Offer it to a customer now</Button>
            )}
            <Button variant="ghost" onPress={() => router.replace("/plan-wizard")}>
              Add another plan
            </Button>
            <Pressable onPress={() => router.replace("/(tabs)/(home)/plans")} className="items-center py-3">
              <Text className="text-[15px] font-semibold text-flame">Back to My plans</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/80 px-8" onPress={() => setQrOpen(false)}>
          <View className="items-center rounded-3xl bg-white p-6">
            {link && <Image source={{ uri: link.qrDataUrl }} style={{ width: 260, height: 260 }} />}
            <Text className="mt-3 text-center text-[16px] font-bold text-on-light">Scan to see {brand}&apos;s plans</Text>
            <Text className="mt-1 text-center text-[13px] text-on-light/70">{display}</Text>
          </View>
          <Text className="mt-5 text-[14px] text-white/80">Tap anywhere to close</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
