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
    <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <div className="mb-8 flex justify-center gap-3" aria-label="Введённые цифры PIN-кода">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface-muted text-xl"
            aria-hidden="true"
          >
            {pin[index] ? "●" : ""}
          </span>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3" aria-label="Цифровая клавиатура">
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={isPending}
            onClick={() => appendDigit(digit)}
            className="h-14 rounded-xl border border-border bg-white text-xl font-semibold hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          disabled={isPending || pin.length === 0}
          onClick={() => setPin((current) => current.slice(0, -1))}
          className="h-14 rounded-xl border border-border bg-white text-sm font-medium hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
