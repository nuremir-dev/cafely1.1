import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/features/auth/components/logout-button";
import type { Session } from "@/features/auth/types";

const navigation = [
  { href: "/pos", label: "Касса" },
  { href: "/history", label: "История" },
  { href: "/reports", label: "Отчёты" },
];

export function AppShell({ children, session }: { children: ReactNode; session: Session }) {
  const links = session.role === "admin"
    ? [...navigation, { href: "/admin/menu", label: "Меню" }]
    : navigation;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/pos" className="mr-2 text-xl font-bold tracking-tight text-primary-strong">
            CafeLine
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Основная навигация">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">
                {link.label}
              </Link>
            ))}
          </nav>
          <span className="hidden text-sm text-slate-600 sm:inline">{session.cashierName}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
