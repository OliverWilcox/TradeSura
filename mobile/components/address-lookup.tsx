import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { api, ApiError } from "@/lib/api";
import { Micro } from "@/components/ui";

export type AddressValue = { line1: string; town: string; postcode: string };

// Size-only text class (text-[14px], not text-sm) on single-line inputs:
// text-sm also sets a line-height, which iOS draws as text sitting low in
// the box. Same rule for every TextInput in the app.
const inputCls = "min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink";

type LookedUpAddress = { line1: string; line2?: string; town: string; postcode: string };

// Build Guide v2 Part 17.3 — "one shared component used everywhere an
// address appears." Postcode → Find address → pick from the list → fields
// fill, editable; when no provider is configured (see /api/address/lookup),
// "Find address" simply returns nothing and the always-visible manual
// fields underneath are the whole story — never a dead end.
// Signup's taller, thumb-sized fields (30 Sept notes) — same component,
// different dress.
const largeInputCls =
  "min-h-[56px] rounded-xl border-[1.5px] border-white/20 bg-[#081321] px-4 text-[17px] text-white";

export function AddressLookupField({
  value,
  onChange,
  phoneToken,
  emailToken,
  large = false,
  postcodeError,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  /** Signup only: proves the verified mobile in place of a session. */
  phoneToken?: string | null;
  /** Email-first signup proof; preferred when present. */
  emailToken?: string | null;
  large?: boolean;
  postcodeError?: string | null;
}) {
  const fieldCls = large ? largeInputCls : inputCls;
  const [results, setResults] = useState<LookedUpAddress[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function findAddress() {
    if (value.postcode.trim().length < 4) {
      setSearchError("Enter the postcode first, then tap Find address.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const data = await api<{ configured: boolean; addresses: LookedUpAddress[] }>(
        "/api/address/lookup",
        {
          method: "POST",
          body: JSON.stringify({
            postcode: value.postcode.trim(),
            ...(emailToken ? { emailToken } : phoneToken ? { phoneToken } : {}),
          }),
        },
      );
      setResults(data.addresses);
      if (!data.configured) {
        setSearchError("Address lookup isn't available right now — enter the address below.");
      } else if (data.addresses.length === 0) {
        setSearchError("We couldn't find addresses for that postcode — check it, or enter the address below.");
      }
    } catch (e) {
      setSearchError(
        e instanceof ApiError ? e.message : "We couldn't look that up — enter the address below.",
      );
    } finally {
      setSearching(false);
    }
  }

  function pick(a: LookedUpAddress) {
    // One address-line field in the form, so a named house keeps its street
    // ("Harden Hill Farm, Greenfield Road").
    onChange({ line1: [a.line1, a.line2].filter(Boolean).join(", "), town: a.town, postcode: a.postcode });
    setResults(null);
  }

  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <TextInput
          value={value.postcode}
          onChangeText={(v) => onChange({ ...value, postcode: v.toUpperCase() })}
          placeholder="Postcode"
          placeholderTextColor="#6e86a3"
          autoCapitalize="characters"
          autoComplete="postal-code"
          textContentType="postalCode"
          className={`flex-1 ${fieldCls} ${postcodeError ? "border-danger" : ""}`}
        />
        <Pressable
          onPress={findAddress}
          disabled={searching}
          className="items-center justify-center rounded-[10px] border border-line bg-panel px-3.5"
        >
          {searching ? (
            <ActivityIndicator color="#5FA3F0" />
          ) : (
            <Text className="font-semibold text-xs text-flame-deep">Find address</Text>
          )}
        </Pressable>
      </View>

      {postcodeError && <Text className="text-[13px] text-danger">{postcodeError}</Text>}
      {searchError && <Micro className="text-faint">{searchError}</Micro>}

      {results && results.length > 0 && (
        <View className="rounded-[10px] border border-line bg-paper">
          {results.map((a, i) => (
            <Pressable
              key={`${a.line1}-${i}`}
              onPress={() => pick(a)}
              className="border-b border-line-soft px-3 py-2.5 last:border-b-0"
            >
              <Text className="font-sans text-sm text-ink">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}, {a.town}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <TextInput
        value={value.line1}
        onChangeText={(v) => onChange({ ...value, line1: v })}
        placeholder="Address line 1"
        placeholderTextColor="#6e86a3"
        autoComplete="street-address"
        textContentType="fullStreetAddress"
        className={fieldCls}
      />
      <TextInput
        value={value.town}
        onChangeText={(v) => onChange({ ...value, town: v })}
        placeholder="Town"
        placeholderTextColor="#6e86a3"
        textContentType="addressCity"
        className={fieldCls}
      />
    </View>
  );
}
