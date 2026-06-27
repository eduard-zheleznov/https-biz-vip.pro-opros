import { describe, expect, it } from "vitest";

import { buildPublicSlugBase, buildUniquePublicSlug, normalizePublicSlugInput } from "@/lib/public-slug";

describe("public survey slugs", () => {
  it("builds short readable defaults from survey titles", () => {
    expect(buildPublicSlugBase("Фильтрация ОКЦ и МПП")).toBe("okc-mpp");
    expect(buildPublicSlugBase("Анкета кандидата: ассистент руководителя / PM")).toBe("assistant-pm");
    expect(buildPublicSlugBase("Новый опрос")).toBe("opros");
  });

  it("normalizes manually entered public links", () => {
    expect(normalizePublicSlugInput("  OKC MPP  ")).toBe("okc-mpp");
    expect(normalizePublicSlugInput("https://biz-vip.pro/opros/s/Продажи B2B?restart=1")).toBe("prodazhi-b2b");
    expect(normalizePublicSlugInput("/opros/s/anketa-kandidata/")).toBe("anketa-kandidata");
  });

  it("rejects unsafe or empty public links", () => {
    expect(() => normalizePublicSlugInput("")).toThrow("Адрес ссылки не может быть пустым.");
    expect(() => normalizePublicSlugInput("***")).toThrow("Адрес ссылки должен содержать буквы или цифры.");
    expect(() => normalizePublicSlugInput("login")).toThrow("Этот адрес зарезервирован.");
    expect(() => normalizePublicSlugInput("a".repeat(65))).toThrow("Адрес ссылки должен быть не длиннее 64 символов.");
  });

  it("adds readable numbers when a default slug is already taken", async () => {
    const taken = new Set(["okc-mpp", "okc-mpp-2"]);

    await expect(buildUniquePublicSlug("Фильтрация ОКЦ и МПП", (slug) => Promise.resolve(taken.has(slug)))).resolves.toBe("okc-mpp-3");
  });
});
