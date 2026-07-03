import type { AiResultColor } from "@/lib/results";

export type PublicCompletionMessengerLink = {
  id: "max" | "telegram" | "whatsapp";
  label: string;
  href: string;
};

export type PublicCompletionState = {
  phase: "processing" | "final";
  shouldPoll: boolean;
  routingEnabled: boolean;
  color: AiResultColor | null;
  title: string;
  message: string;
  messengerLinks: PublicCompletionMessengerLink[];
  showRestartButton: boolean;
  restartHref: string;
};
