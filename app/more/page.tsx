import { AppShell } from "@/components/shells";
import { ComingSoon } from "@/components/ui";

export default function MorePage() {
  return (
    <AppShell active="MORE">
      <ComingSoon title="Payouts, campaigns & more" />
    </AppShell>
  );
}
