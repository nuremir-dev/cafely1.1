import { redirect } from "next/navigation";

import { PinLoginForm } from "@/features/auth/components/pin-login-form";
import { getSession } from "@/features/auth/session";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/pos");

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <p className="text-2xl font-bold tracking-tight text-primary-strong">CafeLine</p>
        <h1 className="mt-6 text-2xl font-bold">Введите PIN-код</h1>
        <p className="mt-2 text-sm text-slate-600">Используйте цифровую клавиатуру или клавиши на компьютере.</p>
        <div className="mt-8"><PinLoginForm /></div>
      </div>
    </main>
  );
}
