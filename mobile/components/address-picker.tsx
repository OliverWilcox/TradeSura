import { useEffect, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui";

// Review 4 — one address everywhere, chosen once at setup:
// tradesura.com/{slug} is the profile, the plan links, QR codes, the member
// pack and the website link. Until it's chosen it follows the trading name;
// after, renaming the business never moves it.
export function AddressPicker({
  slug,
  chosen,
  onChosen,
}: {
  slug: string;
  chosen: boolean;
  onChosen: (slug: string) => void;
}) {
  const [draft, setDraft] = useState(slug);
  const [remote, setRemote] = useState<{ for: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted = draft.trim();
  const check =
    !wanted
      ? null
      : wanted === slug
        ? { ok: true, text: "Your address now. Change it here, or keep it." }
        : remote?.for === wanted
          ? remote
          : null;

  // Checks the name as they type, so a taken or kept word shows before Save.
  useEffect(() => {
    if (chosen || !wanted || wanted === slug) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ ok: boolean; display?: string; error?: string }>(`/api/settings/address?slug=${encodeURIComponent(wanted)}`)
        .then(
          (r) =>
            live &&
            setRemote({ for: wanted, ok: r.ok, text: r.ok ? `${r.display} is free` : (r.error ?? "Try another.") }),
        )
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [wanted, chosen, slug]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ slug: string }>("/api/settings/address", {
        method: "POST",
        body: JSON.stringify({ slug: draft.trim() }),
      });
      onChosen(r.slug);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your address — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (chosen) {
    return (
      <View>
        <Text selectable className="text-[16px] font-bold text-ink">
          tradesura.com/{slug}
        </Text>
        <Text className="mt-1 text-[11px] text-faint">
          On your plan links, QR codes, member pack and website. Each plan has its own link under it.
        </Text>
      </View>
    );
  }
  return (
    <View>
      <View className="flex-row items-center rounded-[10px] border border-line bg-paper px-3.5">
        <Text className="text-[15px] text-muted">tradesura.com/</Text>
        <TextInput
          value={draft}
          onChangeText={(v) => {
            setDraft(v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          maxLength={40}
          accessibilityLabel="Your TradeSura address"
          className="min-h-[48px] flex-1 text-[15px] text-ink"
        />
      </View>
      {check && (
        <Text className={`mt-1 text-xs ${check.ok ? "text-muted" : "text-warn"}`}>{check.text}</Text>
      )}
      <Text className="mt-1 text-[11px] text-faint">
        You choose this once. It goes on your plan links, QR codes, member pack and website. Links you&apos;ve already
        shared keep working.
      </Text>
      {error && <Text className="mt-1.5 text-xs text-danger">{error}</Text>}
      <Button variant="ghost" onPress={save} disabled={busy || !draft.trim() || check?.ok === false} className="mt-2.5">
        {busy ? "Saving…" : "Keep this address"}
      </Button>
    </View>
  );
}
