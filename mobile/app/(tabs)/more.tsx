import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, RefreshControl, Pressable, Linking } from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { stripeResultError } from "@/lib/stripe";
import { AppHeader, Card, Micro, Pill, RowLine, Button } from "@/components/ui";

type MoreData = {
  totalPence: number;
  count: number;
  fee: number;
  confirmed: number;
  failed: number;
  queuedSms: number;
};
type Settings = {
  tradingName: string;
  logoUrl: string;
  slug: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  businessType: string | null;
  companyNumber: string | null;
  postcode: string | null;
};

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  sole_trader: "Sole trader",
  ltd: "Limited company",
  partnership: "Partnership",
};

// More hub — settings, Stripe status, payouts summary, sign out.
// The full Payouts & Collections screen (Screen 12) is P1 and stays web-only;
// this is just the summary CLAUDE.md scoped into the hub.
export default function More() {
  const { me, refreshMe, signOut } = useAuth();
  const [data, setData] = useState<MoreData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [tradingName, setTradingName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [savedSettings, setSavedSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const [flushBusy, setFlushBusy] = useState(false);
  const [flushResult, setFlushResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api<MoreData>("/api/more"), api<Settings>("/api/settings")]);
      setData(m);
      setSettings(s);
      setTradingName(s.tradingName);
      setLogoUrl(s.logoUrl);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this page.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const dirty = settings
    ? tradingName !== settings.tradingName || logoUrl !== settings.logoUrl
    : false;

  async function saveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ tradingName, logoUrl }),
      });
      setSettings({ ...settings, tradingName, logoUrl });
      setSavedSettings(true);
      await refreshMe();
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function connectStripe() {
    setStripeBusy(true);
    setStripeError(null);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/connect-link");
      const result = await WebBrowser.openAuthSessionAsync(url, "tradesura://onboarding");
      const err = stripeResultError(result);
      if (err) setStripeError(err);
      else if (result.type === "success") await refreshMe();
    } catch (e) {
      setStripeError(e instanceof ApiError ? e.message : "Couldn't start payment setup.");
    } finally {
      setStripeBusy(false);
    }
  }

  async function flushQueue() {
    setFlushBusy(true);
    try {
      const result = await api<{ sent: number; remindersQueued: number }>(
        "/api/jobs/flush-sms",
        { method: "POST" },
      );
      setFlushResult(`${result.sent} sent, ${result.remindersQueued} reminders queued`);
      await load();
    } catch {
      // dev-only tool; silent on failure is acceptable here
    } finally {
      setFlushBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="More" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        <Card>
          <Text className="mb-1 font-semibold text-sm text-ink">Your business</Text>
          <View className="py-1.5">
            {me?.gasSafeNo && me.gasSafeVerifiedAt ? (
              <View className="flex-row items-center gap-1.5 self-start rounded-md border border-[#EBD98F] bg-[#FFF6D6] px-2 py-0.5">
                <Text className="font-semibold text-[10.5px] text-warn">
                  ▲ GAS SAFE VERIFIED {me.gasSafeNo}
                </Text>
              </View>
            ) : (
              // Gas Safe verification is mandatory during sign-up now, so a
              // signed-in engineer without it is a legacy/edge case — nothing
              // in-app re-runs that check anymore, so no link to dangle here.
              <Text className="font-sans text-xs text-faint">Not yet Gas Safe verified</Text>
            )}
          </View>
          {settings && (settings.firstName || settings.phone || settings.businessType) && (
            <View className="mb-1 mt-1">
              {(settings.firstName || settings.lastName) && (
                <RowLine
                  left="Name"
                  right={`${settings.firstName ?? ""} ${settings.lastName ?? ""}`.trim()}
                />
              )}
              {settings.phone && (
                <RowLine
                  left="Mobile"
                  right={
                    <Text className="font-mono text-sm text-ink">
                      {settings.phone}
                      {settings.phoneVerifiedAt ? " ✓" : ""}
                    </Text>
                  }
                />
              )}
              {settings.businessType && (
                <RowLine
                  left="Business type"
                  right={BUSINESS_TYPE_LABELS[settings.businessType] ?? settings.businessType}
                />
              )}
              {settings.companyNumber && (
                <RowLine left="Company number" right={settings.companyNumber} />
              )}
              {settings.postcode && <RowLine left="Business postcode" right={settings.postcode} />}
            </View>
          )}
          <Text className="mt-2 font-sans text-xs text-muted">Trading name</Text>
          <TextInput
            value={tradingName}
            onChangeText={(v) => {
              setTradingName(v);
              setSavedSettings(false);
            }}
            className="mt-1 rounded-[10px] border border-line bg-paper px-3 py-2.5 font-sans text-sm text-ink"
          />
          <Text className="mt-2 font-sans text-xs text-muted">Logo URL (optional)</Text>
          <TextInput
            value={logoUrl}
            onChangeText={(v) => {
              setLogoUrl(v);
              setSavedSettings(false);
            }}
            placeholder="https://…"
            autoCapitalize="none"
            className="mt-1 rounded-[10px] border border-line bg-paper px-3 py-2.5 font-sans text-sm text-ink"
          />
          {settings && (
            <Text className="mt-2 font-sans text-[11px] text-faint">
              Customer pages: /p/{settings.slug}/… — the address updates if you rename.
            </Text>
          )}
          {settingsError && (
            <Text className="mt-2 font-sans text-sm text-danger">{settingsError}</Text>
          )}
          {dirty && (
            <Button
              variant="ghost"
              onPress={saveSettings}
              disabled={savingSettings || tradingName.length < 2}
              className="mt-3"
            >
              {savingSettings ? "Saving…" : "Save changes"}
            </Button>
          )}
          {savedSettings && !dirty && (
            <Text className="mt-2 font-semibold text-xs text-ok">✓ Saved</Text>
          )}
        </Card>

        <Card>
          <Text className="mb-1 font-semibold text-sm text-ink">Payments</Text>
          {me?.stripeConnected ? (
            <RowLine
              left="Stripe"
              right={
                <Pill tone="ok">
                  {me.stripePayoutsEnabled ? "ACTIVE" : "ACTIVE · PAYOUTS PENDING"}
                </Pill>
              }
            />
          ) : (
            <>
              {stripeError && (
                <Text className="mb-2 font-sans text-xs text-danger">{stripeError}</Text>
              )}
              <Pressable onPress={connectStripe} disabled={stripeBusy}>
                <Text className="font-semibold text-sm text-flame-deep">
                  {stripeBusy
                    ? "Opening…"
                    : me?.stripeDetailsSubmitted
                      ? "Finish payment setup →"
                      : "Set up payments →"}
                </Text>
              </Pressable>
            </>
          )}
        </Card>

        {data && (
          <Card>
            <Micro className="mb-1.5">This month, transparently</Micro>
            <RowLine
              left="Expected plan collections"
              right={`£${(data.totalPence / 100).toFixed(2)}`}
            />
            <RowLine left="TradeSura fee (20%)" right={`−£${(data.fee / 100).toFixed(2)}`} />
            <RowLine
              left={<Text className="font-bold text-sm text-ink">To your bank (before DD costs)</Text>}
              right={
                <Text className="font-mono font-semibold text-copper">
                  £{((data.totalPence - data.fee) / 100).toFixed(2)}
                </Text>
              }
            />
            <RowLine left="Collections confirmed / failed" right={`${data.confirmed} / ${data.failed}`} />
            <Text className="mt-1 font-sans text-[11px] text-faint">
              Across {data.count} active plan{data.count === 1 ? "" : "s"} · full payout detail is
              coming soon.
            </Text>
          </Card>
        )}

        {data && (
          <Card>
            <Text className="mb-1 font-semibold text-sm text-ink">Message queue (dev)</Text>
            <RowLine
              left="Queued texts (nudges, reminders, quiet hours)"
              right={<Pill tone={data.queuedSms > 0 ? "info" : "off"}>{data.queuedSms}</Pill>}
            />
            <Button variant="ghost" onPress={flushQueue} disabled={flushBusy} className="mt-2">
              {flushBusy ? "Flushing…" : "Run queue now"}
            </Button>
            {flushResult && (
              <Text className="mt-1.5 font-semibold text-xs text-ok">✓ {flushResult}</Text>
            )}
          </Card>
        )}

        <Card>
          <Pressable onPress={() => router.push("/messages")}>
            <RowLine left="Messages & tickets" right={<Pill tone="info">OPEN</Pill>} />
          </Pressable>
          <Pressable onPress={() => router.push("/payouts")}>
            <RowLine left="Payouts & collections" right={<Pill tone="info">OPEN</Pill>} />
          </Pressable>
          <Pressable onPress={() => router.push("/referral")}>
            <RowLine left="Refer an engineer · £50" right={<Pill tone="ok">OPEN</Pill>} />
          </Pressable>
          <Pressable onPress={() => router.push("/customers/blast")}>
            <RowLine left="Offer campaign" right={<Pill tone="info">OPEN</Pill>} />
          </Pressable>
          <Pressable onPress={() => router.push("/trades")}>
            <RowLine left="Trades & TradePacks" right={<Pill tone="info">OPEN</Pill>} />
          </Pressable>
        </Card>

        <Card>
          <Pressable
            onPress={() => router.push({ pathname: "/coming-soon", params: { title: "How to sell more plans" } })}
          >
            <RowLine left="📈 How to sell more plans" right={<Text className="text-faint">›</Text>} />
          </Pressable>
          <Pressable
            onPress={() =>
              Linking.openURL(
                "https://wa.me/447700900000?text=" + encodeURIComponent("TradeSura support: "),
              )
            }
          >
            <RowLine left="💬 WhatsApp support" right={<Text className="text-faint">›</Text>} />
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: "/coming-soon", params: { title: "Terms & privacy" } })}
          >
            <RowLine left="📄 Terms & privacy" right={<Text className="text-faint">›</Text>} />
          </Pressable>
        </Card>

        <Button variant="dangerghost" onPress={signOut}>
          Sign out
        </Button>
        <Micro className="text-center">Signed in as {me?.email}</Micro>
      </ScrollView>
    </View>
  );
}
