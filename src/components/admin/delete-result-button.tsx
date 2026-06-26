"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type DeleteResultButtonProps = {
  confirmMessage?: string;
};

export function DeleteResultButton({
  confirmMessage = "Удалить этот результат? Действие необратимо.",
}: DeleteResultButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
      Удалить результат
    </Button>
  );
}
