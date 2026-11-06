import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button } from "@/components/ui";

// Matt, 6 Nov — the 60-second how-to: "How to offer a plan in 60 seconds"
// (the end-of-job script plus Show them now). Ticks off once watched. Matt
// is getting the video made; until its address is set it says so.
export default function VideoScreen() {
  const { me, refreshMe } = useAuth();
  const video = me?.grow?.howToVideo;
  const [busy, setBusy] = useState(false);

  async function watch() {
    if (!video?.url) return;
    setBusy(true);
    try {
      await WebBrowser.openBrowserAsync(video.url);
      // Back from the video: it counts as watched.
      await api("/api/grow/video", { method: "POST" }).catch(() => {});
      await refreshMe();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="60-second video" />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-3.5 px-4 pb-10 pt-4">
        <Card>
          <Text className="text-[17px] font-bold text-ink">How to offer a plan in 60 seconds</Text>
          <Text className="mt-1.5 text-[14px] leading-[20px] text-muted">
            What to say at the end of the job, then Show them now so they join on your phone before you pack up.
          </Text>
          {video?.watchedAt && <Text className="mt-2 text-[13px] font-semibold text-ink">Watched</Text>}
        </Card>
        {video?.url ? (
          <Button onPress={watch} disabled={busy}>
            {busy ? "Opening…" : video.watchedAt ? "Watch again" : "Watch the video"}
          </Button>
        ) : (
          <Card>
            <Text className="text-[14px] text-muted">The video is coming soon. We&apos;ll let you know when it&apos;s ready.</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
