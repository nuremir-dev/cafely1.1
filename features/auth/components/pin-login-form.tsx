"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

type ErrorBody = { error?: { message?: string } };

export function PinLoginForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function submit(value: string) {
    if (isPending || value.length !== 4) return;

    setIsPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(body?.error?.message ?? "Не удалось войти. Повторите попытку.");
        setPin("");
        return;
      }

      router.replace("/pos");
      router.refresh();
    } catch {
      setError("Нет связи с сервером. Проверьте подключение и повторите попытку.");
      setPin("");
    } finally {
      setIsPending(false);
    }
  }

  function appendDigit(digit: number) {
    if (isPending) return;
    setError(null);
    const nextPin = pin.length < 4 ? `${pin}${digit}` : pin;
    setPin(nextPin);
    if (nextPin.length === 4) void submit(nextPin);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key >= "0" && event.key <= "9") appendDigit(Number(event.key));
      if (event.key === "Backspace") {
        setError(null);
        setPin(pin.slice(0, -1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="w-full">
      <div className="mb-5 flex justify-center gap-2.5 sm:gap-3" aria-label="Введённые цифры PIN-кода">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="flex size-[3.65rem] items-center justify-center rounded-2xl border border-slate-200 bg-white/80 text-lg text-primary-strong shadow-[inset_0_1px_1px_rgba(15,23,42,0.02)] sm:size-16"
            aria-hidden="true"
          >
            {pin[index] ? "●" : <span className="size-2.5 rounded-full bg-slate-200" />}
          </span>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-3 text-sm font-medium text-red-600">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">!</span>
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3" aria-label="Цифровая клавиатура">
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={isPending}
            onClick={() => appendDigit(digit)}
            className={`h-14 rounded-2xl border border-slate-200 bg-white/80 text-2xl font-bold text-slate-900 shadow-[0_2px_7px_rgba(15,23,42,0.035)] transition hover:-translate-y-px hover:border-primary/35 hover:bg-[#f1fbf9] active:translate-y-0 active:bg-[#e4f5f1] disabled:cursor-not-allowed disabled:opacity-60 sm:h-[4.2rem] ${digit === 0 ? "col-span-2" : ""}`}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          disabled={isPending || pin.length === 0}
          onClick={() => setPin((current) => current.slice(0, -1))}
          aria-label="Удалить последнюю цифру"
          className="flex h-14 items-center justify-center rounded-2xl border border-primary/20 bg-[#e4f5f1] text-primary-strong transition hover:-translate-y-px hover:bg-[#d7f0eb] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 sm:h-[4.2rem]"
        >
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6H9l-5 6 5 6h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z" /><path d="m12 10 4 4m0-4-4 4" /></svg>
        </button>
      </div>
    </div>
  );
}
