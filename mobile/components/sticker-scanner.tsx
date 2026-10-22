import { useEffect, useRef, useState, type ComponentType } from "react";
import { View, Text, Modal, Pressable, TextInput, Linking, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icon";

type CameraViewProps = {
  style?: object;
  facing?: "back" | "front";
  barcodeScannerSettings?: { barcodeTypes: string[] };
  onBarcodeScanned?: (r: { data: string }) => void;
};
type CameraModule = {
  CameraView: ComponentType<CameraViewProps>;
  Camera: { requestCameraPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }> };
};

type Phase = "loading" | "scanning" | "denied" | "unavailable" | "typing";

// Section 4 — "Link sticker": scan the sticker's QR, with "Type the code
// instead" always one tap away. expo-camera is loaded lazily so an app
// binary built before it was added (no native camera module) falls back to
// typing instead of crashing on import.
export function StickerScanner({
  busy,
  error,
  onCode,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  /** Scanned QR data (the sticker URL) or a typed code. */
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [cam, setCam] = useState<CameraModule | null>(null);
  const [typed, setTyped] = useState("");
  const lastScan = useRef<string | null>(null);

  // Mounted fresh for each open (the parent renders it only while open), so
  // this runs once per scan session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = (await import("expo-camera")) as unknown as CameraModule;
        const perm = await mod.Camera.requestCameraPermissionsAsync();
        if (cancelled) return;
        setCam(mod);
        setPhase(perm.granted ? "scanning" : "denied");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed link lets the same sticker be scanned again.
  useEffect(() => {
    if (error) lastScan.current = null;
  }, [error]);

  function scanned(data: string) {
    if (busy || lastScan.current === data) return;
    lastScan.current = data;
    onCode(data);
  }

  const showCamera = phase === "scanning" && cam;
  const CameraView = cam?.CameraView;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-bg">
        <SafeAreaView edges={["top"]} className="flex-row items-center justify-between px-4 pb-2">
          <Text className="text-[17px] font-bold text-ink">Link sticker</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" className="p-2">
            <Icon name="close" size={20} />
          </Pressable>
        </SafeAreaView>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 gap-3 px-4 pb-8">
          {showCamera && CameraView ? (
            <View className="flex-1 overflow-hidden rounded-2xl border border-line-strong">
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={busy ? undefined : (r) => scanned(r.data)}
              />
            </View>
          ) : (
            <View className="flex-1 items-center justify-center gap-3 rounded-2xl border border-line bg-paper px-6">
              <Icon name="qr" size={40} color="#5FA3F0" />
              {phase === "loading" && <Text className="text-sm text-muted">Starting the camera…</Text>}
              {phase === "denied" && (
                <>
                  <Text className="text-center text-sm text-muted">
                    Camera access is off. Turn it on in Settings, or type the code instead.
                  </Text>
                  <Button variant="ghost" onPress={() => Linking.openSettings()}>
                    Open Settings
                  </Button>
                </>
              )}
              {phase === "unavailable" && (
                <Text className="text-center text-sm text-muted">
                  Scanning needs the latest version of the app. Type the code printed under the QR instead.
                </Text>
              )}
              {phase === "typing" && (
                <Text className="text-center text-sm text-muted">It&apos;s printed under the QR, like HX4K-7Q.</Text>
              )}
            </View>
          )}

          {showCamera && (
            <Text className="text-center text-sm text-muted">Point the camera at the sticker&apos;s QR code.</Text>
          )}

          {phase === "scanning" ? (
            <Button variant="ghost" onPress={() => setPhase("typing")}>
              Type the code instead
            </Button>
          ) : phase !== "loading" ? (
            <View className="gap-2">
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder="Sticker code, e.g. HX4K-7Q"
                placeholderTextColor="#6e86a3"
                autoCapitalize="characters"
                autoCorrect={false}
                className="rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[18px] tracking-widest text-ink"
              />
              <Button onPress={() => onCode(typed)} disabled={busy || typed.trim().length < 6}>
                {busy ? "Linking…" : "Link sticker"}
              </Button>
              {cam && phase === "typing" && (
                <Button variant="ghost" onPress={() => setPhase("scanning")}>
                  Scan instead
                </Button>
              )}
            </View>
          ) : null}

          {busy && phase === "scanning" && <Text className="text-center text-sm text-flame">Linking…</Text>}
          {error && <Text className="text-center text-[13px] text-danger">{error}</Text>}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
