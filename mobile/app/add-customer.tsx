import { useState } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { AddressLookupField, type AddressValue } from "@/components/address-lookup";
import { MonthPicker } from "@/components/month-picker";
import { checkRequired, checkUkMobile, checkUkPostcode } from "@/lib/validate";

// Thumb-sized (29 Sept review, systemic defect 4); size-only text class —
// see components/address-lookup.tsx for why not text-sm.
const inputCls = "min-h-[48px] rounded-[10px] border bg-paper px-3.5 font-sans text-[16px] text-ink";

type Errors = Partial<Record<"firstName" | "lastName" | "phone" | "postcode", string | null>>;

function FieldError({ children }: { children?: string | null }) {
  return children ? <Text className="mt-1 font-sans text-[13px] text-danger">{children}</Text> : null;
}

// Build Guide v2 Part 9.3 — Add-customer sheet, route 3: "Just save their
// details." Deliberately plan-free — no plan is offered or created here,
// just book-building.
export default function AddCustomer() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>({ line1: "", town: "", postcode: "" });
  const [lastServiced, setLastServiced] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  // Never a silent grey button — tapping Save explains what's missing.
  async function save() {
    const found: Errors = {
      firstName: checkRequired(firstName, "first name"),
      lastName: checkRequired(lastName, "last name"),
      phone: checkUkMobile(phone),
      postcode: address.postcode.trim() ? checkUkPostcode(address.postcode) : null,
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
                  className={`${inputCls} ${errors.firstName ? "border-danger" : "border-line"}`}
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
                  className={`${inputCls} ${errors.lastName ? "border-danger" : "border-line"}`}
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
                className={`${inputCls} ${errors.phone ? "border-danger" : "border-line"}`}
              />
              <FieldError>{errors.phone}</FieldError>
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

        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
        <Button onPress={save} disabled={busy}>
          {busy ? "Saving…" : "Save to my book"}
        </Button>
      </ScrollView>
    </View>
  );
}
