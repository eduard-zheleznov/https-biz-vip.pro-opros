import { describe, expect, it } from "vitest";

import { buildAiPromptInput } from "@/lib/ai-prompt-files";

describe("AI prompt file helpers", () => {
  it("returns manual prompt when no file is attached", async () => {
    await expect(
      buildAiPromptInput({
        prompt: "Создай короткий HR-опрос",
        file: null,
      }),
    ).resolves.toBe("Создай короткий HR-опрос");
  });

  it("builds prompt from an attached text file", async () => {
    const file = new File(["Первый вопрос\nВторой вопрос"], "requirements.txt", {
      type: "text/plain",
    });

    const prompt = await buildAiPromptInput({
      prompt: "",
      file,
    });

    expect(prompt).toContain('Построй опрос по содержимому прикреплённого файла "requirements.txt".');
    expect(prompt).toContain("Первый вопрос");
    expect(prompt).toContain("Второй вопрос");
  });

  it("combines manual prompt with file content", async () => {
    const file = new File(["Нужен NPS и блок контактов"], "brief.md", {
      type: "text/markdown",
    });

    const prompt = await buildAiPromptInput({
      prompt: "Добавь таймер 180 секунд.",
      file,
    });

    expect(prompt).toContain('Основной источник требований — прикреплённый файл "brief.md".');
    expect(prompt).toContain("Добавь таймер 180 секунд.");
    expect(prompt).toContain("Нужен NPS и блок контактов");
  });

  it("rejects unsupported files", async () => {
    const file = new File(["%PDF-1.4"], "requirements.pdf", {
      type: "application/pdf",
    });

    await expect(
      buildAiPromptInput({
        prompt: "",
        file,
      }),
    ).rejects.toThrow("Поддерживаются файлы TXT, MD, CSV, JSON, HTML, XML, YAML, RTF и DOCX.");
  });

  it("requires either manual prompt or attached file", async () => {
    await expect(
      buildAiPromptInput({
        prompt: "   ",
        file: null,
      }),
    ).rejects.toThrow("Укажите промт вручную или прикрепите файл с требованиями для генерации.");
  });
});
