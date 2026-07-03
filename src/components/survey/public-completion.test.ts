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
      messengerLinks: [],
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

  it("shows configured messenger buttons only on the final screen", async () => {
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
      messengerLinks: [
        { id: "max", label: "MAX", href: "https://max.ru/example" },
        { id: "telegram", label: "Telegram", href: "https://t.me/example" },
        { id: "whatsapp", label: "WhatsApp", href: "https://wa.me/79990000000" },
      ],
      showRestartButton: false,
      restartHref: "/s/test",
    };

    await act(async () => {
      root.render(React.createElement(PublicCompletion, { initialState: state, surveyId: "survey-1" }));
      await Promise.resolve();
    });

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["MAX", "Telegram", "WhatsApp"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://max.ru/example",
      "https://t.me/example",
      "https://wa.me/79990000000",
    ]);

    root.unmount();
  });

  it("keeps the processing card near the top on mobile instead of vertically centering it", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const state: PublicCompletionState = {
      phase: "processing",
      shouldPoll: false,
      routingEnabled: true,
      color: null,
      title: "Ваши ответы обрабатываются",
      message: "Подождите совсем чуть-чуть.",
      messengerLinks: [],
      showRestartButton: false,
      restartHref: "/s/test",
    };

    await act(async () => {
      root.render(React.createElement(PublicCompletion, { initialState: state, surveyId: "survey-1" }));
      await Promise.resolve();
    });

    const main = container.querySelector("main") as HTMLElement | null;
    expect(main?.className).toContain("items-start");
    expect(main?.className).not.toContain("items-center px-5 py-8");

    root.unmount();
  });
});
