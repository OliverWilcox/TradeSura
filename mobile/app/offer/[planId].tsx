import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Image, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

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
      <View className="flex-1 items-center justify-center gap-4 bg-iron px-8">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-flame">
          <Text className="text-3xl font-bold text-white">✓</Text>
        </View>
        <Text className="text-center font-disp-bold text-3xl uppercase tracking-wide text-white">
          Plan active — +£{Math.round((status.priceMonthlyPence ?? 0) / 100)}/mo locked in
        </Text>
        <Text className="text-center font-sans text-sm text-[#C7D0D9]">
          {status.customerFirstName} {status.customerLastName} is on a plan at{" "}
          <Text className="font-mono-semibold text-[#C7D0D9]">
            £{Math.round((status.priceMonthlyPence ?? 0) / 100)}/mo
          </Text>
          .
        </Text>
        <Text className="font-mono-semibold text-2xl text-[#F3B27E]">
          £{Math.round(status.incomeMonthlyPence / 100)}/mo
        </Text>
        <Text className="font-mono text-xs text-[#8FA0B0]">
          locked in across {status.activePlans} active plan{status.activePlans === 1 ? "" : "s"}
        </Text>
        <Button variant="copper" onPress={() => router.replace("/(tabs)")} className="mt-4 w-64">
          Back to the dashboard
        </Button>
      </View>
    );
  }

  const idx = status ? stepIndex(status) : 0;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Offer a plan</Micro>} />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <Card>
          <Text className="mb-2 font-sans-semibold text-sm text-ink">Link sent by text</Text>
          {infoError ? (
            <Text className="font-sans text-sm text-danger">{infoError}</Text>
          ) : !info ? (
            <ActivityIndicator color="#0E7FD0" />
          ) : (
            <>
              <Text selectable className="font-mono text-xs text-muted">
                {info.link}
              </Text>
              <Button variant="ghost" className="mt-3" onPress={() => setShowQr(!showQr)}>
                {showQr ? "Hide QR" : "Show QR on my screen instead"}
              </Button>
              {showQr && (
                <View className="items-center py-3">
                  <Image source={{ uri: info.qrDataUrl }} style={{ width: 280, height: 280 }} />
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
                className={`font-mono-medium text-[10px] ${
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
          <Card className="border-[#EBCDB8] bg-copper-tint">
            <Text className="font-sans text-xs text-[#7A4A26]">
              {status.customerFirstName} signs at{" "}
              <Text className="font-mono-semibold">
                {status.priceMonthlyPence ? `£${Math.round(status.priceMonthlyPence / 100)}/mo` : "£15/mo"}
              </Text>{" "}
              → your income becomes{" "}
              <Text className="font-mono-semibold">
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
