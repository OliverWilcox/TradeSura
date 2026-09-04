import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

// E5 — demo mode. Opens the engineer's own public plan page in an in-app
// browser so a customer can sign up at the kitchen table on his phone. The
// page's ?demo=1 tags the resulting subscription channel=demo.
export default function Demo() {
  const { me } = useAuth();
  const [opened, setOpened] = useState(false);
  const base = process.env.EXPO_PUBLIC_API_URL;
  const url = me && base ? `${base}/p/${me.slug}?demo=1` : null;

  async function open() {
    if (!url) return;
    setOpened(true);
    await WebBrowser.openBrowserAsync(url, {
      // A slim presentation the engineer can hand over and take back.
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      showTitle: false,
      toolbarColor: "#14202E",
    });
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
            This opens your plan page. The customer picks a plan and sets up the Direct Debit
            right here on your phone — your account stays hidden. Close the browser to come back.
          </Text>
          {!me?.hasPlan && (
            <Text className="mt-2 font-sans text-xs text-warn">
              Build a plan first so there&apos;s something to show.
            </Text>
          )}
        </Card>

        <Button onPress={open} disabled={!url || !me?.hasPlan}>
          Open my plan page
        </Button>
        {opened && (
          <Button variant="ghost" onPress={() => router.replace("/(tabs)")}>
            Back to my dashboard
          </Button>
        )}
        <Micro className="text-center">
          Anything signed up here is tagged as an in-person sale.
        </Micro>
      </ScrollView>
    </View>
  );
}
