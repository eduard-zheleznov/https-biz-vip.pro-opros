// @vitest-environment jsdom

import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { PublicCompletion } from "@/components/survey/public-completion";
import type { PublicCompletionState } from "@/types/public-completion";

describe("PublicCompletion", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not expose the internal AI color zone to respondents", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const state: PublicCompletionState = {
      phase: "final",
      shouldPoll: false,
      routingEnabled: true,
      color: "GREEN",
      title: "Поздравляем",
      message: "Напишите руководителю.",
      showRestartButton: false,
      restartHref: "/s/test",
    };

    await act(async () => {
      root.render(React.createElement(PublicCompletion, { initialState: state, surveyId: "survey-1" }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Поздравляем");
    expect(container.textContent).not.toContain("Зелёная зона");
    expect(container.textContent).not.toContain("GREEN");
    expect(container.innerHTML).not.toContain("emerald");

    root.unmount();
  });
});
