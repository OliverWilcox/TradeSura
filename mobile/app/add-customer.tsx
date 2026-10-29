import { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { AddressLookupField, type AddressValue } from "@/components/address-lookup";
import { MonthPicker } from "@/components/month-picker";
import { normaliseUkMobile } from "@/lib/validate";

// Thumb-sized (29 Sept review, systemic defect 4); size-only text class —
// see components/address-lookup.tsx for why not text-sm.
const inputCls = "min-h-[48px] rounded-[10px] border bg-paper px-3.5 font-sans text-[16px] text-ink";

type Errors = Partial<Record<"firstName" | "lastName" | "phone" | "email" | "postcode" | "consent", string | null>>;

// Review 4 — about the customer, so "their", and amber like every form error.
const need = (v: string, what: string) => (v.trim() ? null : `Enter their ${what}.`);
function checkTheirMobile(v: string): string | null {
  if (!v.trim()) return "Enter their mobile number.";
  return normaliseUkMobile(v) ? null : "Enter a UK mobile number, like 07123 456789.";
}
function checkTheirEmail(v: string): string | null {
  if (!v.trim()) return null; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "That email doesn't look right — check for typos.";
}
function checkTheirPostcode(v: string): string | null {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(v.trim().toUpperCase())
    ? null
    : "Enter their full postcode, like HD9 2TT.";
}

function FieldError({ children }: { children?: string | null }) {
  return children ? <Text className="mt-1 font-sans text-[13px] text-warn">{children}</Text> : null;
}

// Build Guide v2 Part 9.3 — Add-customer sheet, route 3: "Just save their
// details." Deliberately plan-free — no plan is offered or created here,
// just book-building.
export default function AddCustomer() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ownCustomer, setOwnCustomer] = useState(false);
  const [address, setAddress] = useState<AddressValue>({ line1: "", town: "", postcode: "" });
  const [lastServiced, setLastServiced] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  // Never a silent grey button — tapping Save explains what's missing.
  async function save() {
    const found: Errors = {
      firstName: need(firstName, "first name"),
      lastName: need(lastName, "last name"),
      phone: checkTheirMobile(phone),
      email: checkTheirEmail(email),
      postcode: address.postcode.trim() ? checkTheirPostcode(address.postcode) : null,
      consent: ownCustomer ? null : "Tick to confirm this is your own customer.",
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          confirmOwn: true,
          addressLine1: address.line1.trim() || undefined,
          town: address.town.trim() || undefined,
          postcode: address.postcode.trim() || undefined,
          lastServicedAt: lastServiced ? lastServiced.toISOString() : undefined,
        }),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save this customer.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-panel px-8">
        <Text className="text-center text-xl font-extrabold text-ink">
          {firstName} is in your book
        </Text>
        <Text className="text-center text-sm text-muted">
          No plan sent yet — offer one any time from Customers.
        </Text>
        <View className="w-full gap-2">
          <Button
            onPress={() => {
              setSaved(false);
              setFirstName("");
              setLastName("");
              setPhone("");
              setEmail("");
              setOwnCustomer(false);
              setAddress({ line1: "", town: "", postcode: "" });
              setLastServiced(null);
            }}
          >
            Add another
          </Button>
          <Button variant="ghost" onPress={() => router.replace("/(tabs)/(customers)/customers")}>
            Back to Customers
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Just save their details" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <Card>
          <Micro className="mb-1.5">Their details</Micro>
          <View className="gap-2">
            <View className="flex-row gap-2">
              <View className="flex-1">
                <TextInput
                  value={firstName}
                  onChangeText={(v) => {
                    setFirstName(v);
                    setErrors((e) => ({ ...e, firstName: null }));
                  }}
                  placeholder="First name"
                  placeholderTextColor="#6e86a3"
                  className={`${inputCls} ${errors.firstName ? "border-warn" : "border-line"}`}
                />
                <FieldError>{errors.firstName}</FieldError>
              </View>
              <View className="flex-1">
                <TextInput
                  value={lastName}
                  onChangeText={(v) => {
                    setLastName(v);
                    setErrors((e) => ({ ...e, lastName: null }));
                  }}
                  placeholder="Last name"
                  placeholderTextColor="#6e86a3"
                  className={`${inputCls} ${errors.lastName ? "border-warn" : "border-line"}`}
                />
                <FieldError>{errors.lastName}</FieldError>
              </View>
            </View>
            <View>
              <TextInput
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  setErrors((e) => ({ ...e, phone: null }));
                }}
                placeholder="Mobile (07…)"
                placeholderTextColor="#6e86a3"
                keyboardType="phone-pad"
                className={`${inputCls} ${errors.phone ? "border-warn" : "border-line"}`}
              />
              <FieldError>{errors.phone}</FieldError>
            </View>
            <View>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setErrors((e) => ({ ...e, email: null }));
                }}
                placeholder="Email (optional)"
                placeholderTextColor="#6e86a3"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className={`${inputCls} ${errors.email ? "border-warn" : "border-line"}`}
              />
              <FieldError>{errors.email}</FieldError>
            </View>
          </View>
        </Card>

        <Card>
          <Micro className="mb-1.5">Address (optional)</Micro>
          <AddressLookupField
            value={address}
            onChange={(v) => {
              setAddress(v);
              setErrors((e) => ({ ...e, postcode: null }));
            }}
          />
          <FieldError>{errors.postcode}</FieldError>
        </Card>

        <Card>
          <Micro className="mb-1.5">Last boiler service (optional)</Micro>
          <MonthPicker value={lastServiced} onChange={setLastServiced} />
          <Text className="mt-1.5 font-sans text-[11px] text-faint">
            Powers automatic service reminders.
          </Text>
        </Card>

        {/* Review 4 — the same own-customer tick as import (PECR basis for
            any later message to them). */}
        <View>
          <Pressable
            onPress={() => {
              setOwnCustomer((v) => !v);
              setErrors((e) => ({ ...e, consent: null }));
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ownCustomer }}
            className="flex-row items-start gap-2.5"
          >
            <View
              className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${ownCustomer ? "border-flame bg-flame" : errors.consent ? "border-warn" : "border-line"}`}
            >
              {ownCustomer && <Text className="text-[11px] text-white">✓</Text>}
            </View>
            <Text className="flex-1 font-sans text-[13px] text-muted">
              This is my own customer — someone I&apos;ve done work for or who&apos;s asked me to.
            </Text>
          </Pressable>
          <FieldError>{errors.consent}</FieldError>
        </View>

        {error && <Text className="font-sans text-sm text-warn">{error}</Text>}
        <Button onPress={save} disabled={busy}>
          {busy ? "Saving…" : "Save to my book"}
        </Button>
      </ScrollView>
    </View>
  );
}
