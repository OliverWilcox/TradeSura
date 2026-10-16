import { useState, type ComponentProps } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { IdCardPicker, type IdCardState } from "@/components/id-card-picker";
import { checkEmail, checkGasSafeNo, checkRequired, checkUkMobile } from "@/lib/validate";

// Build Review 2, section 8 (as updated) — the owner adds each staff engineer
// and uploads that engineer's Gas Safe ID card here, not the engineer. The
// card goes into the verification queue as its own check.

const inputCls = "min-h-[48px] rounded-[10px] border bg-paper px-3.5 font-sans text-[16px] text-ink";
type Field = "firstName" | "lastName" | "email" | "phone" | "gasSafeNo" | "card";

function FieldError({ children }: { children?: string | null }) {
  return children ? <Text className="mt-1 font-sans text-[13px] text-danger">{children}</Text> : null;
}

export default function TeamAdd() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gasSafeNo, setGasSafeNo] = useState("");
  // The picker's "upload" just holds the photo; it's sent with the form.
  const [card, setCard] = useState<IdCardState>({ phase: "empty" });
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    // The shared validators speak to the person signing up ("your");
    // here the owner is filling in someone else's details.
    const theirs = (m: string | null) => m?.replace(/\byour\b/g, "their") ?? null;
    const found = {
      firstName: theirs(checkRequired(firstName, "first name")),
      lastName: theirs(checkRequired(lastName, "last name")),
      email: theirs(checkEmail(email)),
      phone: phone.trim() ? theirs(checkUkMobile(phone)) : null,
      gasSafeNo: theirs(checkGasSafeNo(gasSafeNo)),
      card: card.phase === "added" ? null : "Add a photo of their Gas Safe ID card.",
    };
    setErrors(found);
    if (Object.values(found).some(Boolean) || card.phase !== "added") return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/team", {
        method: "POST",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          gasSafeNo: gasSafeNo.trim(),
          cardBase64: card.photo.base64,
          cardMimeType: card.photo.mimeType,
        }),
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add them — try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    key: Field,
    value: string,
    set: (v: string) => void,
    props: Partial<ComponentProps<typeof TextInput>> = {},
  ) => (
    <View className="mb-3">
      <Micro className="mb-1">{label}</Micro>
      <TextInput
        value={value}
        onChangeText={(v) => {
          set(v);
          setErrors((e) => ({ ...e, [key]: null }));
        }}
        placeholderTextColor="#6E86A3"
        className={`${inputCls} ${errors[key] ? "border-danger" : "border-line"}`}
        {...props}
      />
      <FieldError>{errors[key]}</FieldError>
    </View>
  );

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Add an engineer" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        <Card>
          {field("First name", "firstName", firstName, setFirstName, { autoCapitalize: "words" })}
          {field("Last name", "lastName", lastName, setLastName, { autoCapitalize: "words" })}
          {field("Email — they sign in with this", "email", email, setEmail, {
            keyboardType: "email-address",
            autoCapitalize: "none",
            autoComplete: "off",
          })}
          {field("Mobile (optional)", "phone", phone, setPhone, { keyboardType: "phone-pad" })}
          {field("Their Gas Safe number", "gasSafeNo", gasSafeNo, setGasSafeNo, { keyboardType: "number-pad" })}
        </Card>

        <Card>
          <Micro className="mb-1.5">Their Gas Safe ID card</Micro>
          <IdCardPicker value={card} onChange={setCard} upload={async () => {}} error={errors.card} whose="their" />
          <FieldError>{errors.card}</FieldError>
          <Text className="mt-2 font-sans text-xs text-muted">
            We check it against the register, usually within 24 hours. They can add customers straight
            away and send offers once it&apos;s approved.
          </Text>
        </Card>

        {error && <Text className="px-1 font-sans text-sm text-danger">{error}</Text>}
        <Button onPress={save} disabled={busy}>
          {busy ? "Adding…" : "Add to my team"}
        </Button>
        <Text className="px-1 text-center font-sans text-xs text-muted">
          We&apos;ll email them how to sign in. Staff are free, with no limit.
        </Text>
      </ScrollView>
    </View>
  );
}
