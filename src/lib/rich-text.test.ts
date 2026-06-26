import { describe, expect, it } from "vitest";

import { parseRichTextSegments, stripRichTextTokens } from "@/lib/rich-text";
import { createDefaultSurveySchema, evaluateAnswer } from "@/lib/survey-schema";

describe("rich text colors", () => {
  it("strips internal color tokens from plain text output", () => {
    expect(stripRichTextTokens("Обычный [color=red]красный[/color] текст")).toBe("Обычный красный текст");
  });

  it("keeps only allowed colors when parsing segments", () => {
    expect(parseRichTextSegments("[color=red]Да[/color] [color=unknown]нет[/color]")).toEqual([
      { text: "Да", colorId: "red", bold: false },
      { text: " нет", colorId: null, bold: false },
    ]);
  });

  it("strips internal bold tokens from plain text output", () => {
    expect(stripRichTextTokens("Обычный [b]жирный[/b] текст")).toBe("Обычный жирный текст");
    expect(parseRichTextSegments("[b][color=blue]Да[/color][/b]")).toEqual([{ text: "Да", colorId: "blue", bold: true }]);
  });

  it("does not leak formatting tokens into evaluated answers", () => {
    const schema = createDefaultSurveySchema("Тест");
    const question = schema.blocks[1];

    if (question.type !== "SINGLE_CHOICE") {
      throw new Error("Unexpected default schema shape.");
    }

    question.title = "Выберите [color=blue]вариант[/color]";
    question.options[0].label = "[color=green]Подходит[/color]";

    const result = evaluateAnswer(schema, question, question.options[0].id);

    expect(result.prompt).toBe("Выберите вариант");
    expect(result.value).toBe("Подходит");
  });
});
