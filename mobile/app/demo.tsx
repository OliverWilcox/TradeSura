import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RingSpinner } from "@/components/skeleton";

// E5 — demo mode. In-app, full screen, with a slim hand-over ribbon and ✕ to
// exit — never the system browser, so the engineer's account stays hidden
// and return is one tap (review #16: was an expo-web-browser handoff with
// "close the browser to come back," which isn't actually one tap and briefly
// exposes the OS browser chrome). The page's ?demo=1 tags the resulting
// subscription channel=demo.
export default function Demo() {
  const { me } = useAuth();
  const [viewing, setViewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const base = process.env.EXPO_PUBLIC_API_URL;
  // Staff hand over their phone too — `by` credits the sale to them (section 8).
  const url = me && base ? `${base}/p/${me.slug}?demo=1${me.role === "staff" ? `&by=${me.id}` : ""}` : null;

  if (viewing && url) {
    return (
      <View className="flex-1 bg-bg">
        <SafeAreaView edges={["top"]} className="bg-bg-deep">
          <View className="flex-row items-center justify-between px-4 py-2.5">
            <Text className="flex-1 font-sans text-xs text-muted" numberOfLines={1}>
              Viewing {me?.tradingName ?? "your"} plan page — hand the phone over
            </Text>
            <Pressable
              onPress={() => router.replace("/")}
              hitSlop={10}
              className="ml-3 h-7 w-7 items-center justify-center rounded-full bg-line-soft"
            >
              <Icon name="close" size={14} weight="semibold" />
            </Pressable>
          </View>
        </SafeAreaView>
        {loading && (
          <View className="absolute inset-0 items-center justify-center bg-bg">
            <RingSpinner size={44} label="Loading your plan page" />
          </View>
        )}
        <WebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} className="flex-1" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Show a customer" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <Card>
          <Text className="font-semibold text-sm text-ink">
            Hand your phone over at the kitchen table
          </Text>
          <Text className="mt-1 font-sans text-xs text-muted">
            This opens your plan page, right here in the app. The customer picks a plan and sets
            up the Direct Debit on your phone — your account stays hidden. Tap ✕ any time to come
            straight back.
          </Text>
          {!me?.hasPlan && (
            <Text className="mt-2 font-sans text-xs text-warn">
              Build a plan first so there&apos;s something to show.
            </Text>
          )}
        </Card>

        <Button
          onPress={() => {
            setLoading(true);
            setViewing(true);
          }}
          disabled={!url || !me?.hasPlan}
        >
          Open my plan page
        </Button>
        <Micro className="text-center">
          Anything signed up here is tagged as an in-person sale.
        </Micro>
      </ScrollView>
    </View>
  );
}
