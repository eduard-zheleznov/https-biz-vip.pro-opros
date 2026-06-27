import { describe, expect, it } from "vitest";

import { preserveMobileTextOverridesOnUpdate } from "@/lib/mobile-text-overrides";
import type { TextBlock } from "@/types/surveys";

function buildTextBlock(overrides?: Partial<TextBlock>): TextBlock {
  return {
    id: "text-1",
    type: "TEXT",
    adminLabel: "Вопрос",
    title: "Старый заголовок",
    description: "Старое описание",
    questionHint: "",
    required: true,
    nextBlockId: null,
    showFinishButton: false,
    showRestartBlockButton: false,
    additionalInfoEnabled: false,
    additionalInfoItemIds: [],
    additionalInfoItems: [],
    placeholder: "Ответ",
    multiline: true,
    minLength: 0,
    maxLength: 2000,
    allowVoiceAnswer: false,
    attachVoiceAnswerToResult: false,
    allowFileAnswer: false,
    ...overrides,
  };
}

describe("mobile text overrides", () => {
  it("preserves a saved mobile override when a stale desktop text update omits the override field", () => {
    const current = buildTextBlock({
      mobileTextOverrides: {
        title: "Мобильный\nзаголовок",
      },
    });
    const staleDesktopUpdate = buildTextBlock({
      title: "Новый заголовок для компьютера",
    });
    delete staleDesktopUpdate.mobileTextOverrides;

    expect(preserveMobileTextOverridesOnUpdate(current, staleDesktopUpdate)).toMatchObject({
      title: "Новый заголовок для компьютера",
      mobileTextOverrides: {
        title: "Мобильный\nзаголовок",
      },
    });
  });

  it("allows an explicit reset of mobile overrides", () => {
    const current = buildTextBlock({
      mobileTextOverrides: {
        title: "Мобильный\nзаголовок",
      },
    });
    const explicitReset = buildTextBlock({
      title: "Новый заголовок для компьютера",
      mobileTextOverrides: {},
    });

    expect(preserveMobileTextOverridesOnUpdate(current, explicitReset).mobileTextOverrides).toEqual({});
  });
});
