import type { ReactNode } from "react";

import { requirePageSession } from "@/features/auth/guards";
import { AppShell } from "@/features/shell/app-shell";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await requirePageSession();
  return <AppShell session={session}>{children}</AppShell>;
}
