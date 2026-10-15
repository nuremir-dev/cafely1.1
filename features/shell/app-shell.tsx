"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { LogoutButton } from "@/features/auth/components/logout-button";
import type { Session } from "@/features/auth/types";
import { getPrinterSettings, getQzPrinters } from "@/features/printing/qz-client";
import { PrintStation } from "@/features/printing/components/print-station";

type NavigationItem = { href: string; label: string; icon: "sale" | "history" | "reports" | "shifts" | "menu" | "tables" };

const navigation: NavigationItem[] = [
  { href: "/pos", label: "Продажа", icon: "sale" },
  { href: "/history", label: "История", icon: "history" },
  { href: "/reports", label: "Отчёты", icon: "reports" },
  { href: "/shifts", label: "Смена", icon: "shifts" },
];

export function AppShell({ children, session }: { children: ReactNode; session: Session }) {
  const pathname = usePathname();
  const [now, setNow] = useState(() => new Date());
  const [printerState, setPrinterState] = useState<"checking" | "ready" | "unavailable">("checking");
  const [printerSettings] = useState<{ customerPrinter: string; kitchenPrinter: string } | null>(() => typeof window === "undefined" ? null : getPrinterSettings());
  const links = session.role === "admin" ? [...navigation, { href: "/admin/menu", label: "Меню", icon: "menu" as const }, { href: "/admin/tables", label: "Столы", icon: "tables" as const }] : navigation;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void getQzPrinters()
      .then(() => { if (active) setPrinterState("ready"); })
      .catch(() => { if (active) setPrinterState("unavailable"); });
    return () => { active = false; };
  }, []);

  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", weekday: "short", timeZone: "Asia/Bishkek" }).format(now).replace(".", "");
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bishkek" }).format(now);
  const printerLabel = printerState === "checking"
    ? "Проверяем принтеры"
    : printerState === "ready"
      ? [printerSettings?.customerPrinter, printerSettings?.kitchenPrinter].filter(Boolean).length > 0 ? "Принтеры готовы" : "QZ Tray подключён"
      : "QZ Tray недоступен";

  return (
    <div className="min-h-screen bg-[#edf2f0] text-slate-900">
      <PrintStation />
      <div className="fixed inset-0 -z-10 bg-[url('/images/cafe-login-background.png')] bg-cover bg-center opacity-[0.14]" />
      <div className="mx-auto min-h-screen max-w-[1600px] px-3 py-3 sm:px-5 sm:py-5">
        {pathname !== "/pos" && <header className="flex min-h-[5.25rem] items-center gap-3 rounded-[1.7rem] border border-white/80 bg-white/90 px-4 shadow-[0_10px_34px_rgba(56,72,65,0.1)] backdrop-blur-xl sm:px-7">
          <Link href="/pos" className="flex shrink-0 items-center gap-2.5" aria-label="CafeLine, перейти к продаже">
            <span className="grid size-11 place-items-center rounded-2xl bg-[#e4f5f1] text-primary-strong"><CoffeeIcon className="size-7" /></span>
            <span className="hidden text-[1.55rem] font-bold tracking-[-0.045em] text-slate-950 sm:block">Cafely</span>
          </Link>
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <div className="hidden items-center gap-2 text-sm font-semibold text-slate-700 md:flex"><UserIcon className="size-5 text-slate-400" />{session.cashierName}</div>
          <div className="ml-auto flex items-center gap-3 sm:gap-5">
            <div className="hidden items-center gap-2 border-r border-slate-200 pr-5 lg:flex" title={printerLabel}>
              <PrinterIcon className="size-5 text-slate-400" />
              <span className={`size-2 rounded-full ${printerState === "ready" ? "bg-emerald-500" : printerState === "checking" ? "bg-amber-400" : "bg-red-400"}`} />
              <span className="text-xs font-medium text-slate-500">{printerLabel}</span>
            </div>
            <div className="text-right leading-tight"><p className="text-lg font-bold tracking-tight text-slate-900" suppressHydrationWarning>{time}</p><p className="hidden text-xs text-slate-500 sm:block" suppressHydrationWarning>{date}</p></div>
            <div className="hidden sm:block"><LogoutButton /></div>
          </div>
        </header>}

        <div className={`${pathname === "/pos" ? "" : "mt-3 sm:mt-5"} flex gap-3 sm:gap-5`}>
          <aside className={`hidden shrink-0 rounded-[1.7rem] border border-white/80 bg-white/90 shadow-[0_10px_34px_rgba(56,72,65,0.08)] backdrop-blur-xl lg:block ${pathname === "/pos" ? "w-[4.5rem] p-2" : "w-[12.2rem] p-3"}`}>
            <nav className="space-y-1.5" aria-label="Основная навигация">
              {links.map((link) => <NavigationLink key={link.href} link={link} active={pathname === link.href} compact={pathname === "/pos"} />)}
            </nav>
            {pathname !== "/pos" && <div className="mt-5 border-t border-slate-100 pt-4"><p className="px-3 text-xs text-slate-400">Статус печати</p><p className={`mt-2 flex items-center gap-2 px-3 text-xs font-medium ${printerState === "unavailable" ? "text-red-500" : "text-slate-500"}`}><span className={`size-2 rounded-full ${printerState === "ready" ? "bg-emerald-500" : printerState === "checking" ? "bg-amber-400" : "bg-red-400"}`} />{printerLabel}</p></div>}
          </aside>
          <nav className="fixed inset-x-3 bottom-3 z-10 flex justify-around rounded-2xl border border-white/80 bg-white/95 p-2 shadow-xl backdrop-blur-xl lg:hidden" aria-label="Основная навигация">
            {links.map((link) => <MobileNavigationLink key={link.href} link={link} active={pathname === link.href} />)}
          </nav>
          <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
        </div>
      </div>
    </div>
  );
}

function NavigationLink({ active, compact, link }: { active: boolean; compact: boolean; link: NavigationItem }) {
  return <Link href={link.href} title={link.label} aria-label={link.label} className={`flex items-center rounded-xl py-3 text-sm font-semibold transition ${compact ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-[#e4f5f1] text-primary-strong shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}><ShellIcon name={link.icon} className="size-5" />{!compact && link.label}</Link>;
}

function MobileNavigationLink({ active, link }: { active: boolean; link: NavigationItem }) {
  return <Link href={link.href} className={`grid min-w-14 justify-items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold ${active ? "bg-[#e4f5f1] text-primary-strong" : "text-slate-500"}`}><ShellIcon name={link.icon} className="size-5" />{link.label}</Link>;
}

function ShellIcon({ className, name }: { className?: string; name: NavigationItem["icon"] }) {
  const paths = {
    sale: <><path d="M3 4h2l2.2 10.2A2 2 0 0 0 9.2 16H17a2 2 0 0 0 1.9-1.4L20 10H7" /><circle cx="10" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></>,
    history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
    reports: <><path d="M4 20V11M10 20V4M16 20v-7M22 20V8" /></>,
    shifts: <><path d="M12 2v10" /><path d="M6.2 5.7a8 8 0 1 0 11.6 0" /></>,
    menu: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    tables: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16M3 12h18" /></>,
  };
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CoffeeIcon({ className }: { className?: string }) { return <svg viewBox="0 0 48 48" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 20h26v5a13 13 0 0 1-26 0v-5Z" /><path d="M35 23h3a5 5 0 0 1 0 10h-4" /><path d="M7 39h31" /><path d="M18 13c-3-3 2-5 0-8M26 13c-3-3 2-5 0-8" /></svg>; }
function UserIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>; }
function PrinterIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>; }
