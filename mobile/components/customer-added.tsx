import { View, Text, ScrollView } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { offerLock } from "@/lib/offer-lock";
import { useSetupExit } from "@/lib/setup-exit";
import { AppHeader, Button, Card, ScreenTitle, SectionHeading } from "@/components/ui";
import { Icon } from "@/components/icon";

// Review 4 — "Test is in your book" was a bare line of text. The app's
// design: a heading, what happens next, and a way back (to the hub while
// setup is under way).
export function CustomerAdded({ firstName, onAnother }: { firstName: string; onAnother: () => void }) {
  const { me } = useAuth();
  const { exit, inSetup } = useSetupExit();
  const lock = offerLock(me);
  const name = firstName.trim() || "Your customer";
  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <AppHeader title="Customer added" onBack={() => exit(() => router.replace("/(tabs)/(customers)/customers"))} />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-flame-tint">
          <Icon name="check" size={26} color="#5FA3F0" />
        </View>
        <ScreenTitle title={`${name} is in your book`} intro="Saved to Customers. Nobody has been contacted." />
        <Card className="gap-1.5">
          <SectionHeading className="mb-1">What happens next</SectionHeading>
          <Text className="text-[14px] leading-[20px] text-ink">
            {lock
              ? `Offers: ${lock.reason} Then you can offer ${name} a plan from Customers.`
              : `Offer ${name} a plan whenever you're ready — at the end of a job, or with a text from you.`}
          </Text>
        </Card>
        <Button onPress={onAnother}>Add another customer</Button>
        {inSetup ? (
          <Button variant="ghost" onPress={() => exit()}>
            Back to setup
          </Button>
        ) : (
          <Button variant="ghost" onPress={() => router.replace("/(tabs)/(customers)/customers")}>
            Back to Customers
          </Button>
        )}
      </ScrollView>
    </View>
  );
}
