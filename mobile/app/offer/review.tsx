import { useCallback, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, Linking } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { Skeleton, Bone } from "@/components/skeleton";
import { checkEmail, checkUkMobile } from "@/lib/validate";

// 30 Oct update §6.4 — plans first, then the review. After joining (or "not
// today") the installer asks: "Before I go, would you leave me a quick
// review?" — every customer, joined or not. A joiner's details carry over
// from their sign-up; anyone else gives a mobile or email and confirms it
// with a code. No review without one or the other.

type Status = {
  reason: string;
  joined: boolean;
  reviewed: boolean;
  town: string | null;
  business: string | null;
  customer: { firstName: string; lastName: string; phone: string; email: string | null } | null;
};

const inputCls = "min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink";

export default function OfferReview() {
  const { token, planId } = useLocalSearchParams<{ token: string; planId?: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>(`/api/offer/session/${token}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load this offer.");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Leaving the review screen: the sent-link status screen if there is one.
  const finish = () => router.replace(planId ? `/offer/${planId}` : "/");

  const isEmail = contact.includes("@");

  async function sendCode() {
    const problem = isEmail ? checkEmail(contact) : checkUkMobile(contact);
    if (!name.trim()) return setError("Enter your name.");
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ requestToken: string; devCode?: string }>("/api/offer/review", {
        method: "POST",
        body: JSON.stringify({ action: "code", token, ...(isEmail ? { email: contact.trim() } : { phone: contact.trim() }) }),
      });
      setRequestToken(r.requestToken);
      // Local development only (no text provider): the server hands the code back.
      if (r.devCode) setCode(r.devCode);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(acknowledged = false) {
    if (!stars) return setError("Tap 1 to 5 stars.");
    if (!status?.joined && !requestToken) return setError("Enter your mobile or email so we can check it's you.");
    if (!status?.joined && !/^\d{4}$/.test(code)) return setError("Enter the four-digit code we sent you.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/offer/review", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          token,
          stars,
          comment: comment.trim() || undefined,
          acknowledged,
          consent,
          ...(status?.joined
            ? {}
            : {
                name: name.trim(),
                ...(isEmail ? { email: contact.trim() } : { phone: contact.trim() }),
                requestToken,
                code,
              }),
        }),
      });
      setEmergency(false);
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.message === "emergency") setEmergency(true);
      else setError(e instanceof ApiError ? e.message : "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  }

  const first = status?.customer?.firstName;
  const business = status?.business ?? "your engineer";

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Quick review" onBack={finish} />
      </SafeAreaView>
      {loadError ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="font-sans text-sm text-danger">{loadError}</Text>
          <Button variant="ghost" className="w-full" onPress={finish}>
            Done
          </Button>
        </View>
      ) : !status ? (
        <Skeleton label="Loading" className="gap-3.5 px-4 pt-4">
          <Bone height={220} radius={16} />
        </Skeleton>
      ) : emergency ? (
        // CLAUDE.md compliance 4 — the gas-emergency interlock, before anything else.
        <ScrollView contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
          <Card className="border-danger">
            <Text className="text-[19px] font-bold text-danger">If you can smell gas, act now</Text>
            <Text className="mt-2 text-[14px] leading-5 text-ink">
              Don&apos;t use light switches or naked flames. Open doors and windows. Leave the property and call
              the National Gas Emergency line now: 0800 111 999.
            </Text>
            <Button className="mt-4" onPress={() => Linking.openURL("tel:0800111999")}>
              Call 0800 111 999
            </Button>
            <Button variant="ghost" className="mt-2" onPress={() => submit(true)} disabled={busy}>
              I have called / this is not an emergency
            </Button>
          </Card>
        </ScrollView>
      ) : done || status.reviewed ? (
        <ScrollView contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
          <Card>
            <Micro>Thank you</Micro>
            <Text className="mt-1.5 text-[19px] font-bold text-ink">Review saved</Text>
            <Text className="mt-1 text-[14px] leading-5 text-muted">
              {status.town ? `Every review moves ${business} up the ${status.town} page.` : "Every review helps other customers find you."}
            </Text>
            <Button className="mt-4" onPress={finish}>
              Done
            </Button>
          </Card>
        </ScrollView>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4" keyboardShouldPersistTaps="handled">
          <Card>
            <Text className="text-[19px] font-bold text-ink">
              {first ? `Thanks, ${first}. ` : ""}Before I go, would you leave me a quick review?
            </Text>
            <Text className="mt-1 text-[13px] text-muted">
              {status.town ? `Every review moves me up the ${status.town} page.` : "Every review helps other customers find me."}
            </Text>
            <View className="mt-4 flex-row justify-center gap-2" accessibilityRole="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setStars(n)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
                  accessibilityState={{ checked: stars === n }}
                  hitSlop={6}
                  className="h-12 w-12 items-center justify-center"
                >
                  <Text className={`text-[34px] ${n <= stars ? "text-flame" : "text-line"}`}>★</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              placeholder="Anything you'd like to say? (optional)"
              placeholderTextColor="#6e86a3"
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={1000}
              className={`mt-3 min-h-[88px] py-3 ${inputCls}`}
              textAlignVertical="top"
            />
          </Card>

          {status.joined ? (
            <Card>
              <Text className="text-[13px] text-muted">
                We&apos;ll use the details you just joined with
                {status.customer ? ` (${status.customer.firstName} ${status.customer.lastName})` : ""}.
              </Text>
            </Card>
          ) : (
            <Card>
              <Text className="font-semibold text-[14px] text-ink">Your details</Text>
              <Text className="mt-0.5 text-[12.5px] text-muted">
                We check every review is from a real customer. Only your first name and initial show.
              </Text>
              <TextInput
                placeholder="Your name"
                placeholderTextColor="#6e86a3"
                value={name}
                onChangeText={setName}
                autoComplete="name"
                className={`mt-3 ${inputCls}`}
              />
              <TextInput
                placeholder="Mobile or email"
                placeholderTextColor="#6e86a3"
                value={contact}
                onChangeText={(v) => {
                  setContact(v);
                  setRequestToken(null);
                  setCode("");
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={isEmail ? "email-address" : "default"}
                className={`mt-2 ${inputCls}`}
              />
              {requestToken ? (
                <TextInput
                  placeholder="4-digit code"
                  placeholderTextColor="#6e86a3"
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  className={`mt-2 ${inputCls}`}
                />
              ) : (
                <Button variant="ghost" className="mt-2" onPress={sendCode} disabled={busy}>
                  {busy ? "Sending…" : "Send me a code"}
                </Button>
              )}
              <Pressable
                onPress={() => setConsent((c) => !c)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent }}
                className="mt-3 flex-row items-start gap-2.5"
              >
                <View
                  className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${consent ? "border-flame bg-flame" : "border-line"}`}
                >
                  {consent && <Text className="text-[12px] font-bold text-iron">✓</Text>}
                </View>
                <Text className="flex-1 text-[13px] text-ink">
                  {business} may send you occasional plan offers. Untick if you&apos;d rather not.
                </Text>
              </Pressable>
            </Card>
          )}

          {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
          <Button onPress={() => submit(false)} disabled={busy}>
            {busy ? "Saving…" : "Leave my review"}
          </Button>
          <Button variant="ghost" onPress={finish}>
            No thanks
          </Button>
        </ScrollView>
      )}
    </View>
  );
}
