// @vitest-environment jsdom

import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicRuntime } from "@/components/survey/public-runtime";
import type { SurveySchema } from "@/types/surveys";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

const baseTypography = {
  eyebrowFontSize: 12,
  titleFontSize: 28,
  descriptionFontSize: 16,
  answerFontSize: 16,
  additionalInfoDescriptionFontSize: 14,
};

let scrollToMock = vi.fn();
let scrollIntoViewMock = vi.fn();

function buildSchema(overrides?: Partial<SurveySchema>): SurveySchema {
  return {
    title: "Тестовый опрос",
    description: "",
    settings: {
      language: "ru",
      autoScrollEnabled: true,
      timerEnabled: false,
      timerSeconds: null,
      completionMessage: "",
      showProgressBar: false,
      scoringEnabled: false,
      showRestartButton: true,
      additionalInfoItems: [],
      typography: baseTypography,
      mobileTypography: baseTypography,
    },
    blocks: [
      {
        id: "block-1",
        type: "WELCOME",
        adminLabel: "Block 1",
        title: "Первый блок",
        description: "Описание первого блока",
        questionHint: "Подсказка для первого блока",
        required: false,
        nextBlockId: "block-2",
        showFinishButton: false,
        showRestartBlockButton: true,
        additionalInfoEnabled: true,
        additionalInfoItemIds: [],
        additionalInfoItems: [
          {
            id: "info-1",
            label: "Доп. информация",
            description: "Подробности для первого блока",
          },
        ],
        ctaLabel: "Продолжить",
      },
      {
        id: "block-2",
        type: "WELCOME",
        adminLabel: "Block 2",
        title: "Второй блок",
        description: "Описание второго блока",
        questionHint: "",
        required: false,
        nextBlockId: null,
        showFinishButton: false,
        showRestartBlockButton: false,
        additionalInfoEnabled: false,
        additionalInfoItemIds: [],
        additionalInfoItems: [],
        ctaLabel: "Продолжить",
      },
    ],
    ...overrides,
  };
}

function createResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000) {
  const started = Date.now();

  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
}

describe("PublicRuntime mobile interactions", () => {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const originalInnerWidth = window.innerWidth;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalScrollTo = window.scrollTo;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const originalVisualViewport = window.visualViewport;
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/responses/")) {
          if (method === "GET") {
            return createResponse({
              status: "IN_PROGRESS",
              session: { id: "session-1" },
              answers: [],
              lastBlockId: null,
            });
          }

          if (method === "POST") {
            return createResponse({
              answer: { nextBlockId: "block-2" },
            });
          }
        }

        return createResponse({ error: "Unexpected request" }, 500);
      }),
    );

    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    scrollToMock = vi.fn();
    scrollIntoViewMock = vi.fn();
    window.scrollTo = scrollToMock as typeof window.scrollTo;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as typeof HTMLElement.prototype.scrollIntoView;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const className = typeof this.className === "string" ? this.className : "";
      const text = this.textContent ?? "";

      if (className.includes("survey-runtime")) {
        return {
          bottom: 1600,
          height: 1600,
          left: 0,
          right: 375,
          top: 1000,
          width: 375,
          x: 0,
          y: 1000,
          toJSON() {
            return {};
          },
        };
      }

      if (className.includes("space-y-4") && (text.includes("Второй блок") || text.includes("Второй текстовый вопрос"))) {
        return {
          bottom: 1600,
          height: 1600,
          left: 0,
          right: 375,
          top: 1000,
          width: 375,
          x: 0,
          y: 1000,
          toJSON() {
            return {};
          },
        };
      }

      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      };
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    Object.defineProperty(window, "visualViewport", { value: originalVisualViewport, configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: originalUserAgent, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.scrollTo = originalScrollTo;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("toggles the hint tooltip on tap and closes it on the second tap", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const hintButton = container.querySelector('button[aria-label="Пояснение к вопросу"]') as HTMLButtonElement | null;
    expect(hintButton).not.toBeNull();

    await act(async () => {
      hintButton!.click();
      await Promise.resolve();
    });

    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    expect(tooltip!.className).toContain("block");

    await act(async () => {
      hintButton!.click();
      await Promise.resolve();
    });

    expect(tooltip!.className).toContain("hidden");

    root.unmount();
  });

  it("uses the shortened restart label in the public runtime", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Перезапуск");
    expect(container.textContent).not.toContain("Перезапустить");

    root.unmount();
  });

  it("renders structured mobile question title lines for filtration surveys only", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const structuredSchema = buildSchema({
      title: "Фильтрация ОКЦ и МПП",
      blocks: [
        {
          ...buildSchema().blocks[0]!,
          title: "Расскажите о вашем опыте в продажах или звонках: чем занимались, что продавали, кому, были ли холодные звонки?",
          description: "Опрос занимает около 8-10 минут. Отвечайте честно и конкретно: Нужны реальные примеры, цифры, KPI, CRM, график и обучение. Для наибольшей эффективности можно записывать ответы голосом 🎤",
        },
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: structuredSchema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const structuredTitle = container.querySelector("h1.sm\\:hidden") as HTMLHeadingElement | null;
    expect(structuredTitle).not.toBeNull();
    expect(structuredTitle!.className).toContain("text-left");
    expect(structuredTitle!.className).not.toContain("text-center");
    const lines = Array.from(structuredTitle!.querySelectorAll("span")).map((line) => line.textContent?.trim() ?? "");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]!.length).toBeGreaterThan(lines[1]!.length);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(24);
    expect(lines.some((line) => line.split(/\s+/).length === 1 && line.length <= 5)).toBe(false);
    expect(Array.from(structuredTitle!.querySelectorAll("span")).every((line) => line.className.includes("whitespace-normal"))).toBe(true);
    expect(lines).toEqual([
      "Расскажите о вашем опыте",
      "в продажах или звонках:",
      "чем занимались? что",
      "продавали кому? были ли",
      "холодные звонки?",
    ]);

    const structuredDescription = container.querySelector("p.survey-description-text.sm\\:hidden") as HTMLParagraphElement | null;
    expect(structuredDescription).not.toBeNull();
    expect(structuredDescription!.className).toContain("text-left");
    const descriptionLines = Array.from(structuredDescription!.querySelectorAll("span")).map((line) => line.textContent?.trim() ?? "");
    expect(descriptionLines.length).toBeGreaterThan(1);
    expect(descriptionLines[0]!.length).toBeGreaterThan(descriptionLines[1]!.length);
    expect(Math.max(...descriptionLines.map((line) => line.length))).toBeLessThanOrEqual(34);
    expect(descriptionLines.some((line) => line.split(/\s+/).length === 1 && line.length <= 5)).toBe(false);
    expect(descriptionLines).toEqual([
      "Опрос занимает около 8-10 минут.",
      "Отвечайте честно и конкретно:",
      "Нужны реальные примеры, цифры,",
      "KPI, CRM, график и обучение.",
      "Для наибольшей эффективности",
      "можно записывать ответы голосом 🎤",
    ]);

    root.unmount();
  });

  it("renders manual mobile-only block text without changing the desktop text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const baseBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      title: "Обычный опрос",
      blocks: [
        {
          ...baseBlock,
          title: "Десктопный заголовок без ручных переносов",
          description: "Десктопное описание без ручных переносов",
          questionHint: "Десктопная подсказка",
          mobileTextOverrides: {
            title: "Мобильный\nзаголовок",
            description: "Мобильное\nописание",
            questionHint: "Мобильная\nподсказка",
          },
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const mobileTitle = container.querySelector("h1.sm\\:hidden") as HTMLHeadingElement | null;
    const desktopTitle = container.querySelector("h1.hidden.sm\\:block") as HTMLHeadingElement | null;
    const mobileDescription = container.querySelector("p.survey-description-text.sm\\:hidden") as HTMLParagraphElement | null;
    const desktopDescription = container.querySelector("p.survey-description-text.hidden.sm\\:block") as HTMLParagraphElement | null;
    const tooltip = container.querySelector('[role="tooltip"]') as HTMLElement | null;

    expect(mobileTitle?.textContent).toBe("Мобильный\nзаголовок");
    expect(desktopTitle?.textContent).toBe("Десктопный заголовок без ручных переносов");
    expect(mobileDescription?.textContent).toBe("Мобильное\nописание");
    expect(desktopDescription?.textContent).toBe("Десктопное описание без ручных переносов");
    expect(tooltip?.textContent).toContain("Мобильная\nподсказка");
    expect(tooltip?.textContent).toContain("Десктопная подсказка");

    root.unmount();
  });

  it("uses exact mobile line overrides for selected OKC filtration questions", async () => {
    async function renderStructuredTextBlock({
      title,
      description,
    }: {
      title: string;
      description: string;
    }) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const baseBlock = buildSchema().blocks[0]!;
      const schema = buildSchema({
        title: "Фильтрация ОКЦ и МПП",
        blocks: [
          {
            ...baseBlock,
            id: "text-block",
            type: "TEXT",
            title,
            description,
            placeholder: "Ответьте конкретно: факты, примеры, цифры, если они есть.",
            multiline: true,
            minLength: 0,
            maxLength: 2000,
            allowVoiceAnswer: false,
            attachVoiceAnswerToResult: false,
            allowFileAnswer: false,
            nextBlockId: null,
          } as SurveySchema["blocks"][number],
        ],
      });

      await act(async () => {
        root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const titleLines = Array.from(container.querySelectorAll("h1.sm\\:hidden span")).map((line) => line.textContent?.trim() ?? "");
      const descriptionLines = Array.from(container.querySelectorAll("p.survey-description-text.sm\\:hidden span")).map((line) => line.textContent?.trim() ?? "");

      root.unmount();
      container.remove();

      return { titleLines, descriptionLines };
    }

    const q2 = await renderStructuredTextBlock({
      title: "Какие у вас были результаты: сколько звонков или встреч делали, какой план выполняли, какие продажи или показатели были в месяц?",
      description: "Нужны конкретные цифры или хотя бы реальные диапазоны: звонки в день, встречи, конверсия, выручка, выполнение плана.",
    });
    expect(q2.descriptionLines).toEqual([
      "Нужны конкретные цифры или",
      "хотя бы реальные диапазоны:",
      "звонки в день, встречи, конверсия;",
      "выручка, выполнение плана.",
    ]);

    const q4 = await renderStructuredTextBlock({
      title: "Насколько вам комфортно работать по фиксированному графику и с планом по звонкам и результатам? Как это было на прошлых местах работы?",
      description: "Расскажите про дисциплину, отчётность, CRM, соблюдение графика, отношение к плану и контролю.",
    });
    expect(q4.titleLines).toEqual([
      "Насколько вам комфортно",
      "работать по",
      "фиксированному",
      "графику и с планом",
      "по звонкам и результатам?",
      "Как это было на прошлых",
      "местах работы?",
    ]);

    const q7 = await renderStructuredTextBlock({
      title: "Какой доход в месяц вы хотите получать у нас через 3-6 месяцев при нормальной работе? Напишите примерно сумму или вилку.",
      description: "Укажите реалистичную сумму или диапазон и, если важно, условия, при которых рассчитываете на такой доход.",
    });
    expect(q7.titleLines).toEqual([
      "Какой доход в месяц вы",
      "хотите получать у нас",
      "через 3-6 месяцев при",
      "нормальной работе?",
      "Напишите примерно",
      "сумму или вилку.",
    ]);
  });

  it("uses exact mobile line overrides for selected assistant PM filtration questions", async () => {
    async function renderStructuredTextBlock({
      title,
      description,
    }: {
      title: string;
      description: string;
    }) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const baseBlock = buildSchema().blocks[0]!;
      const schema = buildSchema({
        title: "Фильтрация кандидата: ассистент руководителя / PM",
        blocks: [
          {
            ...baseBlock,
            id: "text-block",
            type: "TEXT",
            title,
            description,
            placeholder: "Ответьте конкретно: ситуация, ваши действия, результат.",
            multiline: true,
            minLength: 0,
            maxLength: 2000,
            allowVoiceAnswer: false,
            attachVoiceAnswerToResult: false,
            allowFileAnswer: false,
            nextBlockId: null,
          } as SurveySchema["blocks"][number],
        ],
      });

      await act(async () => {
        root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
        await Promise.resolve();
        await Promise.resolve();
      });

      const titleLines = Array.from(container.querySelectorAll("h1.sm\\:hidden span")).map((line) => line.textContent?.trim() ?? "");
      const descriptionLines = Array.from(container.querySelectorAll("p.survey-description-text.sm\\:hidden span")).map((line) => line.textContent?.trim() ?? "");

      root.unmount();
      container.remove();

      return { titleLines, descriptionLines };
    }

    const q1 = await renderStructuredTextBlock({
      title: "Расскажите о вашем опыте в роли ассистента руководителя, офис-менеджера, администратора, координатора, менеджера проектов или аккаунт-менеджера.",
      description: "Опишите, какие задачи выполняли регулярно, с кем взаимодействовали и за что отвечали лично вы.",
    });
    expect(q1.titleLines).toEqual([
      "Расскажите о вашем опыте",
      "в роли ассистента",
      "руководителя,",
      "офис-менеджера,",
      "администратора,",
      "координатора,",
      "менеджера проектов или",
      "аккаунт-менеджера.",
    ]);

    const q2 = await renderStructuredTextBlock({
      title: "Руководитель и клиенты ставят за день 10 задач по разным проектам, а физически можно успеть 5-6. Как вы будете действовать?",
      description: "Опишите, что вы сделаете первым делом, как выстроите приоритеты между задачами и проектами, как донесёте это до руководителя и при необходимости до клиента.",
    });
    expect(q2.descriptionLines).toEqual([
      "Опишите, что вы сделаете",
      "первым делом,",
      "как выстроите приоритеты",
      "между задачами и проектами,",
      "как донесёте это до руководителя",
      "и при необходимости до клиента.",
    ]);

    const q4 = await renderStructuredTextBlock({
      title: "Расскажите о ситуации, когда по вашей вине или при вашем участии что-то пошло не так.",
      description: "Например: ошибка в задаче, забытый дедлайн, сорванный процесс.",
    });
    expect(q4.titleLines).toEqual([
      "Расскажите о ситуации,",
      "когда по вашей вине",
      "или при вашем участии",
      "что-то пошло не так.",
    ]);

    const q10 = await renderStructuredTextBlock({
      title: "Какие личные качества и навыки больше всего помогают вам в роли ассистента или похожих ролях?",
      description: "Назовите 2-4 сильных качества и приведите короткие примеры. Затем назовите 1-2 зоны роста и что вы уже делаете или планируете делать для улучшения.",
    });
    expect(q10.descriptionLines).toEqual([
      "Назовите 2-4 сильных качества",
      "и приведите короткие примеры.",
      "Затем назовите 1-2 зоны роста и",
      "что вы уже делаете или планируете",
      "делать для улучшения.",
    ]);
  });

  it("does not render public block type labels", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Информативное");
    expect(container.textContent).not.toContain("Вопрос");

    root.unmount();
  });

  it("stops voice recording from the red square in the recording hint", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const trackStop = vi.fn();
    const stopRecording = vi.fn();
    const getUserMedia = vi.fn(async () => stream);

    const stream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      stream: MediaStream;
      state: RecordingState = "inactive";
      mimeType = "audio/webm";

      constructor(inputStream: MediaStream) {
        this.stream = inputStream;
      }

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        stopRecording();
      }
    }

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    await act(async () => {
      root.render(
        React.createElement(PublicRuntime, {
          surveyId: "survey-1",
          publicSlug: "survey-1",
          schema: buildSchema({
            blocks: [
              {
                id: "text-1",
                type: "TEXT",
                adminLabel: "Text",
                title: "Расскажите результат",
                description: "",
                questionHint: "",
                required: false,
                nextBlockId: null,
                showFinishButton: false,
                showRestartBlockButton: false,
                additionalInfoEnabled: false,
                additionalInfoItemIds: [],
                additionalInfoItems: [],
                placeholder: "Ответьте конкретно: факты, примеры, цифры, если они есть.",
                multiline: true,
                minLength: 0,
                maxLength: 2000,
                allowVoiceAnswer: true,
                attachVoiceAnswerToResult: true,
                allowFileAnswer: false,
              },
            ],
          }),
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const startButton = container.querySelector('button[aria-label="Записать голосом"]') as HTMLButtonElement | null;
    expect(startButton).not.toBeNull();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea!.placeholder).toBe("Ответьте конкретно:\nфакты, примеры, цифры,\nесли они есть.");
    expect(textarea!.className).toContain("min-h-[132px]");
    expect(textarea!.className).not.toContain("scrollbar-gutter");

    await act(async () => {
      startButton!.click();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    const hintStopButton = container.querySelector(
      'button[aria-label="Остановить запись в пояснении"]',
    ) as HTMLButtonElement | null;
    expect(hintStopButton).not.toBeNull();

    await act(async () => {
      hintStopButton!.click();
      await Promise.resolve();
    });

    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[aria-label="Остановить запись в пояснении"]')).toBeNull();

    root.unmount();
  });

  it("opens additional info as a mobile modal and closes it from the backdrop and X", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const infoButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Доп. информация")) as HTMLButtonElement | undefined;
    expect(infoButton).toBeDefined();

    await act(async () => {
      infoButton!.click();
      await Promise.resolve();
    });

    let dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Подробности для первого блока");

    const closeButton = dialog!.querySelector('button[aria-label="Закрыть дополнительную информацию"]') as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton!.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      infoButton!.click();
      await Promise.resolve();
    });

    dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();

    await act(async () => {
      dialog!.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    root.unmount();
  });

  it("scrolls to the active runtime top on mobile after advancing without scrollIntoView", async () => {
    const visualViewportAddEventListener = vi.fn();
    Object.defineProperty(window, "visualViewport", {
      value: {
        offsetTop: 48,
        addEventListener: visualViewportAddEventListener,
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Продолжить")) as HTMLButtonElement | undefined;
    expect(continueButton).toBeDefined();

    await act(async () => {
      continueButton!.click();
    });

    await waitForCondition(() => scrollToMock.mock.calls.length > 0);
    const lastCall = scrollToMock.mock.calls.at(-1) as [{ top: number; behavior: ScrollBehavior }] | undefined;
    expect(lastCall?.[0].behavior).toBe("auto");
    expect(lastCall?.[0].top).toBe(968);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(visualViewportAddEventListener).not.toHaveBeenCalled();
    const runtime = container.querySelector(".survey-runtime") as HTMLElement | null;
    expect(runtime?.style.getPropertyValue("--survey-mobile-browser-top-inset")).toBe("0px");

    root.unmount();
  });

  it("prefers the current question top over the outer runtime top on mobile after advancing", async () => {
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const className = typeof this.className === "string" ? this.className : "";
      const text = this.textContent ?? "";

      if (className.includes("survey-runtime")) {
        return {
          bottom: 1600,
          height: 1600,
          left: 0,
          right: 375,
          top: 1000,
          width: 375,
          x: 0,
          y: 1000,
          toJSON() {
            return {};
          },
        };
      }

      if (className.includes("space-y-4") && text.includes("Второй блок")) {
        return {
          bottom: 1800,
          height: 1600,
          left: 0,
          right: 375,
          top: 1200,
          width: 375,
          x: 0,
          y: 1200,
          toJSON() {
            return {};
          },
        };
      }

      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      };
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema: buildSchema() }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Продолжить")) as HTMLButtonElement | undefined;
    expect(continueButton).toBeDefined();

    await act(async () => {
      continueButton!.click();
    });

    await waitForCondition(() => scrollToMock.mock.calls.some((call) => call[0]?.top === 1168));
    expect(scrollToMock.mock.calls.some((call) => call[0]?.top === 968)).toBe(false);

    root.unmount();
  });

  it("does not add a Chrome iOS viewport inset after advancing from a text question", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    Object.defineProperty(window, "visualViewport", {
      value: {
        offsetTop: 96,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const baseBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      blocks: [
        {
          ...baseBlock,
          id: "block-1",
          type: "TEXT",
          title: "Первый текстовый вопрос",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: "block-2",
        } as SurveySchema["blocks"][number],
        {
          ...baseBlock,
          id: "block-2",
          type: "TEXT",
          title: "Второй текстовый вопрос",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await act(async () => {
      textarea!.focus();
      textarea!.value = "Текстовый ответ";
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Продолжить")) as HTMLButtonElement | undefined;
    expect(continueButton).toBeDefined();

    await act(async () => {
      continueButton!.click();
    });

    await waitForCondition(() => scrollToMock.mock.calls.length > 0);
    const runtime = container.querySelector(".survey-runtime") as HTMLElement | null;
    expect(runtime?.style.getPropertyValue("--survey-mobile-browser-top-inset")).toBe("0px");

    root.unmount();
  });

  it("does not add the Chrome iOS toolbar fallback before the first text question", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    Object.defineProperty(window, "visualViewport", {
      value: {
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const baseBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      blocks: [
        {
          ...baseBlock,
          id: "welcome",
          type: "WELCOME",
          title: "Анкета кандидата",
          ctaLabel: "Начать",
          nextBlockId: "text-1",
        } as SurveySchema["blocks"][number],
        {
          ...baseBlock,
          id: "text-1",
          type: "TEXT",
          title: "Расскажите о вашем опыте в продажах или звонках",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const startButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Начать")) as HTMLButtonElement | undefined;
    expect(startButton).toBeDefined();

    await act(async () => {
      startButton!.click();
    });

    await waitForCondition(() => scrollToMock.mock.calls.length > 0);
    expect(container.textContent).toContain("Расскажите о вашем опыте");
    const runtime = container.querySelector(".survey-runtime") as HTMLElement | null;
    expect(runtime?.style.getPropertyValue("--survey-mobile-browser-top-inset")).toBe("0px");

    root.unmount();
  });

  it("does not keep the Chrome iOS fallback inset after advancing from contact details", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    Object.defineProperty(window, "visualViewport", {
      value: {
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const contactBlock = buildSchema().blocks[0]!;
    const textBlock = buildSchema().blocks[1]!;
    const schema = buildSchema({
      blocks: [
        {
          ...contactBlock,
          id: "contact-1",
          type: "CONTACT",
          title: "Контактные данные",
          description: "",
          fields: [
            {
              id: "fullName",
              label: "Имя",
              placeholder: "Иван",
              required: true,
              enabled: true,
            },
          ],
          submitLabel: "Продолжить",
          nextBlockId: "block-2",
        } as SurveySchema["blocks"][number],
        {
          ...textBlock,
          id: "block-2",
          type: "TEXT",
          title: "Вопрос после контактов",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = container.querySelector('input[placeholder="Иван"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    await act(async () => {
      input!.focus();
      input!.value = "Иван";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Продолжить")) as HTMLButtonElement | undefined;
    expect(continueButton).toBeDefined();

    const scrollCallsBeforeSubmit = scrollToMock.mock.calls.length;

    await act(async () => {
      continueButton!.click();
    });

    await waitForCondition(
      () =>
        container.textContent?.includes("Вопрос после контактов") === true &&
        scrollToMock.mock.calls.length > scrollCallsBeforeSubmit,
    );
    const runtime = container.querySelector(".survey-runtime") as HTMLElement | null;
    expect(runtime?.style.getPropertyValue("--survey-mobile-browser-top-inset")).toBe("0px");

    root.unmount();
  });

  it("uses iPhone-safe font size for contact text fields to avoid browser zoom", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const contactBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      blocks: [
        {
          ...contactBlock,
          id: "contact-1",
          type: "CONTACT",
          title: "Контактные данные",
          description: "",
          fields: [
            {
              id: "fullName",
              label: "Имя",
              placeholder: "Иван",
              required: true,
              enabled: true,
            },
            {
              id: "phone",
              label: "Телефон",
              placeholder: "+7 999 000-00-00",
              required: true,
              enabled: true,
            },
          ],
          submitLabel: "Продолжить",
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const nameInput = container.querySelector('input[placeholder="Иван"]') as HTMLInputElement | null;
    const phoneInput = container.querySelector('input[type="tel"]') as HTMLInputElement | null;
    expect(nameInput?.className).toContain("text-[16px]");
    expect(phoneInput?.className).toContain("text-[16px]");
    expect(nameInput?.className).toContain("survey-ios-safe-input");
    expect(phoneInput?.className).toContain("survey-ios-safe-input");
    expect(container.querySelector("style")?.textContent).toContain(
      ".survey-runtime .survey-ios-safe-input",
    );
    expect(container.querySelector("style")?.textContent).toContain("max(16px, var(--survey-answer-font-size-mobile))");

    root.unmount();
  });

  it("scrolls to the top on mobile after advancing from a text question", async () => {
    let postActiveElementTag = "";
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/responses/")) {
          if (method === "GET") {
            return createResponse({
              status: "IN_PROGRESS",
              session: { id: "session-1" },
              answers: [],
              lastBlockId: null,
            });
          }

          if (method === "POST") {
            postActiveElementTag = document.activeElement?.tagName ?? "";
            return createResponse({
              answer: { nextBlockId: "block-2" },
            });
          }
        }

        return createResponse({ error: "Unexpected request" }, 500);
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const baseBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      blocks: [
        {
          ...baseBlock,
          id: "block-1",
          type: "TEXT",
          title: "Первый текстовый вопрос",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: "block-2",
        } as SurveySchema["blocks"][number],
        {
          ...baseBlock,
          id: "block-2",
          type: "TEXT",
          title: "Второй текстовый вопрос",
          description: "",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await act(async () => {
      textarea!.focus();
      textarea!.value = "Тестовый ответ";
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Продолжить")) as HTMLButtonElement | undefined;
    expect(continueButton).toBeDefined();

    const scrollCallsBeforeSubmit = scrollToMock.mock.calls.length;

    await act(async () => {
      continueButton!.click();
      await Promise.resolve();
    });

    await waitForCondition(
      () =>
        container.textContent?.includes("Второй текстовый вопрос") === true &&
        scrollToMock.mock.calls.slice(scrollCallsBeforeSubmit).some((call) => call[0]?.top === 968),
    );
    const lastCall = scrollToMock.mock.calls
      .slice(scrollCallsBeforeSubmit)
      .findLast((call) => call[0]?.top === 968) as [{ top: number; behavior: ScrollBehavior }] | undefined;
    expect(lastCall?.[0].behavior).toBe("auto");
    expect(lastCall?.[0].top).toBe(968);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    expect(postActiveElementTag).not.toBe("TEXTAREA");
    expect(container.textContent).toContain("Второй текстовый вопрос");
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1100)).toBe(true);

    const nextTextarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(nextTextarea).not.toBeNull();
    const clearTimeoutCallsBeforeFocus = clearTimeoutSpy.mock.calls.length;

    await act(async () => {
      nextTextarea!.focus();
      await Promise.resolve();
    });

    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearTimeoutCallsBeforeFocus);

    root.unmount();
  });

  it("orders the mobile timer before the question title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/responses/")) {
          if (method === "GET") {
            return createResponse({
              status: "IN_PROGRESS",
              session: { id: "session-1" },
              answers: [],
              lastBlockId: null,
              secondsLeft: 900,
              timerDeadlineAt: new Date(Date.now() + 900_000).toISOString(),
            });
          }

          if (method === "POST") {
            return createResponse({
              answer: { nextBlockId: "block-2" },
            });
          }
        }

        return createResponse({ error: "Unexpected request" }, 500);
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const baseBlock = buildSchema().blocks[0]!;
    const schema = buildSchema({
      settings: {
        ...buildSchema().settings,
        timerEnabled: true,
        timerSeconds: 900,
      },
      blocks: [
        {
          ...baseBlock,
          id: "block-1",
          type: "TEXT",
          title: "Вопрос с таймером",
          description: "Описание вопроса",
          placeholder: "Ответ",
          multiline: true,
          minLength: 0,
          maxLength: 2000,
          allowVoiceAnswer: false,
          attachVoiceAnswerToResult: false,
          allowFileAnswer: false,
          nextBlockId: null,
        } as SurveySchema["blocks"][number],
      ],
    });

    await act(async () => {
      root.render(React.createElement(PublicRuntime, { surveyId: "survey-1", publicSlug: "survey-1", schema }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const titleColumn = container.querySelector("h1")?.parentElement?.parentElement as HTMLElement | null;
    const timerBadge = Array.from(container.querySelectorAll("div")).find((element) => element.textContent?.trim() === "15:00") as HTMLElement | undefined;

    expect(titleColumn?.className).toContain("order-2");
    expect(timerBadge?.className).toContain("order-1");

    root.unmount();
  });
});
