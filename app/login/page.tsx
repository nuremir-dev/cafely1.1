import { redirect } from "next/navigation";

import { PinLoginForm } from "@/features/auth/components/pin-login-form";
import { getSession } from "@/features/auth/session";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/pos");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#e7e3d9] px-4 py-6 sm:px-6 sm:py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/cafe-login-background.png')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-[#fffdf8]/35 backdrop-blur-[1px]" />

      <section className="relative w-full max-w-[31rem] rounded-[2rem] border border-white/80 bg-white/90 px-5 py-7 text-center shadow-[0_24px_70px_rgba(67,54,30,0.16)] backdrop-blur-xl sm:px-9 sm:py-9">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#e4f5f1] text-primary-strong shadow-sm">
          <svg viewBox="0 0 48 48" className="size-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 20h26v5a13 13 0 0 1-26 0v-5Z" />
            <path d="M35 23h3a5 5 0 0 1 0 10h-4" />
            <path d="M7 39h31" />
            <path d="M18 13c-3-3 2-5 0-8M26 13c-3-3 2-5 0-8" />
          </svg>
        </div>
        <p className="mt-3 text-[1.75rem] font-bold tracking-[-0.04em] text-slate-900">
          Cafely
        </p>
        <h1 className="mt-7 text-2xl font-bold tracking-[-0.035em] text-slate-900 sm:text-[1.75rem]">Введите PIN-код</h1>
        {/* <p className="mt-2 text-sm leading-5 text-slate-500">Используйте цифровую клавиатуру или клавиши на компьютере.</p> */}
        <div className="mt-7"><PinLoginForm /></div>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h6M16 13h1" /></svg>
          Можно вводить с клавиатуры
        </p>
      </section>
    </main>
  );
}
