import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, RefreshControl, Pressable, Linking } from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiUrl, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getConnectLinkWithRetry, stripeResultError } from "@/lib/stripe";
import { AppHeader, Avatar, Card, Pill, RowLine, Button, Chevron, OpeningStripe } from "@/components/ui";
import { Skeleton, TextBone, RowBone, LoadingImage } from "@/components/skeleton";
import { StaffAccount } from "@/components/staff-account";
import { Toggle } from "@/components/toggle";
import { WHATSAPP_SUPPORT_URL } from "@/lib/support";

type MoreData = {
  totalPence: number;
  count: number;
  fee: number;
  confirmed: number;
  failed: number;
  queuedSms: number;
};
type Status = { tone: "amber" | "red" | "quiet"; text: string };
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
  legalName?: string | null;
  vatRegistered?: boolean;
  postcode: string | null;
  standing: { state: string } & Status;
  gasSafe: Status;
  gasSafePhotoNeeded?: boolean;
  payments: Status;
};

function StatusLine({ status }: { status: Status }) {
  return (
    <Text className={`font-sans text-sm ${status.tone === "quiet" ? "text-ink" : "text-warn"}`}>
      {status.text}
    </Text>
  );
}

// Mirrors lib/retention.ts WINBACK_OFFERS (display copy only).
type WinbackOffer = "none" | "first_month_free";
const WINBACK_CHOICES: { value: WinbackOffer; label: string }[] = [
  { value: "none", label: "Rejoin in one tap" },
  { value: "first_month_free", label: "Rejoin and get your first month free" },
];

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  sole_trader: "Sole trader",
  ltd: "Limited company",
  partnership: "Partnership",
};

// More hub — settings, Stripe status, payouts summary, sign out.
// The full Payouts & Collections screen (Screen 12) is P1 and stays web-only;
// this is just the summary CLAUDE.md scoped into the hub.
// Build Review 2, section 8 — staff get a cut-down Account: no business
// settings, payments, Team or Refer.
export default function More() {
  const { me } = useAuth();
  return me?.role === "staff" ? <StaffAccount /> : <OwnerAccount />;
}

function OwnerAccount() {
  const { me, refreshMe, signOut } = useAuth();
  const [data, setData] = useState<MoreData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [tradingName, setTradingName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savedSettings, setSavedSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const [vatBusy, setVatBusy] = useState(false);
  const [vatError, setVatError] = useState<string | null>(null);

  const [winback, setWinback] = useState<WinbackOffer | null>(null);
  const [winbackBusy, setWinbackBusy] = useState(false);
  const [winbackError, setWinbackError] = useState<string | null>(null);

  const [flushBusy, setFlushBusy] = useState(false);
  const [flushResult, setFlushResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([api<MoreData>("/api/more"), api<Settings>("/api/settings")]);
      setData(m);
      setSettings(s);
      setTradingName(s.tradingName);
      setFirstName(s.firstName ?? "");
      setLastName(s.lastName ?? "");
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this page.");
    }
    // Separate so an older backend without the route doesn't blank the page.
    api<{ offer: WinbackOffer }>("/api/settings/winback")
      .then((w) => setWinback(w.offer))
      .catch(() => {});
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

  // Build Review 3, section 2 — a company may leave its trading name blank
  // and trade under its Companies House name; a sole trader can't.
  const legalFallback =
    settings && settings.businessType !== "sole_trader" ? settings.legalName?.trim() || null : null;

  const dirty = settings
    ? tradingName !== settings.tradingName ||
      firstName !== (settings.firstName ?? "") ||
      lastName !== (settings.lastName ?? "")
    : false;

  async function saveSettings() {
    if (!settings) return;
    if (!firstName.trim() || !lastName.trim()) {
      setSettingsError("Enter your first and last name.");
      return;
    }
    if (tradingName.trim().length < 2 && !legalFallback) {
      setSettingsError("Enter your trading name — at least 2 characters.");
      return;
    }
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const saved = await api<{ tradingName?: string }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          tradingName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          logoUrl: settings.logoUrl,
        }),
      });
      // A blank name on a company comes back as its Companies House name;
      // keep the box blank then (Review 4), with that name as its placeholder.
      const returned = saved.tradingName ?? tradingName;
      const name = legalFallback && returned.trim() === legalFallback ? "" : returned;
      setTradingName(name);
      setSettings({ ...settings, tradingName: name, firstName: firstName.trim(), lastName: lastName.trim() });
      setSavedSettings(true);
      await refreshMe();
    } catch (e) {
      setSettingsError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSavingSettings(false);
    }
  }

  // Review #15 — upload the image directly instead of asking for a hosted
  // URL most engineers don't have; stored in our own Blob store.
  //
  // Base64 JSON, not multipart FormData: this Expo SDK's fetch/FormData
  // bridge throws "Unsupported FormDataPart implementation" on the picker's
  // { uri, name, type } asset shape — a known, unresolved RN/Expo bug
  // (github.com/expo/expo/issues/33134). base64: true on the picker plus a
  // plain JSON POST sidesteps the native multipart path entirely.
  async function pickLogo() {
    setLogoError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setLogoError("Allow photo access to change your logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    setLogoBusy(true);
    try {
      const { logoUrl } = await api<{ logoUrl: string }>("/api/settings/logo", {
        method: "POST",
        body: JSON.stringify({
          base64: asset.base64,
          mimeType: asset.mimeType ?? "image/jpeg",
        }),
      });
      setSettings((prev) => (prev ? { ...prev, logoUrl } : prev));
      await refreshMe();
    } catch (e) {
      setLogoError(e instanceof ApiError ? e.message : "Couldn't upload that image.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function connectStripe() {
    setStripeBusy(true);
    setStripeError(null);
    try {
      // Build Guide v2 review 17 Sept, B3 — single retry; see
      // lib/stripe.ts's getConnectLinkWithRetry for the reasoning.
      const { url } = await getConnectLinkWithRetry();
      // Build Guide v2 Part 17.1 — ephemeral session, no shared-cookie
      // "wants to use stripe.com" popup. See onboarding.tsx's connectStripe
      // for the same fix on this screen's other entry point into Connect.
      const result = await WebBrowser.openAuthSessionAsync(url, "tradesura://onboarding", {
        preferEphemeralSession: true,
      });
      const err = stripeResultError(result);
      if (err) setStripeError(err);
      else if (result.type === "success") await refreshMe();
    } catch (e) {
      setStripeError(e instanceof ApiError ? e.message : "Couldn't start payment setup.");
    } finally {
      setStripeBusy(false);
    }
  }

  // R5 (Build Review 3) — customer pages show "£X a month including VAT"
  // while this is on. Saved straight away, like any iOS switch.
  async function setVat(next: boolean) {
    if (!settings) return;
    const prev = Boolean(settings.vatRegistered);
    setSettings({ ...settings, vatRegistered: next });
    setVatBusy(true);
    setVatError(null);
    try {
      await api("/api/settings/vat", { method: "POST", body: JSON.stringify({ vatRegistered: next }) });
      await refreshMe();
    } catch (e) {
      setSettings((s) => (s ? { ...s, vatRegistered: prev } : s));
      setVatError(e instanceof ApiError ? e.message : "Couldn't save that — try again.");
    } finally {
      setVatBusy(false);
    }
  }

  // Retention spec §9 — the engineer's choice of win-back offer, texted 30
  // days after a plan ends and again before winter. Saved on tap.
  async function chooseWinback(next: WinbackOffer) {
    if (next === winback || winbackBusy) return;
    const prev = winback;
    setWinback(next);
    setWinbackBusy(true);
    setWinbackError(null);
    try {
      await api("/api/settings/winback", { method: "POST", body: JSON.stringify({ offer: next }) });
    } catch (e) {
      setWinback(prev);
      setWinbackError(e instanceof ApiError ? e.message : "Couldn't save that — try again.");
    } finally {
      setWinbackBusy(false);
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
        <AppHeader title="Account" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {/* Build Guide v2 Part 13 — identity header: initials avatar (with
            the tick once verified), name, email. */}
        <View className="flex-row items-center gap-3 px-1">
          <Avatar size={56} />
          <View className="shrink">
            <Text className="font-bold text-base text-ink" numberOfLines={1}>
              {me?.tradingName || `${me?.firstName ?? ""} ${me?.lastName ?? ""}`.trim() || "Your account"}
            </Text>
            <Text className="font-sans text-xs text-muted" numberOfLines={1}>
              {me?.email}
            </Text>
          </View>
        </View>

        {/* Part 13 — "Status card reads the standing strip's truth source —
            same words, same state machine." Gas Safe and Payments are two
            independent facts (unlike the dashboard's single collapsed
            line), except banned/paused, which outrank both and take over
            the whole card. */}
        <Card>
          <Text className="mb-1.5 font-semibold text-sm text-ink">Status</Text>
          {settings && (settings.standing.state === "BANNED" || settings.standing.state === "PAUSED") ? (
            <StatusLine status={settings.standing} />
          ) : (
            <View className="gap-2">
              {!settings && !error && (
                <Skeleton label="Loading your status" className="gap-2">
                  <TextBone width="70%" size={14} />
                  <TextBone width="60%" size={14} />
                </Skeleton>
              )}
              {settings &&
                (settings.gasSafePhotoNeeded ? (
                  <Pressable onPress={() => router.push("/add-id")} accessibilityRole="button">
                    <StatusLine status={settings.gasSafe} />
                  </Pressable>
                ) : (
                  <StatusLine status={settings.gasSafe} />
                ))}
              {settings &&
                (settings.payments.tone === "quiet" ? (
                  <StatusLine status={settings.payments} />
                ) : (
                  <Pressable onPress={connectStripe} disabled={stripeBusy}>
                    {stripeBusy ? (
                      <OpeningStripe />
                    ) : (
                      <Text className="font-sans text-sm text-warn">{settings.payments.text}</Text>
                    )}
                  </Pressable>
                ))}
              {stripeError && <Text className="font-sans text-xs text-danger">{stripeError}</Text>}
            </View>
          )}
        </Card>

        <Card>
          <Text className="mb-1 font-semibold text-sm text-ink">Your business</Text>
          {!settings && !error && (
            <Skeleton label="Loading your business details" className="mb-1 mt-1">
              <RowBone left={60} right={110} />
              <RowBone left={100} right={90} />
            </Skeleton>
          )}
          {settings && (settings.phone || settings.businessType) && (
            <View className="mb-1 mt-1">
              {settings.phone && (
                <RowLine
                  left="Mobile"
                  right={
                    <Text className="tabular-nums text-sm text-ink">
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
          {/* Editable so accounts from older signup builds, which saved no
              name, can add one — it drives the greeting and avatar initials. */}
          <View className="mt-2 flex-row gap-2">
            <View className="flex-1">
              <Text className="font-sans text-xs text-muted">First name</Text>
              <TextInput
                value={firstName}
                onChangeText={(v) => {
                  setFirstName(v);
                  setSavedSettings(false);
                  setSettingsError(null);
                }}
                autoComplete="given-name"
                className="mt-1 min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink"
              />
            </View>
            <View className="flex-1">
              <Text className="font-sans text-xs text-muted">Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={(v) => {
                  setLastName(v);
                  setSavedSettings(false);
                  setSettingsError(null);
                }}
                autoComplete="family-name"
                className="mt-1 min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink"
              />
            </View>
          </View>
          <Text className="mt-3 font-sans text-xs text-muted">Trading name</Text>
          <TextInput
            value={tradingName}
            onChangeText={(v) => {
              setTradingName(v);
              setSavedSettings(false);
              setSettingsError(null);
            }}
            placeholder={legalFallback ?? undefined}
            className="mt-1 min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink"
          />
          {legalFallback && (
            <Text className="mt-1 font-sans text-[11px] text-faint">Leave blank to use {legalFallback}</Text>
          )}
          {settings && (
            <View className="mt-3 flex-row items-center justify-between gap-3">
              <View className="shrink">
                <Text className="font-sans text-sm text-ink">VAT registered</Text>
                <Text className="font-sans text-[11px] text-faint">
                  Customers see your prices as &ldquo;including VAT&rdquo;.
                </Text>
              </View>
              <Toggle
                value={Boolean(settings.vatRegistered)}
                onValueChange={setVat}
                disabled={vatBusy}
                accessibilityLabel="VAT registered"
              />
            </View>
          )}
          {vatError && <Text className="mt-1.5 font-sans text-xs text-danger">{vatError}</Text>}
          <Text className="mt-3 font-sans text-xs text-muted">Logo (optional)</Text>
          <Pressable
            onPress={pickLogo}
            disabled={logoBusy}
            className="mt-1.5 flex-row items-center gap-3"
            style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
          >
            {settings?.logoUrl ? (
              <LoadingImage
                uri={settings.logoUrl}
                width={48}
                height={48}
                radius={8}
                accessibilityLabel="Your logo"
              />
            ) : (
              <View className="h-12 w-12 items-center justify-center rounded-lg border border-dashed border-line bg-paper-2">
                <Text className="text-lg text-faint">＋</Text>
              </View>
            )}
            <Text className="font-semibold text-sm text-flame">
              {logoBusy ? "Uploading…" : settings?.logoUrl ? "Change logo" : "Add a logo"}
            </Text>
          </Pressable>
          {logoError && <Text className="mt-1.5 font-sans text-xs text-danger">{logoError}</Text>}
          {settings && (
            <View className="mt-3 border-t border-line-soft pt-2.5">
              <RowLine
                left="Your page"
                right={
                  <Text className="tabular-nums text-xs text-flame-deep">tradesura.com/p/{settings.slug}</Text>
                }
              />
              <Text className="mt-1 font-sans text-[11px] text-faint">
                The address updates if you rename your trading name.
              </Text>
            </View>
          )}
          {settingsError && (
            <Text className="mt-2 font-sans text-sm text-danger">{settingsError}</Text>
          )}
          {dirty && (
            <Button
              variant="ghost"
              onPress={saveSettings}
              disabled={savingSettings}
              className="mt-3"
            >
              {savingSettings ? "Saving…" : "Save changes"}
            </Button>
          )}
          {savedSettings && !dirty && (
            <Text className="mt-2 font-semibold text-xs text-ink">Saved</Text>
          )}
        </Card>

        {winback && (
          <Card>
            <Text className="font-semibold text-sm text-ink">Win-back offer</Text>
            <Text className="mt-0.5 font-sans text-xs text-muted">
              Texted from you to customers 30 days after their plan ends, and again before winter.
            </Text>
            <View className="mt-2" accessibilityRole="radiogroup">
              {WINBACK_CHOICES.map((c, i) => {
                const on = winback === c.value;
                return (
                  <Pressable
                    key={c.value}
                    onPress={() => chooseWinback(c.value)}
                    disabled={winbackBusy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: winbackBusy }}
                    className={`flex-row items-center gap-3 py-3 ${i < WINBACK_CHOICES.length - 1 ? "border-b border-line-soft" : ""}`}
                  >
                    <View
                      className={`h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-flame" : "border-line-strong"}`}
                    >
                      {on && <View className="h-2.5 w-2.5 rounded-full bg-flame" />}
                    </View>
                    <Text className="flex-1 font-sans text-sm text-ink">{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {winbackError && <Text className="mt-1.5 font-sans text-xs text-danger">{winbackError}</Text>}
          </Card>
        )}

        {/* Dev-only tooling — never shown in a production build. */}
        {__DEV__ && data && (
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
              <Text className="mt-1.5 font-semibold text-xs text-ink">{flushResult}</Text>
            )}
          </Card>
        )}

        {/* Build Guide v2 Part 13 — four rows, each with a chevron: My
            plans / Invite an engineer / WhatsApp support / Terms &
            privacy. Cut: "Payouts & collections" (duplicates the tab), "How
            to sell more plans" (moves into How it works — one home),
            "Trades & TradePacks" and "Messages & tickets" (both hidden for
            October, Build Review 2). The gas-emergency interlock is still
            surfaced: Home's Today list links to messages when it fires. */}
        <Card>
          <Pressable onPress={() => router.push("/plans")}>
            <RowLine left="My plans" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => router.push("/team")}>
            <RowLine left="Team" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => router.push("/ratings")}>
            <RowLine left="Ratings" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => router.push("/referral")}>
            <RowLine left="Invite an engineer · earn 25% of our fee" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => Linking.openURL(WHATSAPP_SUPPORT_URL)}>
            <RowLine left="WhatsApp support" right={<Chevron />} />
          </Pressable>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(apiUrl("/terms")).catch(() => {})}
          >
            <RowLine left="Terms & privacy" right={<Chevron />} />
          </Pressable>
        </Card>

        {/* Part 13: "Then a muted Sign out." */}
        <Button variant="ghost" onPress={signOut}>
          Sign out
        </Button>
        {/* Section 10 — App Store 5.1.1 needs in-app deletion. */}
        <Pressable onPress={() => router.push("/delete-account")} className="items-center py-2">
          <Text className="font-sans text-xs text-muted">Delete my account</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
