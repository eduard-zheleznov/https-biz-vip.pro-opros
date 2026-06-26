"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const LOGOUT_REDIRECT_PATH = "/login?loggedOut=1";

export default function LogoutPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function performLogout() {
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Не удалось завершить сессию.");
        }

        const payload = (await response.json()) as { redirectTo?: string };
        if (!cancelled) {
          window.location.replace(payload.redirectTo || LOGOUT_REDIRECT_PATH);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Не удалось завершить сессию.");
          setIsPending(false);
        }
      }
    }

    performLogout();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-5 py-10 sm:px-8">
      <Card className="w-full border-slate-200 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Выход</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">
          {isPending ? "Завершаем сессию..." : "Не удалось выйти автоматически"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          {error || "Сейчас вы будете перенаправлены на страницу входа."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {!isPending ? (
            <Button onClick={() => window.location.reload()}>
              Повторить
            </Button>
          ) : null}
          <Button variant="secondary" asChild>
            <Link href={LOGOUT_REDIRECT_PATH}>Перейти ко входу</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
