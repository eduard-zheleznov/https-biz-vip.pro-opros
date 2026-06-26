import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "gpt-5.2",
    OPENROUTER_API_KEY: "",
    OPENROUTER_MODEL: "openai/gpt-4.1-mini",
    APP_URL: "http://127.0.0.1:3000",
  },
}));

describe("openai integration helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("extractJsonObject", () => {
    it("parses plain JSON", async () => {
      const { extractJsonObject } = await import("@/lib/integrations/openai");

      expect(extractJsonObject('{"title":"Тест","blocks":[]}')).toEqual({
        title: "Тест",
        blocks: [],
      });
    });

    it("repairs malformed JSON with a missing comma", async () => {
      const { extractJsonObject } = await import("@/lib/integrations/openai");

      expect(extractJsonObject('{"title":"Тест","blocks":[{"type":"WELCOME"} {"type":"TEXT"}]}')).toEqual({
        title: "Тест",
        blocks: [{ type: "WELCOME" }, { type: "TEXT" }],
      });
    });

    it("extracts fenced JSON", async () => {
      const { extractJsonObject } = await import("@/lib/integrations/openai");

      expect(extractJsonObject('```json\n{"title":"Тест","blocks":[]}\n```')).toEqual({
        title: "Тест",
        blocks: [],
      });
    });
  });

  describe("AI note color helpers", () => {
    it("extracts explicit russian color labels", async () => {
      const { extractAiNoteColor } = await import("@/lib/integrations/openai");

      expect(extractAiNoteColor("ИТОГ: подходит\nЦВЕТ: красный")).toBe("КРАСНЫЙ");
      expect(extractAiNoteColor("ИТОГ: спорно\nЦВЕТ: ЖЁЛТЫЙ")).toBe("ЖЕЛТЫЙ");
      expect(extractAiNoteColor("ИТОГ: сильный кандидат\nЦВЕТ: зеленый")).toBe("ЗЕЛЕНЫЙ");
    });

    it("extracts english color labels for fallback classifier responses", async () => {
      const { extractAiNoteColor } = await import("@/lib/integrations/openai");

      expect(extractAiNoteColor("red")).toBe("КРАСНЫЙ");
      expect(extractAiNoteColor("yellow")).toBe("ЖЕЛТЫЙ");
      expect(extractAiNoteColor("green")).toBe("ЗЕЛЕНЫЙ");
    });

    it("appends a missing color line", async () => {
      const { appendAiNoteColor } = await import("@/lib/integrations/openai");

      expect(appendAiNoteColor("СУММАРНЫЙ БАЛЛ: 44", "ЖЕЛТЫЙ")).toBe("СУММАРНЫЙ БАЛЛ: 44\nЦВЕТ: ЖЕЛТЫЙ");
    });

    it("replaces an existing color line instead of duplicating it", async () => {
      const { appendAiNoteColor } = await import("@/lib/integrations/openai");

      expect(appendAiNoteColor("ИТОГ: подходит\nЦВЕТ: красный", "ЗЕЛЕНЫЙ")).toBe(
        "ИТОГ: подходит\nЦВЕТ: ЗЕЛЕНЫЙ",
      );
    });
  });
});
