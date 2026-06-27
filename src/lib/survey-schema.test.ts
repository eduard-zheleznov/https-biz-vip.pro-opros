import { describe, expect, it } from "vitest";

import {
  canAutoScrollBlock,
  calculateSurveyQuestionMaxScore,
  changeSurveyBlockType,
  coerceSurveyNavigationTargets,
  createBlock,
  createDefaultSurveySchema,
  duplicateSurveyBlock,
  evaluateAnswer,
  evaluateUnansweredAverageAnswer,
  FINISH_SURVEY_TARGET,
  getBlockAdditionalInfoItems,
  isBlockAnswered,
  isTextAnswerBelowMinimum,
  normalizeTextAnswerValue,
  normalizeSurveySchema,
  stringifyAnswerValue,
  validateSurveySchema,
} from "@/lib/survey-schema";

describe("survey schema engine", () => {
  it("evaluates score and branching for single choice", () => {
    const schema = createDefaultSurveySchema("Опрос");
    schema.settings.scoringEnabled = true;
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.options[0].score = 5;
    question.options[0].nextBlockId = null;

    const result = evaluateAnswer(schema, question, question.options[0].id);
    expect(result.score).toBe(5);
    expect(result.value).toBe(question.options[0].label);
  });

  it("keeps scoring disabled by default", () => {
    const schema = createDefaultSurveySchema("Score off");
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.options[0].score = 10;

    expect(schema.settings.scoringEnabled).toBe(false);
    expect(evaluateAnswer(schema, question, question.options[0].id).score).toBe(0);
  });

  it("awards half of a skipped question maximum for timed-out answers", () => {
    const schema = createDefaultSurveySchema("Timeout score");
    schema.settings.scoringEnabled = true;
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.options[0].score = 12;
    question.options[1].score = 4;

    const result = evaluateUnansweredAverageAnswer(schema, question);
    expect(result.score).toBe(6);
    expect(result.value).toBe("Не отвечено (начислен средний балл)");
  });

  it("does not award skipped-question points when scoring is disabled", () => {
    const schema = createDefaultSurveySchema("Timeout score disabled");
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.options[0].score = 12;

    expect(evaluateUnansweredAverageAnswer(schema, question).score).toBe(0);
  });

  it("changes block type and preserves shared content", () => {
    const block = createBlock("SINGLE_CHOICE", 2);

    if (block.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected block type.");
    }

    block.title = "Какой у вас опыт?";
    block.adminLabel = "Опыт кандидата";
    block.description = "Опишите кратко.";
    block.questionHint = "Можно учитывать коммерческий и личный опыт.";
    block.required = true;
    block.showFinishButton = true;
    block.showRestartBlockButton = true;
    block.additionalInfoEnabled = true;
    block.additionalInfoItems = [{ id: "info-1", label: "Подсказка", description: "Текст подсказки" }];

    const converted = changeSurveyBlockType(block, "TEXT", 2);

    expect(converted.type).toBe("TEXT");
    expect(converted.id).toBe(block.id);
    expect(converted.adminLabel).toBe(block.adminLabel);
    expect(converted.title).toBe(block.title);
    expect(converted.description).toBe(block.description);
    expect(converted.questionHint).toBe(block.questionHint);
    expect(converted.required).toBe(true);
    expect(converted.showFinishButton).toBe(true);
    expect(converted.showRestartBlockButton).toBe(true);
    expect(converted.additionalInfoItems).toEqual(block.additionalInfoItems);

    if (converted.type !== "TEXT") {
      throw new Error("Unexpected converted type.");
    }

    expect(converted.placeholder).toBe("Введите ответ");
    expect(converted.minLength).toBe(0);
  });

  it("flags self-loops in schema transitions", () => {
    const schema = createDefaultSurveySchema("Проверка");
    const question = schema.blocks[1];

    question.nextBlockId = question.id;

    expect(validateSurveySchema(schema)).toContain(`У блока "${question.title}" настроен переход на самого себя.`);
  });

  it("disables auto-scroll for ranking blocks", () => {
    const schema = createDefaultSurveySchema("Проверка");
    const ranking = {
      ...schema.blocks[1],
      id: "ranking-1",
      type: "RANKING" as const,
      items: [
        { id: "a", label: "A", description: "", score: 1, nextBlockId: null },
        { id: "b", label: "B", description: "", score: 1, nextBlockId: null },
      ],
    };

    expect(canAutoScrollBlock(ranking)).toBe(false);
  });

  it("disables auto-scroll for slider blocks", () => {
    const slider = createBlock("SLIDER", 2);

    if (slider.type !== "SLIDER") {
      throw new Error("Unexpected block type.");
    }

    expect(canAutoScrollBlock(slider)).toBe(false);
  });

  it("creates blocks with disabled additional info by default", () => {
    const block = createBlock("TEXT", 2);

    expect(block.additionalInfoEnabled).toBe(false);
    expect(block.additionalInfoItems).toEqual([]);
  });

  it("normalizes mobile-only text overrides without requiring a database migration", () => {
    const rawBlock = {
      ...createBlock("TEXT", 1),
      mobileTextOverrides: {
        title: "Мобильный\nзаголовок",
        description: " ",
        unknown: "ignored",
      },
      placeholder: "Ответ",
    } as ReturnType<typeof createBlock> & {
      mobileTextOverrides: Record<string, string>;
      placeholder: string;
    };

    const schema = normalizeSurveySchema({
      title: "Mobile text",
      description: "",
      settings: createDefaultSurveySchema("Mobile text").settings,
      blocks: [rawBlock],
    });

    expect((schema.blocks[0] as { mobileTextOverrides?: Record<string, string> } | undefined)?.mobileTextOverrides).toEqual({
      title: "Мобильный\nзаголовок",
    });
  });

  it("requires text answers to reach configured minimum length", () => {
    const text = createBlock("TEXT", 1);

    if (text.type !== "TEXT") {
      throw new Error("Unexpected block type.");
    }

    text.minLength = 5;

    expect(isBlockAnswered(text, "1234")).toBe(false);
    expect(isBlockAnswered(text, "12345")).toBe(true);
  });

  it("requires voice transcripts to reach minimum length but accepts file attachments", () => {
    const text = createBlock("TEXT", 1);

    if (text.type !== "TEXT") {
      throw new Error("Unexpected block type.");
    }

    text.minLength = 10;
    text.allowVoiceAnswer = true;
    text.allowFileAnswer = true;
    const voiceAttachment = {
      id: "asset-1",
      url: "/api/media/asset-1",
      originalName: "voice.webm",
      filename: "voice.webm",
      mimeType: "audio/webm",
      byteSize: 12000,
      kind: "voice" as const,
    };
    const fileAttachment = {
      id: "asset-2",
      url: "/api/media/asset-2",
      originalName: "file.pdf",
      filename: "file.pdf",
      mimeType: "application/pdf",
      byteSize: 12000,
      kind: "file" as const,
    };

    expect(normalizeTextAnswerValue({ text: "", attachments: [voiceAttachment] }).attachments).toHaveLength(1);
    expect(isBlockAnswered(text, { text: "", attachments: [voiceAttachment] })).toBe(false);
    expect(isTextAnswerBelowMinimum(text, { text: "123", attachments: [voiceAttachment] })).toBe(true);
    expect(isBlockAnswered(text, { text: "1234567890", attachments: [voiceAttachment] })).toBe(true);
    expect(isBlockAnswered(text, { text: "", attachments: [fileAttachment] })).toBe(true);
    expect(isTextAnswerBelowMinimum(text, { text: "123", attachments: [fileAttachment] })).toBe(false);
  });

  it("formats contact answers with Russian labels", () => {
    expect(
      stringifyAnswerValue(
        {
          fullName: "Иван",
          email: "ivan@example.com",
          phoneCountry: "Беларусь +375",
          phone: "11 111 11 11",
          phoneMessengers: ["Telegram", "WhatsApp"],
        },
        "CONTACT",
      ),
    ).toBe("Имя: Иван; Электронная почта: ivan@example.com; Телефон: +375 11 111 11 11; Мессенджеры: Telegram, WhatsApp");
  });

  it("counts result maximum by all question blocks, excluding welcome and contacts", () => {
    const welcome = createBlock("WELCOME", 1);
    const contact = createBlock("CONTACT", 2);
    const text = createBlock("TEXT", 3);
    const single = createBlock("SINGLE_CHOICE", 4);
    const rating = createBlock("RATING", 5);

    const schema = {
      title: "Score base",
      description: "",
      settings: createDefaultSurveySchema("Score base").settings,
      blocks: [welcome, contact, text, single, rating],
    };

    expect(calculateSurveyQuestionMaxScore(schema)).toBe(30);
  });

  it("coerces AI-style transition aliases before validation", () => {
    const welcome = createBlock("WELCOME", 1);
    const single = createBlock("SINGLE_CHOICE", 2);
    const text = createBlock("TEXT", 3);

    if (single.type !== "SINGLE_CHOICE" || text.type !== "TEXT") {
      throw new Error("Unexpected block types.");
    }

    single.nextBlockId = "следующий вопрос";
    text.adminLabel = "Финальный текст";
    single.options[0].nextBlockId = text.title;

    const schema = coerceSurveyNavigationTargets({
      title: "AI draft",
      description: "",
      settings: createDefaultSurveySchema("AI draft").settings,
      blocks: [welcome, single, text],
    });

    expect(schema.blocks[1]?.nextBlockId).toBe(text.id);
    expect(schema.blocks[1]?.type === "SINGLE_CHOICE" ? schema.blocks[1].options[0]?.nextBlockId : null).toBe(text.id);
    expect(validateSurveySchema(schema)).toEqual([]);
  });

  it("uses admin labels as navigation aliases", () => {
    const first = createBlock("SINGLE_CHOICE", 1);
    const second = createBlock("TEXT", 2);

    first.nextBlockId = "Ответ текстом";
    second.adminLabel = "Ответ текстом";

    const schema = coerceSurveyNavigationTargets({
      title: "Admin labels",
      description: "",
      settings: createDefaultSurveySchema("Admin labels").settings,
      blocks: [first, second],
    });

    expect(schema.blocks[0]?.nextBlockId).toBe(second.id);
  });

  it("routes combined free-text answers by text target", () => {
    const combined = createBlock("COMBINED", 1);
    const textTarget = createBlock("TEXT", 2);
    const fallbackTarget = createBlock("TEXT", 3);

    if (combined.type !== "COMBINED") {
      throw new Error("Unexpected block type.");
    }

    combined.textNextBlockId = textTarget.id;
    combined.nextBlockId = fallbackTarget.id;

    const result = evaluateAnswer(
      {
        title: "Combined routing",
        description: "",
        settings: createDefaultSurveySchema("Combined routing").settings,
        blocks: [combined, textTarget, fallbackTarget],
      },
      combined,
      { selectedValue: undefined, text: "Свободный ответ" },
    );

    expect(result.nextBlockId).toBe(textTarget.id);
  });

  it("keeps combined selected-answer routing separate from free-text routing", () => {
    const combined = createBlock("COMBINED", 1);
    const selectedTarget = createBlock("TEXT", 2);
    const textTarget = createBlock("TEXT", 3);

    if (combined.type !== "COMBINED" || combined.inputBlock.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected block type.");
    }

    combined.inputBlock.options[0].nextBlockId = selectedTarget.id;
    combined.textNextBlockId = textTarget.id;

    const result = evaluateAnswer(
      {
        title: "Combined routing",
        description: "",
        settings: createDefaultSurveySchema("Combined routing").settings,
        blocks: [combined, selectedTarget, textTarget],
      },
      combined,
      { selectedValue: combined.inputBlock.options[0].id, text: "" },
    );

    expect(result.nextBlockId).toBe(selectedTarget.id);
  });

  it("converts AI self-alias on welcome block into sequential flow", () => {
    const welcome = createBlock("WELCOME", 1);
    const single = createBlock("SINGLE_CHOICE", 2);
    const multi = createBlock("MULTI_CHOICE", 3);

    welcome.title = "Добро пожаловать в опрос";
    welcome.nextBlockId = welcome.title;

    const schema = coerceSurveyNavigationTargets({
      title: "AI survey",
      description: "",
      settings: createDefaultSurveySchema("AI survey").settings,
      blocks: [welcome, single, multi],
    });

    expect(schema.blocks[0]?.nextBlockId).toBe(single.id);
    expect(validateSurveySchema(schema)).toEqual([]);
  });

  it("duplicates additional info items with new identifiers", () => {
    const original = createBlock("TEXT", 2);

    if (original.type !== "TEXT") {
      throw new Error("Unexpected block type.");
    }

    original.additionalInfoEnabled = true;
    original.additionalInfoItems = [
      {
        id: "info-1",
        label: "Подсказка",
        description: "Описание подсказки",
      },
    ];
    const cloned = duplicateSurveyBlock(original);

    expect(cloned.additionalInfoItems).toHaveLength(1);
    expect(cloned.additionalInfoItems[0]?.label).toBe("Подсказка");
    expect(cloned.additionalInfoItems[0]?.description).toBe("Описание подсказки");
    expect(cloned.additionalInfoItems[0]?.id).not.toBe(original.additionalInfoItems[0]?.id);
  });

  it("migrates legacy block additional info into shared survey library", () => {
    const text = createBlock("TEXT", 1);
    text.additionalInfoEnabled = true;
    text.additionalInfoItems = [{ id: "info-1", label: "Кнопка", description: "Общее описание" }];

    const normalized = normalizeSurveySchema({
      title: "Legacy additional info",
      description: "",
      settings: createDefaultSurveySchema("Legacy additional info").settings,
      blocks: [text],
    });
    const [block] = normalized.blocks;

    expect(normalized.settings.additionalInfoItems).toEqual([{ id: "info-1", label: "Кнопка", description: "Общее описание" }]);
    expect(block?.additionalInfoItemIds).toEqual(["info-1"]);
    expect(block?.additionalInfoItems).toEqual([]);
    expect(block ? getBlockAdditionalInfoItems(normalized, block) : []).toEqual(normalized.settings.additionalInfoItems);
  });

  it("uses updated shared additional info text for selected block buttons", () => {
    const schema = createDefaultSurveySchema("Shared additional info");
    schema.settings.additionalInfoItems = [{ id: "shared-1", label: "Новая кнопка", description: "Новый текст" }];
    const block = schema.blocks[1];
    block.additionalInfoEnabled = true;
    block.additionalInfoItemIds = ["shared-1"];
    block.additionalInfoItems = [{ id: "old-1", label: "Старая кнопка", description: "Старый текст" }];

    expect(getBlockAdditionalInfoItems(schema, block)).toEqual(schema.settings.additionalInfoItems);
  });

  it("allows explicit finish target in branching", () => {
    const schema = createDefaultSurveySchema("Flow");
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.nextBlockId = FINISH_SURVEY_TARGET;

    const result = evaluateAnswer(schema, question, question.options[0].id);
    expect(result.nextBlockId).toBe(FINISH_SURVEY_TARGET);
    expect(validateSurveySchema(schema)).toEqual([]);
  });

  it("coerces finish aliases into finish target", () => {
    const welcome = createBlock("WELCOME", 1);
    const single = createBlock("SINGLE_CHOICE", 2);

    single.nextBlockId = "закончить опрос";

    const schema = coerceSurveyNavigationTargets({
      title: "AI survey",
      description: "",
      settings: createDefaultSurveySchema("AI survey").settings,
      blocks: [welcome, single],
    });

    expect(schema.blocks[1]?.nextBlockId).toBe(FINISH_SURVEY_TARGET);
    expect(validateSurveySchema(schema)).toEqual([]);
  });

  it("requires at least one enabled contact field", () => {
    const contact = createBlock("CONTACT", 1);

    if (contact.type !== "CONTACT") {
      throw new Error("Unexpected block type.");
    }

    contact.fields = contact.fields.map((field) => ({ ...field, enabled: false }));

    const schema = {
      title: "Contacts",
      description: "",
      settings: createDefaultSurveySchema("Contacts").settings,
      blocks: [contact],
    };

    expect(validateSurveySchema(schema)).toContain(`У блока "${contact.title}" должен быть включён хотя бы один контакт.`);
  });

  it("normalizes legacy contact field lists into full configurable set", () => {
    const legacySchema: unknown = {
      title: "Legacy",
      description: "",
      settings: createDefaultSurveySchema("Legacy").settings,
      blocks: [
        {
          ...createBlock("CONTACT", 1),
          fields: [
            { id: "fullName", label: "Имя", placeholder: "Иван", required: true },
            { id: "email", label: "Email", placeholder: "name@example.com", required: false },
          ],
        },
      ],
    };

    const normalized = normalizeSurveySchema(legacySchema);

    const [contact] = normalized.blocks;
    if (!contact || contact.type !== "CONTACT") {
      throw new Error("Unexpected normalized schema.");
    }

    expect(contact.fields.map((field) => `${field.id}:${field.enabled ? "on" : "off"}`)).toEqual([
      "fullName:on",
      "email:on",
      "phone:on",
      "company:off",
    ]);
  });
});
