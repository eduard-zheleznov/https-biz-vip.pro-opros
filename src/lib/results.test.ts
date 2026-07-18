import { describe, expect, it } from "vitest";

import {
  applySparseAiResultGuard,
  buildResultCopyText,
  calculateScorePercent,
  extractAiResultColor,
  extractSurveyAnalysisMaxScore,
  inferAiScoreSummary,
  normalizeAiResultColors,
  resolveAiCompletionContent,
  shouldSendTelegramForAiResult,
  shouldForceRedAiResultForSparseAnswers,
} from "@/lib/results";

describe("result score helpers", () => {
  it("extracts AI result colors from explicit fields, loose text and emoji markers", () => {
    expect(extractAiResultColor("ЦВЕТ: ЗЕЛЁНЫЙ\nПОЯСНЕНИЕ: сильный кандидат")).toBe("GREEN");
    expect(extractAiResultColor('{ "КАТЕГОРИЯ": "ЖЕЛТЫЙ", "ПОЯСНЕНИЕ": "есть сомнения" }')).toBe("YELLOW");
    expect(extractAiResultColor("Итоговая метка: красный. Не подходит по требованиям.")).toBe("RED");
    expect(extractAiResultColor("🟢 кандидат подходит")).toBe("GREEN");
    expect(extractAiResultColor("AI не вернул цвет")).toBeNull();
  });

  it("decides whether Telegram should be sent for configured AI result colors", () => {
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: false,
        allowedColors: [],
        color: null,
      }),
    ).toBe(true);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: false,
        allowedColors: ["GREEN"],
        color: "RED",
      }),
    ).toBe(false);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: false,
        allowedColors: ["GREEN"],
        color: "GREEN",
      }),
    ).toBe(true);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: true,
        allowedColors: ["GREEN"],
        color: "GREEN",
      }),
    ).toBe(true);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: true,
        allowedColors: ["GREEN"],
        color: "YELLOW",
      }),
    ).toBe(false);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: true,
        allowedColors: ["GREEN", "YELLOW"],
        color: "YELLOW",
      }),
    ).toBe(true);
    expect(
      shouldSendTelegramForAiResult({
        filterEnabled: true,
        allowedColors: ["GREEN", "YELLOW"],
        color: null,
      }),
    ).toBe(false);
  });

  it("normalizes configured AI result colors with a safe green fallback", () => {
    expect(normalizeAiResultColors(["green", "ЖЁЛТЫЙ", "invalid", "GREEN"])).toEqual(["GREEN", "YELLOW"]);
    expect(normalizeAiResultColors([], { fallbackToGreen: true })).toEqual(["GREEN"]);
    expect(normalizeAiResultColors([], { fallbackToGreen: false })).toEqual([]);
  });

  it("forces sparse timed-out AI answers into the red zone", () => {
    const sparseAnswers = [
      {
        blockId: "experience",
        blockType: "TEXT" as const,
        prompt: "Опыт",
        value: "Есть небольшой опыт переписок",
        score: 0,
      },
      {
        blockId: "results",
        blockType: "TEXT" as const,
        prompt: "Результаты",
        value: "Не отвечено (начислен средний балл)",
        score: 5,
      },
      {
        blockId: "discipline",
        blockType: "TEXT" as const,
        prompt: "Дисциплина",
        value: "Не отвечено (начислен средний балл)",
        score: 5,
      },
      {
        blockId: "crm",
        blockType: "TEXT" as const,
        prompt: "CRM",
        value: "Не отвечено (начислен средний балл)",
        score: 5,
      },
    ];

    expect(shouldForceRedAiResultForSparseAnswers(sparseAnswers)).toBe(true);

    const guarded = applySparseAiResultGuard({
      answers: sparseAnswers,
      aiNote: "ОЦЕНКА ИИ: 50/100\nКАТЕГОРИЯ: ЖЕЛТЫЙ\nЦВЕТ: ЖЕЛТЫЙ",
      aiResultColor: "YELLOW",
    });

    expect(guarded.changed).toBe(true);
    expect(guarded.aiResultColor).toBe("RED");
    expect(guarded.aiNote).toContain("КАТЕГОРИЯ: КРАСНЫЙ");
    expect(guarded.aiNote).toContain("Системная проверка полноты анкеты");
  });

  it("does not force red for meaningful completed AI answers", () => {
    expect(
      shouldForceRedAiResultForSparseAnswers([
        {
          blockId: "experience",
          blockType: "TEXT" as const,
          prompt: "Опыт",
          value: "Работал в B2B продажах три года, вел холодные звонки и CRM.",
          score: 0,
        },
        {
          blockId: "results",
          blockType: "TEXT" as const,
          prompt: "Результаты",
          value: "Делал 60 звонков в день, план закрывал на 90-110 процентов.",
          score: 0,
        },
        {
          blockId: "discipline",
          blockType: "TEXT" as const,
          prompt: "Дисциплина",
          value: "Работал по фиксированному графику, вел отчеты и ежедневный план.",
          score: 0,
        },
      ]),
    ).toBe(false);
  });

  it("resolves AI completion content for processing, colored and fallback states", () => {
    const copy = {
      processingTitle: "Обрабатываем",
      processingMessage: "Подождите",
      greenTitle: "Зелёный заголовок",
      greenMessage: "Зелёный текст",
      yellowTitle: "Жёлтый заголовок",
      yellowMessage: "Жёлтый текст",
      redTitle: "Красный заголовок",
      redMessage: "Красный текст",
      fallbackTitle: "Запасной заголовок",
      fallbackMessage: "Запасной текст",
    };

    expect(
      resolveAiCompletionContent({
        routingEnabled: false,
        aiStatus: "PENDING",
        color: null,
        defaultTitle: "Спасибо",
        copy,
      }),
    ).toEqual({
      phase: "final",
      shouldPoll: false,
      color: null,
      title: "Спасибо",
      message: "",
    });
    expect(
      resolveAiCompletionContent({
        routingEnabled: true,
        aiStatus: "PENDING",
        color: null,
        defaultTitle: "Спасибо",
        copy,
      }),
    ).toEqual({
      phase: "processing",
      shouldPoll: true,
      color: null,
      title: "Обрабатываем",
      message: "Подождите",
    });
    expect(
      resolveAiCompletionContent({
        routingEnabled: true,
        aiStatus: "SUCCESS",
        color: "GREEN",
        defaultTitle: "Спасибо",
        copy,
      }),
    ).toEqual({
      phase: "final",
      shouldPoll: false,
      color: "GREEN",
      title: "Зелёный заголовок",
      message: "Зелёный текст",
    });
    expect(
      resolveAiCompletionContent({
        routingEnabled: true,
        aiStatus: "FAILED",
        color: null,
        defaultTitle: "Спасибо",
        copy,
      }),
    ).toEqual({
      phase: "final",
      shouldPoll: false,
      color: null,
      title: "Запасной заголовок",
      message: "Запасной текст",
    });
  });

  it("uses full survey maximum for AI score percentages", () => {
    const note = "ОПЫТ: 7/10 Краткий комментарий: Есть опыт. ЦЕННОСТИ: 8/10 Краткий комментарий: Подходит.";

    expect(inferAiScoreSummary(note, 140)).toEqual({
      totalScore: 15,
      maxScore: 140,
      percent: 11,
    });
  });

  it("overrides incomplete explicit AI maximum with full survey maximum", () => {
    const note = "СУММАРНЫЙ БАЛЛ: 44 из 70\nИТОГОВЫЙ РЕЗУЛЬТАТ: 63";

    expect(inferAiScoreSummary(note, 140)).toEqual({
      totalScore: 44,
      maxScore: 140,
      percent: 31,
    });
  });

  it("parses decimal explicit AI scores with an override maximum", () => {
    expect(inferAiScoreSummary("ОЦЕНКА: 15.6 / 300", 52)).toEqual({
      totalScore: 15.6,
      maxScore: 52,
      percent: 30,
    });
  });

  it("caps displayed percentage at 100", () => {
    expect(calculateScorePercent(150, 140)).toBe(100);
  });

  it("keeps a visible non-zero percentage for positive scores below one percent", () => {
    expect(calculateScorePercent(2, 1000)).toBe(1);
    expect(calculateScorePercent(0, 1000)).toBe(0);
  });

  it("applies copy prompt overrides and hides scores when scoring is disabled", () => {
    const copyText = buildResultCopyText({
      surveyTitle: "Опрос",
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 0,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      completedAt: new Date("2026-05-20T00:01:00.000Z"),
      includeScore: false,
      includeAnswerScores: false,
      answerPromptOverrides: {
        visible: "Короткая подпись",
        hidden: "",
      },
      answers: [
        {
          blockId: "visible",
          blockType: "TEXT",
          prompt: "Обычный длинный вопрос",
          value: "Ответ",
          score: 0,
        },
        {
          blockId: "hidden",
          blockType: "TEXT",
          prompt: "Не передавать",
          value: "Скрытый ответ",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain("1. Короткая подпись: Ответ");
    expect(copyText).not.toContain("Не передавать");
    expect(copyText).not.toContain("Баллы:");
    expect(copyText).not.toContain("Результат: 0 баллов");
  });

  it("formats AI note compactly for Telegram and copying", () => {
    const copyText = buildResultCopyText({
      surveyTitle: "Для оператора",
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 0,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      includeScore: false,
      includeAnswerScores: false,
      aiNote: "Балл: 5/10\nКлиент готов начать в ближайшую неделю. ЦВЕТ:ЖЕЛТЫЙ",
      answerPromptOverrides: {
        service: "Вид услуги",
      },
      answers: [
        {
          blockId: "service",
          blockType: "SINGLE_CHOICE",
          prompt: "Здравствуйте! Меня зовут [Имя]. Верно?",
          value: "Создание",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain("Опрос: Для оператора");
    expect(copyText).toContain("Оценка ИИ: 5/10 (50%) 🟡");
    expect(copyText).toContain("Пояснение: 🟡 Клиент готов начать в ближайшую неделю.");
    expect(copyText).toContain("1. Вид услуги: Создание");
    expect(copyText).not.toContain("Итоговая сумма баллов");
    expect(copyText).not.toContain("ЦВЕТ");
  });

  it("preserves structured AI notes for Telegram and copying", () => {
    const aiNote = [
      "ОЦЕНКА ИИ: 89/100",
      "ПРОЦЕНТ: 89%",
      "КАТЕГОРИЯ: ЗЕЛЕНЫЙ",
      "КЛАССИФИКАЦИЯ: Сильный кандидат",
      "СРЕДНИЙ БАЛЛ: 8.9/10",
      "Вопрос 1: 9/10 - Релевантный опыт. Флаги: нет.",
      "СИЛЬНЫЕ СТОРОНЫ: опыт, конкретика.",
      "РИСКИ: уточнить график.",
      "РЕКОМЕНДАЦИЯ: Позвать на интервью.",
      "КОММЕНТАРИЙ: Кандидат подходит по ключевым критериям.",
      "ЦВЕТ: ЗЕЛЕНЫЙ",
    ].join("\n");

    const copyText = buildResultCopyText({
      surveyTitle: "Фильтрация АСС и ПМ",
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 0,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      includeScore: false,
      includeAnswerScores: false,
      aiNote,
      answers: [
        {
          blockId: "experience",
          blockType: "TEXT",
          prompt: "Опыт",
          value: "Есть опыт",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain(
      [
        "AI-анализ:",
        "ОЦЕНКА ИИ: 89/100",
        "ПРОЦЕНТ: 89%",
        "КАТЕГОРИЯ: ЗЕЛЕНЫЙ",
        "КЛАССИФИКАЦИЯ: Сильный кандидат",
        "СРЕДНИЙ БАЛЛ: 8.9/10",
        "",
        "Вопрос 1: 9/10 - Релевантный опыт. Флаги: нет.",
        "",
        "СИЛЬНЫЕ СТОРОНЫ: опыт, конкретика.",
        "",
        "РИСКИ: уточнить график.",
        "",
        "РЕКОМЕНДАЦИЯ: Позвать на интервью.",
        "",
        "КОММЕНТАРИЙ: Кандидат подходит по ключевым критериям.",
      ].join("\n"),
    );
    expect(copyText).toContain("Вопрос 1: 9/10 - Релевантный опыт. Флаги: нет.");
    expect(copyText).not.toContain("Пояснение:");
    expect(copyText).not.toContain("ЦВЕТ: ЗЕЛЕНЫЙ");
  });

  it("preserves an explicit AI 100-point scale when survey scoring is not shown", () => {
    const copyText = buildResultCopyText({
      surveyTitle: "Фильтрация ОКЦ и МПП",
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 59,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      includeScore: false,
      includeAnswerScores: false,
      aiNote:
        "ОЦЕНКА ИИ: 100/100\nКандидат демонстрирует сильный релевантный опыт. ЦВЕТ: ЗЕЛЕНЫЙ",
      answers: [
        {
          blockId: "experience",
          blockType: "TEXT",
          prompt: "Опыт",
          value: "Есть опыт",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain("Оценка ИИ: 100/100 (100%) 🟢");
    expect(copyText).not.toContain("100/59");
  });

  it("parses object-like AI notes with percent, category and explanation", () => {
    const copyText = buildResultCopyText({
      surveyTitle: "Для операторов",
      status: "COMPLETED",
      totalScore: 0,
      maxScore: 0,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      includeScore: false,
      includeAnswerScores: false,
      aiNote:
        '{ ПРОЦЕНТ: 81, ОЦЕНКА: "42.4/52", КАТЕГОРИЯ: "ЖЁЛТЫЙ", ПОЯСНЕНИЕ: "Клиент заинтересован, но результат не максимальный." }',
      answers: [
        {
          blockId: "budget",
          blockType: "TEXT",
          prompt: "Бюджет",
          value: "60 000",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain("Оценка ИИ: 42.4/52 (81%) 🟡");
    expect(copyText).toContain("Пояснение: 🟡 Клиент заинтересован, но результат не максимальный.");
    expect(copyText).toContain("1. Бюджет: 60 000");
    expect(copyText).not.toContain("ПРОЦЕНТ");
    expect(copyText).not.toContain("КАТЕГОРИЯ");
  });

  it("normalizes AI note score to the configured survey maximum", () => {
    const copyText = buildResultCopyText({
      surveyTitle: "Опрос",
      status: "COMPLETED",
      totalScore: 15.6,
      maxScore: 52,
      startedAt: new Date("2026-05-20T00:00:00.000Z"),
      includeScore: true,
      includeAnswerScores: false,
      aiNote: "ПРОЦЕНТ: 5\nОЦЕНКА: 15.6 / 300\nПОЯСНЕНИЕ: Результат не максимальный.",
      answers: [
        {
          blockId: "budget",
          blockType: "TEXT",
          prompt: "Бюджет",
          value: "60 000",
          score: 0,
        },
      ],
    });

    expect(copyText).toContain("Итоговая сумма баллов: 15.6 баллов из 52");
    expect(copyText).toContain("Итоговый результат: 30% из 100%");
    expect(copyText).toContain("Оценка ИИ: 15.6/52 (30%)");
    expect(copyText).not.toContain("15.6 / 300");
  });

  it("extracts analysis max score from the AI prompt", () => {
    expect(
      extractSurveyAnalysisMaxScore(
        "Оцени ответы. Максимум для итогового процента: 52 балла. Пиши кратко и по делу.",
      ),
    ).toBe(52);
    expect(extractSurveyAnalysisMaxScore("Оцени ответы. Не более 52 баллов. Пиши кратко и по делу.")).toBe(52);
    expect(extractSurveyAnalysisMaxScore("Оцени ответы. До 52 баллов включительно. Пиши кратко и по делу.")).toBe(52);
    expect(extractSurveyAnalysisMaxScore("Оцени ответы. 52 балла максимум. Пиши кратко и по делу.")).toBe(52);
  });
});
