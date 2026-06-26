"use client";

import { MoreHorizontal } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type ActionMenuProps = {
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  triggerLabel?: string;
};

export function ActionMenu({
  children,
  className,
  panelClassName,
  triggerLabel = "Открыть меню действий",
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex cursor-pointer items-center rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.35)]",
            panelClassName,
            "max-w-[calc(100vw-2rem)]",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
