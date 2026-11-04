import { useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { api, ApiError } from "@/lib/api";
import { Icon } from "@/components/icon";

// Matt, 4 Nov — photos and documents on the boiler or a visit: the boiler,
// its data plate, repair work, parts fitted, invoices, certificates. The
// homeowner sees them on their Home Passport; this engineer only sees their
// own (app/api/customers/[id]/passport/files).
export type PassportFile = {
  id: string;
  kind: string;
  kindLabel: string;
  label: string | null;
  url: string;
  contentType: string;
  recordId: string | null;
};

const KINDS: { key: string; label: string }[] = [
  { key: "boiler", label: "Boiler" },
  { key: "data_plate", label: "Data plate" },
  { key: "repair", label: "Repair work" },
  { key: "parts", label: "Parts fitted" },
  { key: "invoice", label: "Invoice" },
  { key: "certificate", label: "Certificate" },
  { key: "other", label: "Other" },
];
// Same cap as the server (lib/passport-files.ts): base64 grows by a third
// and the request has to stay under 4.5 MB.
const MAX_BYTES = 3 * 1024 * 1024;

async function webBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function pick(source: "camera" | "library" | "pdf"): Promise<{ base64: string; mimeType: string } | null> {
  if (source === "pdf") {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return null;
    if (asset.size && asset.size > MAX_BYTES) throw new Error("That PDF is too big. Keep it under 3 MB.");
    const base64 = Platform.OS === "web" && asset.file ? await webBase64(asset.file) : await new File(asset.uri).base64();
    return { base64, mimeType: "application/pdf" };
  }
  const perm =
    source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      source === "camera" ? "Camera is off" : "Photos are off",
      "Allow access for TradeSura in your phone's Settings to add photos.",
    );
    return null;
  }
  // A data plate has to stay readable, so a little better than the service
  // photos, and still well under the size cap.
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.5, base64: true };
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset?.base64) return null;
  return { base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" };
}

export function PassportFiles({
  customerId,
  files,
  recordId,
  canAdd,
  onChanged,
}: {
  customerId: string;
  files: PassportFile[];
  /** A visit's files; left out for the boiler's. */
  recordId?: string;
  canAdd: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  function chooseKind() {
    Alert.alert("What is it?", undefined, [
      ...KINDS.map((k) => ({ text: k.label, onPress: () => chooseSource(k.key) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  function chooseSource(kind: string) {
    Alert.alert("Add from", undefined, [
      { text: "Take photo", onPress: () => upload(kind, "camera") },
      { text: "Choose photo", onPress: () => upload(kind, "library") },
      { text: "Choose PDF", onPress: () => upload(kind, "pdf") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function upload(kind: string, source: "camera" | "library" | "pdf") {
    setBusy(true);
    try {
      const picked = await pick(source);
      if (!picked) return;
      await api(`/api/customers/${customerId}/passport/files`, {
        method: "POST",
        body: JSON.stringify({ kind, ...picked, ...(recordId ? { recordId } : {}) }),
      });
      onChanged();
    } catch (e) {
      Alert.alert("Couldn't add it", e instanceof ApiError || e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  function remove(f: PassportFile) {
    Alert.alert(`Remove this ${f.kindLabel.toLowerCase()}?`, "It comes off the homeowner's Home Passport too.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/customers/${customerId}/passport/files?fileId=${encodeURIComponent(f.id)}`, { method: "DELETE" });
            onChanged();
          } catch (e) {
            Alert.alert("Couldn't remove it", e instanceof ApiError ? e.message : "Try again.");
          }
        },
      },
    ]);
  }

  if (!canAdd && files.length === 0) return null;
  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {files.map((f) => (
        <Pressable
          key={f.id}
          onPress={() => Linking.openURL(f.url)}
          onLongPress={() => remove(f)}
          accessibilityRole="button"
          accessibilityLabel={`${f.label || f.kindLabel}. Tap to open, long press to remove.`}
          className="w-16"
        >
          {f.contentType === "application/pdf" ? (
            <View className="h-16 w-16 items-center justify-center rounded-[10px] border border-line bg-bg">
              <Icon name="document" size={22} color="#5FA3F0" />
            </View>
          ) : (
            <Image source={{ uri: f.url }} style={{ width: 64, height: 64, borderRadius: 10 }} />
          )}
          <Text numberOfLines={1} className="mt-1 text-center text-[10.5px] text-muted">
            {f.label || f.kindLabel}
          </Text>
        </Pressable>
      ))}
      {canAdd && (
        <Pressable
          onPress={chooseKind}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add photo or document"
          className="h-16 min-w-16 flex-row items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong px-3"
        >
          {busy ? (
            <ActivityIndicator color="#5FA3F0" />
          ) : (
            <>
              <Icon name="plus" size={16} color="#5FA3F0" />
              <Text className="text-xs font-semibold text-flame">Add photo or document</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}
