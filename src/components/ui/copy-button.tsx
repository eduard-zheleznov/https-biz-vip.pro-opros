"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Копировать" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function copyText(value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch {
      // Fall back to a temporary textarea for non-secure HTTP contexts.
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  return (
    <Button
      variant="secondary"
      size="md"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await copyText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Скопировано" : label}
    </Button>
  );
}
