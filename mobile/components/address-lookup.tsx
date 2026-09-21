import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator } from "react-native";
import { api, ApiError } from "@/lib/api";
import { Micro } from "@/components/ui";

export type AddressValue = { line1: string; town: string; postcode: string };

const inputCls = "rounded-[10px] border border-line bg-paper px-3 py-2.5 font-sans text-sm text-ink";

type LookedUpAddress = { line1: string; line2?: string; town: string; postcode: string };

// Build Guide v2 Part 17.3 — "one shared component used everywhere an
// address appears." Postcode → Find address → pick from the list → fields
// fill, editable; when no provider is configured (see /api/address/lookup),
// "Find address" simply returns nothing and the always-visible manual
// fields underneath are the whole story — never a dead end.
export function AddressLookupField({
  value,
  onChange,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
}) {
  const [results, setResults] = useState<LookedUpAddress[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function findAddress() {
    if (value.postcode.trim().length < 4) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const data = await api<{ configured: boolean; addresses: LookedUpAddress[] }>(
        "/api/address/lookup",
        { method: "POST", body: JSON.stringify({ postcode: value.postcode.trim() }) },
      );
      setResults(data.addresses);
      if (!data.configured || data.addresses.length === 0) {
        setSearchError("No lookup available here yet — enter the address below.");
      }
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : "Couldn't look that up.");
    } finally {
      setSearching(false);
    }
  }

  function pick(a: LookedUpAddress) {
    onChange({ line1: a.line1, town: a.town, postcode: a.postcode });
    setResults(null);
  }

  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <TextInput
          value={value.postcode}
          onChangeText={(v) => onChange({ ...value, postcode: v.toUpperCase() })}
          placeholder="Postcode"
          autoCapitalize="characters"
          className={`flex-1 ${inputCls}`}
        />
        <Pressable
          onPress={findAddress}
          disabled={searching || value.postcode.trim().length < 4}
          className="items-center justify-center rounded-[10px] border border-line bg-panel px-3.5"
        >
          {searching ? (
            <ActivityIndicator color="#5FA3F0" />
          ) : (
            <Text className="font-semibold text-xs text-flame-deep">Find address</Text>
          )}
        </Pressable>
      </View>

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
        className={inputCls}
      />
      <TextInput
        value={value.town}
        onChangeText={(v) => onChange({ ...value, town: v })}
        placeholder="Town"
        className={inputCls}
      />
    </View>
  );
}
