import type React from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/70 bg-white/90 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.24)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
