import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { Card, Micro, Pill, RowLine, Button, SectionHeading } from "@/components/ui";
import { Icon } from "@/components/icon";
import { PhotoStrip } from "@/components/passport-photos";
import { StickerScanner } from "@/components/sticker-scanner";

type Lead = { kind: "replacement" | "repair"; text: string };
type Stock = { left: number; low: boolean };
type Passport = {
  state: "LIVE" | "FROZEN";
  address: string;
  boiler: { make: string | null; model: string | null; type: string | null; installedAt: string | null; photoUrls: string[] } | null;
  records: {
    id: string;
    kind: string;
    doneAt: string;
    notes: string | null;
    photoUrls: string[];
    nextDueAt: string | null;
    stars: number | null;
    ratingRequested: boolean;
  }[];
  lastServicedAt: string | null;
  nextDueAt: string | null;
  stickers: { code: string; linkedAt: string | null }[];
  consent: boolean;
  leads: Lead[];
  canAdd: boolean;
};
type Data = { passport: Passport | null; reason?: string; stock: Stock };

const KIND: Record<string, string> = {
  service: "Service",
  certificate: "Certificate",
  install: "Install certificate",
  note: "Note",
};

const input = "rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] text-ink";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function toDmy(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
/** "12/03/2026" → Date at midday (so a timezone shift never changes the day), or null. */
function parseDmy(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12);
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
}
/** "05/2019" → 1 May 2019, or null. */
function parseMy(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return new Date(Number(m[2]), Number(m[1]) - 1, 1, 12);
}
function plusYear(d: Date): Date {
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + 1);
  return out;
}

// Section 4 — the Home Passport on the engineer's customer page: the boiler,
// this engineer's own records (never another engineer's), next due, "Log a
// service", "Link sticker" and leads (only with the homeowner's consent).
export function PassportSection({ customerId }: { customerId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "log" | "boiler">("view");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Log a service
  const [doneOn, setDoneOn] = useState(toDmy(new Date()));
  const [nextDue, setNextDue] = useState(toDmy(plusYear(new Date())));
  const [nextDueTouched, setNextDueTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  // Boiler
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [fitted, setFitted] = useState("");
  const [boilerPhotos, setBoilerPhotos] = useState<string[]>([]);

  // Sticker
  const [scanOpen, setScanOpen] = useState(false);
  const [stickerError, setStickerError] = useState<string | null>(null);
  const [topUpSent, setTopUpSent] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/customers/${customerId}/passport`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the Home Passport.");
    }
  }, [customerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function startLog() {
    const today = new Date();
    setDoneOn(toDmy(today));
    setNextDue(toDmy(plusYear(today)));
    setNextDueTouched(false);
    setNotes("");
    setPhotos([]);
    setFormError(null);
    setFlash(null);
    setMode("log");
  }

  function startBoiler(p: Passport) {
    setMake(p.boiler?.make ?? "");
    setModel(p.boiler?.model ?? "");
    const fittedAt = p.boiler?.installedAt ? new Date(p.boiler.installedAt) : null;
    setFitted(fittedAt ? `${String(fittedAt.getMonth() + 1).padStart(2, "0")}/${fittedAt.getFullYear()}` : "");
    setBoilerPhotos(p.boiler?.photoUrls ?? []);
    setFormError(null);
    setFlash(null);
    setMode("boiler");
  }

  async function saveService() {
    const done = parseDmy(doneOn);
    const next = parseDmy(nextDue);
    if (!done) return setFormError("Enter the service date as DD/MM/YYYY.");
    if (!next) return setFormError("Enter next due as DD/MM/YYYY.");
    if (next <= done) return setFormError("Next due has to be after the service date.");
    setBusy(true);
    setFormError(null);
    try {
      const res = await api<{ ratingRequested: boolean }>(`/api/customers/${customerId}/passport/service`, {
        method: "POST",
        body: JSON.stringify({
          doneAt: done.toISOString(),
          nextDueAt: next.toISOString(),
          notes: notes.trim() || undefined,
          photoUrls: photos,
        }),
      });
      setMode("view");
      setFlash(res.ratingRequested ? "Service logged. We've texted them a one-tap rating link." : "Service logged.");
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBoiler() {
    const fittedAt = fitted.trim() ? parseMy(fitted) : null;
    if (fitted.trim() && !fittedAt) return setFormError("Enter the fitted date as MM/YYYY.");
    setBusy(true);
    setFormError(null);
    try {
      await api(`/api/customers/${customerId}/passport/boiler`, {
        method: "PUT",
        body: JSON.stringify({
          make: make.trim(),
          model: model.trim(),
          installedAt: fittedAt ? fittedAt.toISOString() : null,
          photoUrls: boilerPhotos,
        }),
      });
      setMode("view");
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function linkSticker(code: string) {
    setBusy(true);
    setStickerError(null);
    try {
      const res = await api<{ code: string }>(`/api/customers/${customerId}/passport/sticker`, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setScanOpen(false);
      setFlash(`Sticker ${res.code} linked`);
      await load();
    } catch (e) {
      setStickerError(e instanceof ApiError ? e.message : "Couldn't link that sticker — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function orderMore() {
    try {
      await api("/api/stickers/top-up", { method: "POST" });
      setTopUpSent(true);
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  if (loadError) {
    return (
      <Card>
        <Micro className="mb-1">Home Passport</Micro>
        <Text className="text-xs text-danger">{loadError}</Text>
        <Button variant="ghost" className="mt-2" onPress={load}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!data) return null;
  const p = data.passport;

  if (!p) {
    return (
      <Card>
        <Micro className="mb-1">Home Passport</Micro>
        <Text className="text-sm text-muted">{data.reason}</Text>
      </Card>
    );
  }

  const boilerName = [p.boiler?.make, p.boiler?.model].filter(Boolean).join(" ") || p.boiler?.type || "Boiler";

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionHeading>Home Passport</SectionHeading>
        {p.state === "LIVE" ? <Pill tone="info">LIVE</Pill> : <Pill tone="off">FROZEN</Pill>}
      </View>

      {p.state === "FROZEN" && (
        <Text className="text-xs text-muted">
          No active plan, so nothing new can be added. Past records are kept for the homeowner.
        </Text>
      )}
      {flash && <Text className="text-xs font-semibold text-flame">{flash}</Text>}

      {/* Boiler */}
      {mode === "boiler" ? (
        <Card>
          <Micro className="mb-2">Boiler</Micro>
          <View className="gap-2">
            <TextInput value={make} onChangeText={setMake} placeholder="Make, e.g. Worcester Bosch" placeholderTextColor="#6e86a3" className={input} />
            <TextInput value={model} onChangeText={setModel} placeholder="Model, e.g. 30i" placeholderTextColor="#6e86a3" className={input} />
            <TextInput
              value={fitted}
              onChangeText={setFitted}
              placeholder="Fitted MM/YYYY"
              placeholderTextColor="#6e86a3"
              keyboardType="numbers-and-punctuation"
              className={input}
            />
          </View>
          <PhotoStrip urls={boilerPhotos} onChange={setBoilerPhotos} disabled={busy} />
          {formError && <Text className="mt-2 text-xs text-danger">{formError}</Text>}
          <View className="mt-3 gap-2">
            <Button onPress={saveBoiler} disabled={busy}>
              {busy ? "Saving…" : "Save boiler"}
            </Button>
            <Button variant="ghost" onPress={() => setMode("view")} disabled={busy}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Card>
          <View className="flex-row items-start gap-3">
            <Icon name="boiler" size={22} color="#5FA3F0" />
            <View className="flex-1">
              <Text className="text-base font-bold text-ink">{boilerName}</Text>
              <Text className="text-xs text-muted">
                {p.boiler?.installedAt ? `Fitted ${monthYear(p.boiler.installedAt)}` : "Fitted date not recorded"}
              </Text>
            </View>
            {p.canAdd && (
              <Pressable onPress={() => startBoiler(p)} accessibilityRole="button" hitSlop={8}>
                <Text className="text-xs font-bold text-flame">Edit</Text>
              </Pressable>
            )}
          </View>
          <PhotoStrip urls={p.boiler?.photoUrls ?? []} />
          {p.lastServicedAt && <RowLine left="Last service" right={day(p.lastServicedAt)} />}
          {p.nextDueAt && <RowLine left="Next due" right={day(p.nextDueAt)} />}
        </Card>
      )}

      {/* Log a service */}
      {mode === "log" ? (
        <Card>
          <Micro className="mb-2">Log a service</Micro>
          <View className="gap-2">
            <Text className="text-xs text-muted">Date of service</Text>
            <TextInput
              value={doneOn}
              onChangeText={(v) => {
                setDoneOn(v);
                const d = parseDmy(v);
                if (d && !nextDueTouched) setNextDue(toDmy(plusYear(d)));
              }}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#6e86a3"
              keyboardType="numbers-and-punctuation"
              className={input}
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (optional), e.g. pump getting noisy"
              placeholderTextColor="#6e86a3"
              multiline
              maxLength={1000}
              textAlignVertical="top"
              className={`${input} min-h-[80px]`}
            />
            <Text className="text-xs text-muted">Photos (up to 4)</Text>
          </View>
          <PhotoStrip urls={photos} onChange={setPhotos} disabled={busy} />
          <View className="mt-2 gap-2">
            <Text className="text-xs text-muted">Next service due</Text>
            <TextInput
              value={nextDue}
              onChangeText={(v) => {
                setNextDue(v);
                setNextDueTouched(true);
              }}
              placeholder="DD/MM/YYYY"
              placeholderTextColor="#6e86a3"
              keyboardType="numbers-and-punctuation"
              className={input}
            />
          </View>
          {formError && <Text className="mt-2 text-xs text-danger">{formError}</Text>}
          <View className="mt-3 gap-2">
            <Button onPress={saveService} disabled={busy}>
              {busy ? "Saving…" : "Save service"}
            </Button>
            <Button variant="ghost" onPress={() => setMode("view")} disabled={busy}>
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        p.canAdd && (
          <Button variant="ghost" onPress={startLog}>
            Log a service
          </Button>
        )
      )}

      {/* Records — this engineer's own */}
      <Card>
        <Micro className="mb-1">Your records</Micro>
        {p.records.length === 0 ? (
          <Text className="py-1 text-xs text-muted">Nothing logged yet.</Text>
        ) : (
          p.records.map((r) => (
            <View key={r.id} className="border-b border-line-soft py-2.5 last:border-b-0">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-sm text-ink">
                  {KIND[r.kind] ?? r.kind} · {day(r.doneAt)}
                </Text>
                {r.stars ? (
                  <Text className="text-xs text-flame">{"★".repeat(r.stars)}</Text>
                ) : r.ratingRequested ? (
                  <Text className="text-[11px] text-faint">Rating asked</Text>
                ) : null}
              </View>
              {r.notes ? <Text className="mt-0.5 text-xs text-muted">{r.notes}</Text> : null}
              <PhotoStrip urls={r.photoUrls} />
            </View>
          ))
        )}
      </Card>

      {/* Stickers */}
      <Card>
        <Micro className="mb-1">Boiler sticker</Micro>
        {p.stickers.length > 0 ? (
          p.stickers.map((s) => (
            <View key={s.code} className="flex-row items-center gap-2 py-1">
              <Icon name="qr" size={16} color="#5FA3F0" />
              <Text className="text-sm text-ink">Sticker {s.code} linked</Text>
            </View>
          ))
        ) : (
          <Text className="text-xs text-muted">
            Stick it on the case — never over the data plate or vents — then link it here.
          </Text>
        )}
        <Button
          variant="ghost"
          className="mt-2.5"
          onPress={() => {
            setStickerError(null);
            setScanOpen(true);
          }}
        >
          Link sticker
        </Button>
        <View className="mt-2 flex-row flex-wrap items-center justify-center gap-1">
          <Text className={`text-xs ${data.stock.low ? "text-warn" : "text-muted"}`}>
            Stickers left: {data.stock.left} ·
          </Text>
          {topUpSent ? (
            <Text className="text-xs font-semibold text-flame">Free top-up on its way</Text>
          ) : (
            <Pressable onPress={orderMore} accessibilityRole="button" hitSlop={8}>
              <Text className="text-xs font-bold text-flame">Order more free</Text>
            </Pressable>
          )}
        </View>
      </Card>

      {/* Leads — only ever with the homeowner's consent */}
      {p.leads.length > 0 && (
        <Card>
          <Micro className="mb-1">Opportunities</Micro>
          {p.leads.map((l) => (
            <View key={l.kind} className="flex-row items-start gap-2 py-1.5">
              <Icon name="bulb" size={16} color="#F2B84B" />
              <Text className="flex-1 text-[13px] text-ink">{l.text}</Text>
            </View>
          ))}
          <Text className="mt-1 text-[11px] text-faint">The homeowner has agreed to be contacted about their home.</Text>
        </Card>
      )}

      {scanOpen && (
        <StickerScanner busy={busy} error={stickerError} onCode={linkSticker} onClose={() => setScanOpen(false)} />
      )}
    </View>
  );
}
