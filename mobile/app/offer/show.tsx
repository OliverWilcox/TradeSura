import { createElement, useState } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiUrl } from "@/lib/api";
import { RingSpinner } from "@/components/skeleton";

// 30 Oct update §6 — "Show them now", the main way to offer: the installer
// hands the phone over and the customer joins on a page written for why the
// installer was there. In-app, full screen (never the system browser, as in
// demo mode). No customer-mode lock (§6.8). When they're done — joined or
// "not today" — the installer asks for a review.
export default function ShowThemNow() {
  const { token, path } = useLocalSearchParams<{ token: string; path: string }>();
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const url = path ? apiUrl(path) : null;

  const next = () => router.replace({ pathname: "/offer/review", params: { token } });

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="bg-bg-deep">
        <View className="flex-row items-center justify-between gap-3 px-4 py-2.5">
          <Text className="flex-1 font-sans text-xs text-muted" numberOfLines={2}>
            {joined ? "They've joined. Take the phone back to ask for a review." : "Hand the phone over: they pick a plan and join here."}
          </Text>
          <Pressable
            onPress={next}
            accessibilityRole="button"
            className={`rounded-full px-3.5 py-2 ${joined ? "bg-white" : "bg-line-soft"}`}
          >
            <Text className={`font-semibold text-[13px] ${joined ? "text-iron" : "text-ink"}`}>
              {joined ? "Next: review" : "Finished"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
      {url &&
        (Platform.OS === "web" ? (
          // Web is a dev preview only; react-native-webview has no web build.
          createElement("iframe", {
            src: url,
            title: "Your plan page",
            onLoad: () => setLoading(false),
            style: { flex: 1, border: 0, width: "100%", height: "100%" },
          })
        ) : (
          <WebView
            source={{ uri: url }}
            onLoadEnd={() => setLoading(false)}
            // The sign-up's last page is …/signup/{token}/confirmed.
            onNavigationStateChange={(s) => {
              if (/\/confirmed(\?|$)/.test(s.url)) setJoined(true);
            }}
            className="flex-1"
          />
        ))}
      {loading && (
        <View className="absolute inset-0 top-24 items-center justify-center bg-bg" pointerEvents="none">
          <RingSpinner size={44} label="Loading your plan page" />
        </View>
      )}
    </View>
  );
}
