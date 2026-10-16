import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Avatar, Card, Pill, RowLine, Button, Chevron } from "@/components/ui";

// Build Review 2, section 8 — a staff engineer's Account: who they are, which
// business they sign up for, their own Gas Safe check, support and sign out.
// No money, settings, payments, Team or Refer.
export function StaffAccount() {
  const { me, signOut } = useAuth();
  const verified = Boolean(me?.gasSafeVerifiedAt);
  const rejected = !verified && Boolean(me?.gasSafeRejectedAt);
  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Account" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
        <Card>
          <View className="flex-row items-center gap-3">
            <Avatar size={44} />
            <View className="flex-1">
              <Text className="font-bold text-base text-ink">
                {`${me?.firstName ?? ""} ${me?.lastName ?? ""}`.trim() || me?.email}
              </Text>
              <Text className="font-sans text-xs text-muted">Engineer at {me?.businessName}</Text>
            </View>
          </View>
        </Card>
        <Card>
          <RowLine
            left="Gas Safe"
            right={
              <Pill tone={verified ? "info" : rejected ? "off" : "warn"}>
                {verified ? "Verified" : rejected ? "Check failed" : "Check in progress"}
              </Pill>
            }
          />
          <RowLine left="Gas Safe number" right={me?.gasSafeNo ?? "—"} />
          <RowLine left="Email" right={me?.email ?? "—"} />
        </Card>
        <Card>
          <Pressable
            onPress={() =>
              Linking.openURL("https://wa.me/447700900000?text=" + encodeURIComponent("TradeSura support: "))
            }
          >
            <RowLine left="WhatsApp support" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => WebBrowser.openBrowserAsync(apiUrl("/terms")).catch(() => {})}>
            <RowLine left="Terms & privacy" right={<Chevron />} />
          </Pressable>
        </Card>
        <Button variant="ghost" onPress={signOut}>
          Sign out
        </Button>
        <Pressable onPress={() => router.push("/delete-account")} className="items-center py-2">
          <Text className="font-sans text-xs text-muted">Delete my account</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
