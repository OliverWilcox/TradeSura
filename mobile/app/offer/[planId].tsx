import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button, Tick } from "@/components/ui";
import { Skeleton, Bone, TextBone, LoadingImage } from "@/components/skeleton";

type LinkInfo = { link: string; qrDataUrl: string };

type Status = {
  status: "PENDING" | "ACTIVE" | "PAUSED" | "CANCELLED";
  opened: boolean;
  tierChosen: boolean;
  bankStarted: boolean;
  priceMonthlyPence: number | null;
  customerFirstName: string;
  customerLastName: string;
  incomeMonthlyPence: number;
  activePlans: number;
};

const STEPS = ["LINK SENT", "OPENED", "CHOOSING TIER", "BANK DETAILS", "ACTIVE"] as const;

function stepIndex(s: Status) {
  if (s.status === "ACTIVE") return 4;
  if (s.bankStarted) return 3;
  if (s.opened) return 2;
  return 0;
}

export default function OfferLive() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { me } = useAuth();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [showQr, setShowQr] = useState(false);
  const stopped = useRef(false);

  useEffect(() => {
    api<LinkInfo>(`/api/offer/${planId}`)
      .then(setInfo)
      .catch((e) => setInfoError(e instanceof ApiError ? e.message : "Couldn't load the link."));
  }, [planId]);

  // Live status theatre — 2s polling, same cadence as the web app.
  useEffect(() => {
    stopped.current = false;
    async function tick() {
      try {
        const data = await api<Status>(`/api/plans/${planId}/status`);
        if (stopped.current) return;
        setStatus(data);
        if (data.status === "ACTIVE") return;
      } catch {
        // transient network hiccup — keep polling rather than surfacing an error here
      }
      if (!stopped.current) setTimeout(tick, 2000);
    }
    tick();
    return () => {
      stopped.current = true;
    };
  }, [planId]);

  if (status?.status === "ACTIVE") {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-8">
        <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-flame-tint">
          <Tick size={36} />
        </View>
        <Text className="text-center text-[21px] font-extrabold text-ink">
          {status.customerFirstName} joined — +£
          {Math.round(((status.priceMonthlyPence ?? 0) * 12) / 100)}/yr
        </Text>
        <Text className="text-center text-sm text-muted">
          {status.customerFirstName} {status.customerLastName} is on a plan at{" "}
          <Text className="font-mono font-bold text-ink">
            £{Math.round((status.priceMonthlyPence ?? 0) / 100)}/mo
          </Text>
          .
        </Text>
        <Text className="font-mono text-3xl font-extrabold text-copper">
          £{Math.round(status.incomeMonthlyPence / 100)}
          <Text className="text-base font-bold text-muted"> /month</Text>
        </Text>
        <Text className="font-mono text-xs text-faint">
          locked in across {status.activePlans} active plan{status.activePlans === 1 ? "" : "s"}
        </Text>
        <Button onPress={() => router.replace("/")} className="mt-4 w-64">
          Back to the dashboard
        </Button>
      </View>
    );
  }

  const idx = status ? stepIndex(status) : 0;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Offer a plan" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        {/* Part 16 — route 2's after-state: a quiet confirmation. */}
        {status && (
          <View className="flex-row items-center gap-2 rounded-xl bg-flame-tint px-3.5 py-2.5">
            <Tick size={16} />
            <Text className="text-[14px] font-semibold text-ink">
              Offer sent to {status.customerFirstName}
            </Text>
          </View>
        )}
        <Card>
          <Text className="mb-2 font-semibold text-sm text-ink">Link sent by text</Text>
          {infoError ? (
            <Text className="font-sans text-sm text-danger">{infoError}</Text>
          ) : !info ? (
            <Skeleton label="Loading the signup link">
              <TextBone width="90%" size={12} />
              <Bone height={48} radius={12} style={{ marginTop: 12 }} />
              <Bone height={48} radius={12} style={{ marginTop: 8 }} />
            </Skeleton>
          ) : (
            <>
              <Text selectable className="font-mono text-xs text-muted">
                {info.link}
              </Text>
              <Button
                variant="ghost"
                className="mt-3"
                onPress={() => {
                  const brand = me?.tradingName ?? "your engineer";
                  const msg = `Hi — it's ${brand}. Here's the link to set up your care plan: ${info.link}`;
                  const wa = `whatsapp://send?text=${encodeURIComponent(msg)}`;
                  Linking.canOpenURL(wa).then((ok) =>
                    Linking.openURL(ok ? wa : `https://wa.me/?text=${encodeURIComponent(msg)}`),
                  );
                }}
              >
                Also share on WhatsApp
              </Button>
              <Button variant="ghost" className="mt-2" onPress={() => setShowQr(!showQr)}>
                {showQr ? "Hide QR" : "Show QR on my screen instead"}
              </Button>
              {showQr && (
                <View className="items-center py-3">
                  <LoadingImage
                    uri={info.qrDataUrl}
                    width={280}
                    height={280}
                    accessibilityLabel="QR code for the signup link"
                  />
                </View>
              )}
            </>
          )}
        </Card>

        <Card>
          <Micro className="mb-2">Live status</Micro>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {STEPS.map((step, i) => (
              <Text
                key={step}
                className={`font-mono font-medium text-[10px] ${
                  i < idx ? "text-flame-deep" : i === idx ? "text-flame" : "text-faint"
                }`}
              >
                {i < idx ? "● " : i === idx ? "◉ " : "○ "}
                {step}
                {i < STEPS.length - 1 ? " —" : ""}
              </Text>
            ))}
          </View>
          <View className="mt-2.5 h-2 overflow-hidden rounded-full bg-line-soft">
            <View className="h-full rounded-full bg-flame" style={{ width: `${(idx / 4) * 100}%` }} />
          </View>
        </Card>

        {status && (
          <Card className="border-copper-tint bg-copper-tint">
            <Text className="font-sans text-xs text-copper-deep">
              {status.customerFirstName} signs at{" "}
              <Text className="font-mono font-semibold">
                {status.priceMonthlyPence ? `£${Math.round(status.priceMonthlyPence / 100)}/mo` : "£15/mo"}
              </Text>{" "}
              → your income becomes{" "}
              <Text className="font-mono font-semibold">
                £
                {Math.floor(
                  (status.incomeMonthlyPence + (status.priceMonthlyPence ?? 1500)) / 100,
                )}
                /mo
              </Text>
              . One job. Forever-ish.
            </Text>
          </Card>
        )}

        <Micro className="text-center">
          Didn&apos;t finish? Follow-up texts go out this evening and in 3 days automatically.
        </Micro>
      </ScrollView>
    </View>
  );
}
