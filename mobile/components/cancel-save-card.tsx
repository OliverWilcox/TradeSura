import { useCallback, useState } from "react";
import { View, Text, Linking, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { Button, Card, Micro, Pill } from "@/components/ui";

// Retention spec, section 2 — the installer's "Wants to cancel" card on the
// customer page. Call to save them, offer a cheaper plan, or mark them as
// saved (one tap, and one tap to undo). The installer can never block or
// delay a cancellation; the note says so.
type CancelState = {
  state: "wants_to_cancel" | "saved" | null;
  reason?: string | null;
  source?: string | null;
  effectiveAt?: string | null;
  customerFirstName?: string;
  customerName?: string;
  phone?: string;
  tierName?: string;
  priceMonthlyPence?: number | null;
  customerSince?: string;
  serviceUsed?: boolean;
  cheaper?: { id: string; name: string; priceMonthlyPence: number } | null;
  canAct?: boolean;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const pounds = (p: number) => (p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`);

export function CancelSaveCard({ customerId, onChange }: { customerId: string; onChange?: () => void }) {
  const [s, setS] = useState<CancelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [offerSent, setOfferSent] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api<CancelState>(`/api/customers/${customerId}/cancel`));
    } catch {
      setS(null); // the rest of the customer page still works without this card
    }
  }, [customerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function act(action: "saved" | "reinstate" | "offer_cheaper") {
    setBusy(true);
    try {
      await api(`/api/customers/${customerId}/cancel`, { method: "POST", body: JSON.stringify({ action }) });
      if (action === "offer_cheaper") setOfferSent(true);
      else {
        await load();
        onChange?.();
      }
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!s?.state) return null;
  const first = s.customerFirstName ?? "them";

  if (s.state === "saved") {
    return (
      <Card>
        <View className="flex-row items-center justify-between">
          <Micro>Cancellation</Micro>
          <Pill tone="info">SAVED</Pill>
        </View>
        <Text className="mt-1.5 text-sm text-ink">
          You marked {first} as saved, so their plan carries on.
        </Text>
        {s.canAct && (
          <Button variant="ghost" className="mt-3" onPress={() => act("reinstate")} disabled={busy}>
            Undo: they still want to cancel
          </Button>
        )}
      </Card>
    );
  }

  const details = [
    s.tierName,
    s.priceMonthlyPence != null ? `${pounds(s.priceMonthlyPence)}/mo` : null,
    s.customerSince ? `Customer since ${monthYear(s.customerSince)}` : null,
    s.serviceUsed ? "service used" : "service not yet used",
  ].filter(Boolean);

  return (
    <Card variant="raised">
      <View className="flex-row items-center justify-between">
        <Micro>Wants to cancel</Micro>
        <Pill tone="danger">{s.source === "engineer_logged" ? "LOGGED BY YOU" : "FROM THEIR LINK"}</Pill>
      </View>
      <Text className="mt-1.5 text-base font-bold text-ink">{s.customerName} wants to cancel</Text>
      <Text className="mt-0.5 text-sm text-ink">
        Reason: {s.reason ?? "Not given"}
        {s.effectiveAt ? ` · Plan ends ${day(s.effectiveAt)}` : ""}
      </Text>
      <Text className="mt-0.5 text-xs text-muted">{details.join(" · ")}</Text>
      <View className="mt-3 gap-2">
        {s.phone && (
          <Button onPress={() => Linking.openURL(`tel:${s.phone}`).catch(() => {})}>{`Call ${first}`}</Button>
        )}
        {s.canAct && s.cheaper && (
          <Button variant="ghost" onPress={() => act("offer_cheaper")} disabled={busy || offerSent}>
            {offerSent ? "Offer sent" : `Offer a cheaper plan (${s.cheaper.name}, ${pounds(s.cheaper.priceMonthlyPence)}/mo)`}
          </Button>
        )}
        {s.canAct && (
          <Button variant="ghost" onPress={() => act("saved")} disabled={busy}>
            Mark as saved
          </Button>
        )}
      </View>
      <Text className="mt-2.5 text-xs text-muted">
        You can&apos;t stop a cancellation, but a quick call saves most customers.
      </Text>
    </Card>
  );
}
