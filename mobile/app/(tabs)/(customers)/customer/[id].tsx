import { useCallback, useState } from "react";
import { View, Text, ScrollView, Alert, Pressable, Linking, TextInput } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Tick, Button } from "@/components/ui";
import { Skeleton, Bone, TextBone, RowBone } from "@/components/skeleton";
import { CancelSaveCard } from "@/components/cancel-save-card";
import { PassportSection } from "@/components/passport-section";
import { formatPounds } from "@/lib/earnings";
import { useAuth } from "@/lib/auth-context";
import { offerLock } from "@/lib/offer-lock";
import { AddressLookupField, type AddressValue } from "@/components/address-lookup";
import { MonthPicker } from "@/components/month-picker";
import { normaliseUkMobile } from "@/lib/validate";

type Detail = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  source: string;
  address: string | null;
  addressParts?: { line1: string; town: string; postcode: string } | null;
  hasPassport?: boolean;
  removeBlocked?: string | null;
  appliance: { label: string; lastServicedAt: string | null } | null;
  nextServiceDue: string | null;
  serviceOverdue: boolean;
  plan: {
    id: string;
    tierName: string;
    priceMonthlyPence: number | null;
    benefitLines: string[];
    status: string;
    mandateStatus: string | null;
    activatedAt: string | null;
    paymentFailedAt?: string | null;
    paymentEndsAt?: string | null;
  } | null;
  canTextManageLink: boolean;
  viewerIsStaff?: boolean;
  timeline: { at: string; icon: string; text: string }[];
};

const SOURCE_LABEL: Record<string, string> = {
  added: "added manually",
  doorstep: "signed up in person",
  web: "plan signup",
  import: "imported",
  contacts: "phone contacts",
};

// Build Review 2, ruling 5 — engineers can end a plan, with a reason.
const END_REASONS = [
  "Customer asked me to",
  "Moving house",
  "Boiler replaced or removed",
  "Payments keep failing",
  "Other",
];

function d(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });
}

// Review 4 — "+447123456789" reads as "07123 456789".
function ukMobile(e164: string) {
  const m = e164.match(/^\+44(7\d{3})(\d{6})$/);
  return m ? `0${m[1]} ${m[2]}` : e164;
}

const inputCls = "min-h-[44px] rounded-[10px] border border-line bg-paper px-3 font-sans text-[15px] text-ink";

// Review 4 — edit name, mobile, email, address and last service.
function EditDetails({ c, onDone }: { c: Detail; onDone: (saved: boolean) => void }) {
  const [firstName, setFirstName] = useState(c.firstName);
  const [lastName, setLastName] = useState(c.lastName);
  const [phone, setPhone] = useState(ukMobile(c.phone));
  const [email, setEmail] = useState(c.email ?? "");
  const [address, setAddress] = useState<AddressValue>(
    c.addressParts ? { line1: c.addressParts.line1, town: c.addressParts.town, postcode: c.addressParts.postcode } : { line1: "", town: "", postcode: "" },
  );
  const [lastServiced, setLastServiced] = useState<Date | null>(
    c.appliance?.lastServicedAt ? new Date(c.appliance.lastServicedAt) : null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!firstName.trim() || !lastName.trim()) return setErr("Enter their first and last name.");
    if (!normaliseUkMobile(phone)) return setErr("Enter a UK mobile number, like 07123 456789.");
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return setErr("That email doesn't look right — check for typos.");
    }
    setBusy(true);
    setErr(null);
    try {
      const hasAddress = Boolean(address.line1.trim() && address.postcode.trim());
      await api(`/api/customers/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          ...(hasAddress
            ? { addressLine1: address.line1.trim(), town: address.town.trim(), postcode: address.postcode.trim() }
            : {}),
          ...(!c.hasPassport && (hasAddress || c.addressParts)
            ? { lastServicedAt: lastServiced ? lastServiced.toISOString() : null }
            : {}),
        }),
      });
      onDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't save — try again.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <Micro className="mb-1.5">Edit details</Micro>
      <View className="gap-2">
        <View className="flex-row gap-2">
          <View className="flex-1">
            <TextInput value={firstName} onChangeText={setFirstName} placeholder="First name" placeholderTextColor="#6e86a3" className={inputCls} />
          </View>
          <View className="flex-1">
            <TextInput value={lastName} onChangeText={setLastName} placeholder="Last name" placeholderTextColor="#6e86a3" className={inputCls} />
          </View>
        </View>
        <TextInput value={phone} onChangeText={setPhone} placeholder="Mobile (07…)" placeholderTextColor="#6e86a3" keyboardType="phone-pad" className={inputCls} />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email (optional)"
          placeholderTextColor="#6e86a3"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          className={inputCls}
        />
        <AddressLookupField value={address} onChange={setAddress} />
        {!c.hasPassport && (
          <View>
            <Text className="mb-1 font-sans text-xs text-muted">Last boiler service</Text>
            <MonthPicker value={lastServiced} onChange={setLastServiced} />
          </View>
        )}
      </View>
      {err && <Text className="mt-2 font-sans text-[13px] text-warn">{err}</Text>}
      <View className="mt-3 gap-2">
        <Button onPress={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onPress={() => onDone(false)} disabled={busy}>
          Cancel
        </Button>
      </View>
    </Card>
  );
}

// Last service is picked as a month, so service dates show "Oct 2027".
function month(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" });
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  // Review 4 — the Offer button looks locked while offers are, and says why.
  const lock = offerLock(me);
  const [c, setC] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [texted, setTexted] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setC(await api<Detail>(`/api/customers/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this customer.");
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Part 10 — "white Mark service done button — tapping it resets the
  // service clock and the reminder engine."
  async function markServiceDone() {
    setBusy(true);
    try {
      await api(`/api/customers/${id}/service`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e) {
      Alert.alert("Couldn't record", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Part 10 — "Text the manage link" so the customer can manage or cancel
  // themselves. This never touches the plan itself; ending it is endPlan.
  async function textManageLink() {
    setBusy(true);
    setTexted(false);
    try {
      await api(`/api/customers/${id}/text-manage-link`, { method: "POST" });
      setTexted(true);
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Inline confirm rather than Alert: two deliberate taps (reason, then
  // confirm), and it works the same on web.
  async function endPlan() {
    if (!endReason) return;
    setBusy(true);
    setEndError(null);
    try {
      await api(`/api/customers/${id}/end-plan`, {
        method: "POST",
        body: JSON.stringify({ reason: endReason }),
      });
      setEnding(false);
      setEndReason(null);
      await load();
    } catch (e) {
      setEndError(e instanceof ApiError ? e.message : "Couldn't end the plan — try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    Alert.alert("Remove this customer?", "This deletes their record and any offer history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/api/customers/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Couldn't remove", e instanceof ApiError ? e.message : "Try again.");
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="font-sans text-sm text-danger">{error}</Text>
        <Button onPress={load} variant="ghost" className="w-full">
          Try again
        </Button>
      </View>
    );
  }
  if (!c) {
    return (
      <View className="flex-1 bg-panel">
        <SafeAreaView edges={["top"]} className="bg-iron">
          <AppHeader title="Customer" />
        </SafeAreaView>
        <Skeleton label="Loading customer" className="gap-3.5 px-4 pt-4">
          <View className="flex-row items-start justify-between gap-2">
            <View>
              <TextBone width={170} size={20} />
              <TextBone width={90} size={12} />
            </View>
            <Bone width={72} height={22} radius={11} />
          </View>
          <Card>
            <TextBone width={140} size={11} style={{ marginBottom: 4 }} />
            <View className="flex-row items-center justify-between">
              <TextBone width={120} size={16} />
              <TextBone width={70} size={16} />
            </View>
            <View className="mt-2 gap-1">
              <TextBone width="80%" size={12} />
              <TextBone width="65%" size={12} />
            </View>
          </Card>
          <Card>
            <TextBone width={60} size={11} style={{ marginBottom: 4 }} />
            <RowBone left={90} right={80} />
            <RowBone left={70} right={80} last />
          </Card>
        </Skeleton>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Customer" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="shrink">
            <Text className="font-bold text-xl text-ink">
              {c.firstName} {c.lastName}
            </Text>
            <Text className="font-sans text-xs text-muted">{SOURCE_LABEL[c.source] ?? c.source}</Text>
          </View>
          {c.plan ? <Pill tone="info">ON PLAN</Pill> : <Pill tone="off">NO PLAN</Pill>}
        </View>

        <CancelSaveCard customerId={c.id} onChange={load} />

        {/* Retention §3 — a failed Direct Debit, so the installer can follow up. */}
        {c.plan?.paymentFailedAt && (
          <Card className="border-warn/50 bg-warn-tint">
            <Text className="text-[13px] font-bold uppercase tracking-[0.08em] text-warn">Payment didn&apos;t go through</Text>
            <Text className="mt-1.5 text-[15px] text-ink">
              We&apos;ve texted and emailed {c.firstName} a one-tap link to update their bank details, from you.
            </Text>
            <Text className="mt-1 text-[13px] text-muted">
              Reminders go on day 3 and day 7. Service booking is paused until it&apos;s paid
              {c.plan.paymentEndsAt ? `; the plan ends on ${d(c.plan.paymentEndsAt)} if it isn't` : ""}.
            </Text>
            <Button className="mt-3" onPress={() => Linking.openURL(`tel:${c.phone}`)}>
              {`Call ${c.firstName}`}
            </Button>
          </Card>
        )}

        {/* Part 10 — "'Her plan — as signed' card showing the signed
            version (title, price, benefits — frozen snapshot, Part 7.2)."
            No pronoun is ever captured at signup, so this is always "Their". */}
        {c.plan ? (
          <Card>
            <Micro className="mb-1">Their plan — as signed</Micro>
            <View className="flex-row items-baseline justify-between">
              <Text className="font-bold text-base text-ink">{c.plan.tierName}</Text>
              {c.plan.priceMonthlyPence !== null && (
                <Text className="tabular-nums font-extrabold text-ok">
                  {formatPounds(c.plan.priceMonthlyPence)}
                  <Text className="text-xs font-bold text-muted">/month</Text>
                </Text>
              )}
            </View>
            {c.plan.status === "PAUSED" && (
              <Text className="mt-0.5 font-sans text-xs text-warn">Direct Debit paused</Text>
            )}
            <View className="mt-2 gap-1">
              {c.plan.benefitLines.map((line) => (
                <View key={line} className="flex-row items-start gap-2">
                  <Tick size={12} />
                  <Text className="flex-1 text-xs text-ink">{line}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : (
          <View className="gap-1.5">
            <Button
              disabled={!!lock}
              onPress={() => router.push({ pathname: "/offer", params: { customerId: c.id } })}
            >
              Offer a plan
            </Button>
            {lock && <Text className="text-center font-sans text-xs text-warn">{lock.reason}</Text>}
          </View>
        )}

        {/* Part 10 — Service card: Last service / Next due with a red
            OVERDUE chip when late. */}
        {/* With a Home Passport, its section shows service dates and logs services. */}
        {!c.hasPassport && (c.appliance?.lastServicedAt || c.nextServiceDue) && (
          <Card>
            <Micro className="mb-1">Service</Micro>
            {c.appliance?.lastServicedAt && (
              <RowLine left="Last service" right={month(c.appliance.lastServicedAt)} />
            )}
            {c.nextServiceDue && (
              <RowLine
                left="Next due"
                right={
                  c.serviceOverdue ? (
                    <Pill tone="danger">OVERDUE</Pill>
                  ) : (
                    <Text className="tabular-nums text-sm text-ink">{month(c.nextServiceDue)}</Text>
                  )
                }
              />
            )}
            <Button variant="ghost" className="mt-2.5" onPress={markServiceDone} disabled={busy}>
              Mark service done
            </Button>
          </Card>
        )}

        <PassportSection customerId={c.id} />

        {/* Part 10 — Contact card. Review 4: 07… mobiles you can tap, and Edit. */}
        {editing ? (
          <EditDetails
            c={c}
            onDone={(saved) => {
              setEditing(false);
              if (saved) load();
            }}
          />
        ) : (
          <Card>
            <View className="mb-1 flex-row items-center justify-between">
              <Micro>Contact</Micro>
              <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
                <Text className="font-sans text-[13px] font-semibold text-flame">Edit</Text>
              </Pressable>
            </View>
            <RowLine
              left="Mobile"
              right={
                <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`).catch(() => {})} accessibilityRole="link">
                  <Text className="tabular-nums text-sm text-flame">{ukMobile(c.phone)}</Text>
                </Pressable>
              }
            />
            {c.email && <RowLine left="Email" right={c.email} />}
            {c.address && <RowLine left="Address" right={c.address} />}
          </Card>
        )}

        <Card>
          <Micro className="mb-1.5">Timeline</Micro>
          {c.timeline.length === 0 ? (
            <Text className="py-1 font-sans text-xs text-muted">Nothing recorded yet.</Text>
          ) : (
            c.timeline.map((t, i) => (
              <View key={i} className="flex-row items-center gap-2 py-1.5">
                <Text>{t.icon}</Text>
                <Text className="flex-1 font-sans text-[13px] text-ink">{t.text}</Text>
                <Text className="tabular-nums text-[10px] text-faint">{d(t.at)}</Text>
              </View>
            ))
          )}
        </Card>

        {c.canTextManageLink && (
          <Button variant="ghost" onPress={textManageLink} disabled={busy}>
            {busy ? "Sending…" : "Text the manage link"}
          </Button>
        )}
        {texted && (
          <Text className="text-center font-semibold text-xs text-flame">Sent.</Text>
        )}

        {c.plan && !ending && !c.viewerIsStaff && (
          <Button variant="dangerghost" onPress={() => setEnding(true)} disabled={busy}>
            End this plan
          </Button>
        )}
        {c.plan && ending && (
          <Card>
            <Micro className="mb-1.5">Why are you ending it?</Micro>
            <View className="flex-row flex-wrap gap-1.5">
              {END_REASONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setEndReason(r)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: endReason === r }}
                  className={`rounded-full border px-3 py-1.5 ${endReason === r ? "border-flame bg-flame-tint" : "border-line bg-panel"}`}
                >
                  <Text className={`font-sans text-xs ${endReason === r ? "text-flame" : "text-ink"}`}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="mt-2.5 font-sans text-xs text-muted">
              The plan ends at the end of the month they&apos;ve paid for, and they get an email with the
              end date and a one-tap rejoin link. Use this to log a cancellation they asked for by phone
              or email too.
            </Text>
            {endError && <Text className="mt-2 font-sans text-xs text-danger">{endError}</Text>}
            <View className="mt-3 gap-2">
              <Button variant="dangerghost" onPress={endPlan} disabled={busy || !endReason}>
                {busy ? "Ending…" : "End plan at the end of the paid month"}
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setEnding(false);
                  setEndReason(null);
                  setEndError(null);
                }}
                disabled={busy}
              >
                Keep the plan
              </Button>
            </View>
          </Card>
        )}

        {!c.plan && !c.viewerIsStaff && (
          <View className="gap-1.5">
            <Button variant="dangerghost" onPress={confirmRemove} disabled={busy || Boolean(c.removeBlocked)}>
              Remove customer
            </Button>
            {c.removeBlocked && (
              <Text className="text-center font-sans text-xs text-warn">{c.removeBlocked}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
