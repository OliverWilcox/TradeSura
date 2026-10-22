import { useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { api, ApiError } from "@/lib/api";
import { Icon } from "@/components/icon";

export const MAX_PASSPORT_PHOTOS = 4;

// Section 4 — boiler and service photos for the Home Passport. Each photo is
// uploaded as soon as it's picked (base64 JSON, same as the ID-card upload)
// so the form only ever holds stored URLs.
async function pickAndUpload(source: "camera" | "library"): Promise<string | null> {
  const perm =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      source === "camera" ? "Camera is off" : "Photos are off",
      "Allow access for TradeSura in your phone's Settings to add photos.",
    );
    return null;
  }
  // Low quality on purpose: a service photo needs to be legible, not 12MP,
  // and a full-size one blows past the API's request-size limit.
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.4, base64: true };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset?.base64) return null;
  const { url } = await api<{ url: string }>("/api/passport/photo", {
    method: "POST",
    body: JSON.stringify({ base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" }),
  });
  return url;
}

export function PhotoStrip({
  urls,
  onChange,
  disabled,
}: {
  urls: string[];
  onChange?: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const editable = Boolean(onChange) && !disabled;

  function add() {
    Alert.alert("Add a photo", undefined, [
      { text: "Take photo", onPress: () => run("camera") },
      { text: "Choose from library", onPress: () => run("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function run(source: "camera" | "library") {
    setBusy(true);
    try {
      const url = await pickAndUpload(source);
      if (url) onChange?.([...urls, url].slice(0, MAX_PASSPORT_PHOTOS));
    } catch (e) {
      Alert.alert("Couldn't add the photo", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editable && urls.length === 0) return null;
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {urls.map((u) => (
        <Pressable
          key={u}
          disabled={!editable}
          onLongPress={() => onChange?.(urls.filter((x) => x !== u))}
          accessibilityLabel={editable ? "Photo. Long press to remove." : "Photo"}
        >
          <Image source={{ uri: u }} style={{ width: 64, height: 64, borderRadius: 10 }} />
        </Pressable>
      ))}
      {editable && urls.length < MAX_PASSPORT_PHOTOS && (
        <Pressable
          onPress={add}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
          className="h-16 w-16 items-center justify-center rounded-[10px] border border-dashed border-line-strong"
        >
          {busy ? <ActivityIndicator color="#5FA3F0" /> : <Icon name="camera" size={20} color="#5FA3F0" />}
        </Pressable>
      )}
      {editable && urls.length > 0 && (
        <Text className="w-full text-[11px] text-faint">
          {urls.length} of {MAX_PASSPORT_PHOTOS} · long press a photo to remove it
        </Text>
      )}
    </View>
  );
}
