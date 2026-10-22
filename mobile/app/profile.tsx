import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Linking, KeyboardAvoidingView, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button, Tick } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Toggle } from "@/components/toggle";
import { CenteredSpinner, LoadingImage } from "@/components/skeleton";

// Getting started · "Get found on Google" (Section 8, step 3 of the wizard) —
// the engineer's free public profile at
// tradesura.com/gas-engineers/{town}/{slug}: short bio, a couple of photos,
// areas covered, the Call and Message switches and the number shown, and a
// preview. Publishing lets search engines index it.

type Profile = {
  profileBio: string;
  serviceArea: string;
  published: boolean;
  url: string;
  display: string;
  town: string;
  photos: string[];
  showCallButton: boolean;
  showMessageButton: boolean;
  enquiryPhone: string;
  accountPhone: string;
};

const BIO_MAX = 600;
const MAX_PHOTOS = 4;

function prettyPhone(e164: string): string {
  return e164.startsWith("+44") ? `0${e164.slice(3)}` : e164;
}

export default function ProfileScreen() {
  const { me, refreshMe } = useAuth();
  const [data, setData] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [area, setArea] = useState("");
  const [town, setTown] = useState("");
  const [showCall, setShowCall] = useState(true);
  const [showMessage, setShowMessage] = useState(true);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Profile>("/api/me/profile")
        .then((p) => {
          setData(p);
          setBio(p.profileBio);
          setArea(p.serviceArea);
          setTown(p.town);
          setShowCall(p.showCallButton);
          setShowMessage(p.showMessageButton);
          setPhone(p.enquiryPhone ? prettyPhone(p.enquiryPhone) : "");
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your profile."));
    }, []),
  );

  async function save(publish: boolean, then?: "back" | "preview") {
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const p = await api<Profile & { ok: true }>("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          profileBio: bio,
          serviceArea: area,
          publish,
          showCallButton: showCall,
          showMessageButton: showMessage,
          enquiryPhone: phone,
          ...(town.trim() ? { town } : {}),
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refreshMe();
      setData(p);
      setTown(p.town);
      if (then === "preview") Linking.openURL(p.url);
      else if (publish) router.back();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { field?: string; explanation?: string } | undefined) : undefined;
      if (e instanceof ApiError && body?.field) {
        setFieldError({ field: body.field, message: body.explanation ?? e.message });
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't save your profile.");
      }
    } finally {
      setBusy(false);
    }
  }

  // Base64 JSON upload, same as the logo (RN multipart bug — see more.tsx).
  async function addPhoto() {
    setPhotoError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError("Allow photo access to add photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    setPhotoBusy(true);
    try {
      const { photos } = await api<{ photos: string[] }>("/api/me/profile/photos", {
        method: "POST",
        body: JSON.stringify({ base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" }),
      });
      setData((d) => (d ? { ...d, photos } : d));
    } catch (e) {
      setPhotoError(e instanceof ApiError ? e.message : "Couldn't upload that photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto(url: string) {
    setPhotoError(null);
    try {
      const { photos } = await api<{ photos: string[] }>("/api/me/profile/photos", {
        method: "DELETE",
        body: JSON.stringify({ url }),
      });
      setData((d) => (d ? { ...d, photos } : d));
    } catch (e) {
      setPhotoError(e instanceof ApiError ? e.message : "Couldn't remove that photo.");
    }
  }

  const brand = me?.tradingName?.trim() || "Your business";
  const firstName = me?.firstName?.trim() || "you";
  const verified = Boolean(me?.gasSafeVerifiedAt);
  const errorFor = (field: string) =>
    fieldError?.field === field ? <Text className="mt-1.5 text-[13px] text-danger">{fieldError.message}</Text> : null;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started · Get found" />
      </SafeAreaView>
      {!data ? (
        error ? (
          <Text className="p-6 text-center text-sm text-danger">{error}</Text>
        ) : (
          <CenteredSpinner label="Loading your profile" />
        )
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
          <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
            <View>
              <Text className="text-[22px] font-bold text-ink">Get found on Google</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                Your free TradeSura profile wins you enquiries from local homeowners: your plans,
                your Gas Safe status, your ratings and Call and Message buttons.
              </Text>
            </View>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Your address</Text>
              <Text selectable className="mt-1.5 text-[16px] font-bold text-ink">
                {data.display}
              </Text>
              <View className="mt-2 flex-row items-center gap-2">
                {data.published ? (
                  <>
                    <Tick size={13} />
                    <Text className="text-[13px] text-ink">Published — open to search engines</Text>
                  </>
                ) : (
                  <Text className="text-[13px] text-muted">Not published yet</Text>
                )}
              </View>
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">About {brand}</Text>
              <TextInput
                value={bio}
                onChangeText={(v) => {
                  setBio(v.slice(0, BIO_MAX));
                  setFieldError(null);
                }}
                multiline
                maxLength={BIO_MAX}
                placeholder="Family-run heating engineers covering… How long you've been trading, the boilers you know best."
                placeholderTextColor="#6e86a3"
                textAlignVertical="top"
                className="mt-2 min-h-[120px] rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] leading-[22px] text-ink"
              />
              <Text className="mt-1 text-right text-[12px] text-muted">
                {bio.length}/{BIO_MAX}
              </Text>
              {errorFor("profileBio")}
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Photos</Text>
              <Text className="mt-1.5 text-[13.5px] text-muted">
                A couple of photos — your van, your team, a tidy install. Real photos help you rank.
              </Text>
              <View className="mt-2.5 flex-row flex-wrap gap-2.5">
                {data.photos.map((url) => (
                  <View key={url}>
                    <LoadingImage uri={url} width={96} height={72} radius={10} resizeMode="cover" />
                    <Pressable
                      onPress={() => removePhoto(url)}
                      accessibilityLabel="Remove photo"
                      className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full bg-iron"
                    >
                      <Icon name="close" size={11} color="#ffffff" />
                    </Pressable>
                  </View>
                ))}
                {data.photos.length < MAX_PHOTOS && (
                  <Pressable
                    onPress={addPhoto}
                    disabled={photoBusy}
                    className={`h-[72px] w-[96px] items-center justify-center rounded-[10px] border border-dashed border-line-strong ${photoBusy ? "opacity-50" : ""}`}
                  >
                    <Icon name={photoBusy ? "clock" : "camera"} size={18} color="#5fa3f0" />
                    <Text className="mt-1 text-[12px] text-flame">{photoBusy ? "Uploading" : "Add photo"}</Text>
                  </Pressable>
                )}
              </View>
              {photoError && <Text className="mt-1.5 text-[13px] text-danger">{photoError}</Text>}
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Areas covered</Text>
              <TextInput
                value={area}
                onChangeText={(v) => {
                  setArea(v);
                  setFieldError(null);
                }}
                maxLength={120}
                placeholder="e.g. Huddersfield, Holmfirth, HD1, HD2, HD9"
                placeholderTextColor="#6e86a3"
                className="mt-2 min-h-[48px] rounded-xl border border-line-strong bg-bg px-3.5 text-[16px] text-ink"
              />
              <Text className="mt-1.5 text-[12.5px] text-muted">Towns or postcode areas — what people type into Google.</Text>
              {errorFor("serviceArea")}
              <Text className="mt-3 text-[13px] font-semibold text-ink">Your town</Text>
              <TextInput
                value={town}
                onChangeText={(v) => {
                  setTown(v);
                  setFieldError(null);
                }}
                maxLength={60}
                placeholder="We'll use the first town in your areas"
                placeholderTextColor="#6e86a3"
                className="mt-1.5 min-h-[48px] rounded-xl border border-line-strong bg-bg px-3.5 text-[16px] text-ink"
              />
              <Text className="mt-1.5 text-[12.5px] text-muted">
                Your profile is listed under &ldquo;Gas engineers in {town.trim() || "your town"}&rdquo;.
              </Text>
              {errorFor("town")}
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Call and Message</Text>
              <View className="mt-2 flex-row items-center justify-between gap-3 py-1.5">
                <Text className="flex-1 text-[15px] text-ink">Show Call button</Text>
                <Toggle value={showCall} onValueChange={setShowCall} accessibilityLabel="Show Call button" />
              </View>
              {showCall && (
                <>
                  <Text className="mt-1 text-[13px] text-muted">Number shown</Text>
                  <TextInput
                    value={phone}
                    onChangeText={(v) => {
                      setPhone(v);
                      setFieldError(null);
                    }}
                    keyboardType="phone-pad"
                    maxLength={20}
                    placeholder={data.accountPhone ? `${prettyPhone(data.accountPhone)} (your mobile)` : "Your business number"}
                    placeholderTextColor="#6e86a3"
                    className="mt-1.5 min-h-[48px] rounded-xl border border-line-strong bg-bg px-3.5 text-[16px] text-ink"
                  />
                  <Text className="mt-1.5 text-[12.5px] text-muted">Leave blank to use your mobile.</Text>
                  {errorFor("enquiryPhone")}
                </>
              )}
              <View className="mt-2 flex-row items-center justify-between gap-3 py-1.5">
                <Text className="flex-1 text-[15px] text-ink">Show Message button</Text>
                <Toggle value={showMessage} onValueChange={setShowMessage} accessibilityLabel="Show Message button" />
              </View>
              <Text className="mt-1 text-[12.5px] text-muted">
                Messages land in Enquiries in this app, with a notification and an email.
              </Text>
            </Card>

            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Also on your page</Text>
              {[
                "Your live plans, with a Join button",
                verified ? "Your Gas Safe verified badge" : "Your Gas Safe badge, once it's verified",
                "Ratings from your plan customers",
                `Call ${firstName} and Message buttons, if switched on`,
                "The gas emergency number, on every page",
              ].map((t) => (
                <View key={t} className="flex-row items-center gap-2 py-1">
                  <Tick size={12} />
                  <Text className="flex-1 text-[14px] text-ink">{t}</Text>
                </View>
              ))}
            </Card>

            {error && <Text className="px-1 text-sm text-danger">{error}</Text>}

            <Button variant="ghost" onPress={() => save(data.published, "preview")} disabled={busy}>
              Preview my profile
            </Button>
            <Button onPress={() => save(true, "back")} disabled={busy}>
              {busy ? "Saving…" : data.published ? "Save changes" : "Publish my profile"}
            </Button>
            {data.published ? (
              <Pressable onPress={() => save(false)} disabled={busy} className="items-center py-2">
                <Text className="text-[14px] text-muted underline">Hide from search engines</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => router.back()} disabled={busy} className="items-center py-2">
                <Text className="text-[14px] font-semibold text-flame">Skip for now</Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
