import { View, Text, Pressable, Image, ActivityIndicator, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Icon } from "@/components/icon";

// The Gas Safe ID photo panel (30 Sept build notes, step 2 items 2–9): one
// big tap target → camera, a preview to check before it's used, upload with
// retry that never loses the photo, and a Settings route when the camera is
// refused — never a dead end. Controlled: the parent keeps the state so it
// survives the sign-up wizard switching steps.

export type IdPhoto = { uri: string; base64: string; mimeType: string };

export type IdCardState =
  | { phase: "empty" }
  | { phase: "denied"; source: "camera" | "library" }
  | { phase: "preview"; photo: IdPhoto }
  | { phase: "uploading"; photo: IdPhoto }
  | { phase: "failed"; photo: IdPhoto }
  | { phase: "added"; photo: IdPhoto };

const BLUE = "#5FA3F0";

export function IdCardPicker({
  value,
  onChange,
  upload,
  error,
  whose = "your",
}: {
  value: IdCardState;
  onChange: (next: IdCardState) => void;
  /** Stores the photo; throws on failure. */
  upload: (photo: IdPhoto) => Promise<void>;
  error?: string | null;
  /** "their" when an owner photographs a staff engineer's card. */
  whose?: "your" | "their";
}) {
  async function pick(source: "camera" | "library") {
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      onChange({ phase: "denied", source });
      return;
    }
    // Low quality on purpose: a 12MP phone photo at full quality blows past
    // the API's request-size limit, and a card only needs to be legible.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.35, base64: true };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    onChange({
      phase: "preview",
      photo: { uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" },
    });
  }

  async function use(photo: IdPhoto) {
    onChange({ phase: "uploading", photo });
    try {
      await upload(photo);
      onChange({ phase: "added", photo });
    } catch {
      // The photo stays put — a dropped signal costs one tap, not a retake.
      onChange({ phase: "failed", photo });
    }
  }

  const border = error ? "border-warn" : "border-white/35";

  if (value.phase === "empty" || value.phase === "denied") {
    return (
      <View>
        <Pressable
          onPress={() => pick("camera")}
          accessibilityRole="button"
          accessibilityLabel={`Take a photo of ${whose} ID card`}
          className={`items-center rounded-xl border-[1.5px] border-dashed px-4 py-6 ${border}`}
        >
          <Icon name="camera" size={40} color={BLUE} />
          <Text className="mt-2.5 text-[16px] font-semibold text-white">Take a photo of {whose} ID card</Text>
          <Text className="mt-1 text-center text-[13px] text-white/65">
            Line up the front of {whose} card inside the frame.
          </Text>
          <Pressable onPress={() => pick("library")} hitSlop={8} className="mt-3 py-1">
            <Text className="text-[14px] font-medium" style={{ color: BLUE }}>
              Choose from my photos
            </Text>
          </Pressable>
        </Pressable>
        {value.phase === "denied" && (
          <View className="mt-2.5 rounded-lg border border-warn-tint bg-warn-tint px-3 py-2.5">
            <Text className="text-[13px] leading-[18px] text-white">
              {value.source === "camera"
                ? "TradeSura needs your camera to photograph your ID card."
                : "TradeSura needs access to your photos to choose your ID card."}
            </Text>
            <Pressable onPress={() => Linking.openSettings()} className="mt-2 self-start py-1">
              <Text className="text-[14px] font-semibold" style={{ color: BLUE }}>
                {value.source === "camera" ? "Allow camera in Settings" : "Allow photos in Settings"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const { photo } = value;

  if (value.phase === "preview") {
    return (
      <View className={`rounded-xl border p-3 ${border}`}>
        <Image source={{ uri: photo.uri }} className="w-full rounded-lg" style={{ aspectRatio: 1.586 }} resizeMode="cover" />
        <Text className="mt-2.5 text-[13px] text-white/80">
          Check your name, photo and number are clear.
        </Text>
        <View className="mt-3 flex-row gap-2.5">
          <Pressable
            onPress={() => pick("camera")}
            className="h-12 flex-1 items-center justify-center rounded-xl border border-white/40"
          >
            <Text className="text-[15px] font-semibold text-white">Retake</Text>
          </Pressable>
          <Pressable
            onPress={() => use(photo)}
            className="h-12 flex-1 items-center justify-center rounded-xl bg-white"
          >
            <Text className="text-[15px] font-bold text-on-light">Use this photo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={value.phase === "failed" ? () => use(photo) : undefined}
      disabled={value.phase !== "failed"}
      className={`flex-row items-center gap-3.5 rounded-xl border p-3 ${value.phase === "failed" ? "border-danger" : border}`}
    >
      <Image source={{ uri: photo.uri }} className="h-14 w-[88px] rounded-md" />
      <View className="flex-1">
        {value.phase === "uploading" && (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator color={BLUE} />
            <Text className="text-[14.5px] text-white">Uploading…</Text>
          </View>
        )}
        {value.phase === "failed" && (
          <Text className="text-[14px] leading-[19px] text-danger">Upload failed — tap to try again</Text>
        )}
        {value.phase === "added" && (
          <>
            <View className="flex-row items-center gap-1.5">
              <Icon name="check" size={15} color={BLUE} weight="bold" />
              <Text className="text-[15px] font-semibold text-white">ID card added</Text>
            </View>
            <Pressable onPress={() => pick("camera")} hitSlop={8} className="mt-1 self-start py-0.5">
              <Text className="text-[13px] font-medium" style={{ color: BLUE }}>
                Change
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </Pressable>
  );
}
