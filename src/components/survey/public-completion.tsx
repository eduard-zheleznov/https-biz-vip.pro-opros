"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { withBasePath } from "@/lib/base-path";
import type { PublicCompletionState } from "@/types/public-completion";

function getToneClasses(state: PublicCompletionState) {
  if (state.phase === "processing") {
    return {
      shell: "border-sky-100 bg-sky-50/70 text-sky-950",
      ring: "border-sky-200 border-t-sky-600",
      badge: "bg-sky-100 text-sky-800",
      badgeText: "Обработка",
    };
  }

  return {
    shell: "border-slate-200 bg-white text-slate-950",
    ring: "border-slate-200 border-t-slate-500",
    badge: "",
    badgeText: "",
  };
}

export function PublicCompletion({
  initialState,
  surveyId,
}: {
  initialState: PublicCompletionState;
  surveyId: string;
}) {
  const [state, setState] = useState(initialState);
  const tone = getToneClasses(state);
  const messengerLinks = state.phase === "final" ? (state.messengerLinks ?? []) : [];

  useEffect(() => {
    if (!state.shouldPoll) {
      return;
    }

    let cancelled = false;
    const loadState = async () => {
      try {
        const response = await fetch(withBasePath(`/api/responses/${surveyId}/completion`), {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as PublicCompletionState;
        if (!cancelled) {
          setState(nextState);
        }
      } catch {
        // Keep the processing screen visible; the next interval will retry.
      }
    };

    const timer = window.setInterval(loadState, 2000);
    void loadState();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.shouldPoll, surveyId]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-start px-5 pb-8 pt-7 sm:items-center sm:px-8 sm:py-8">
      <Card className={`w-full overflow-hidden border p-0 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)] ${tone.shell}`}>
        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
            <div className={`h-12 w-12 rounded-full border-4 ${state.phase === "processing" ? "animate-spin" : ""} ${tone.ring}`} />
          </div>
          {state.phase === "processing" ? (
            <div className={`mt-7 inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${tone.badge}`}>
              {tone.badgeText}
            </div>
          ) : null}
          <h1 className="mx-auto mt-5 max-w-2xl whitespace-pre-line text-[clamp(1.7rem,7vw,2.6rem)] font-semibold leading-tight tracking-tight">
            {state.title}
          </h1>
          {state.message ? (
            <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line text-base leading-7 text-current/75 sm:text-lg">
              {state.message}
            </p>
          ) : null}
          {messengerLinks.length ? (
            <div className="mx-auto mt-7 grid max-w-md gap-3 sm:grid-cols-3">
              {messengerLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-sky-200 hover:text-sky-700 hover:shadow-[0_16px_36px_rgba(14,165,233,0.16)]"
                >
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
          {state.phase === "processing" ? (
            <div className="mx-auto mt-8 grid max-w-xs grid-cols-3 gap-2" aria-hidden="true">
              <span className="h-2 rounded-full bg-current/20 animate-pulse" />
              <span className="h-2 rounded-full bg-current/30 animate-pulse [animation-delay:150ms]" />
              <span className="h-2 rounded-full bg-current/20 animate-pulse [animation-delay:300ms]" />
            </div>
          ) : state.showRestartButton ? (
            <div className="mt-8">
              <Button asChild variant="secondary">
                <a href={withBasePath(state.restartHref)}>Пройти снова</a>
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
