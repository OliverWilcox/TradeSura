import { Stack } from "expo-router";

// Part 3: the customer book's pushed pages (customer detail, CSV/contacts
// import, the offer campaign) stack inside the Customers tab.
export const unstable_settings = { initialRouteName: "customers" };

export default function CustomersStack() {
  return <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 220 }} />;
}
