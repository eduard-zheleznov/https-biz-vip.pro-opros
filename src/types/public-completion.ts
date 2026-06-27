import type { AiResultColor } from "@/lib/results";

export type PublicCompletionState = {
  phase: "processing" | "final";
  shouldPoll: boolean;
  routingEnabled: boolean;
  color: AiResultColor | null;
  title: string;
  message: string;
  showRestartButton: boolean;
  restartHref: string;
};
