import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/client";
import { getSurveyAbilities, hasAnySurveyAbility, listDisplayableSurveyAbilities } from "@/lib/permissions";

describe("survey permissions", () => {
  it("keeps abilities independent for members", () => {
    const abilities = getSurveyAbilities(
      { id: "member-1", role: UserRole.MEMBER },
      {
        userId: "member-1",
        canView: true,
        canCreate: false,
        canEdit: true,
        canDelete: false,
        canResults: false,
      },
      "owner-1",
    );

    expect(abilities.view).toBe(true);
    expect(abilities.edit).toBe(true);
    expect(abilities.delete).toBe(false);
    expect(abilities.results).toBe(false);
    expect(hasAnySurveyAbility(abilities, ["view", "edit"])).toBe(true);
    expect(hasAnySurveyAbility(abilities, ["delete", "results"])).toBe(false);
  });

  it("grants every ability to survey owners", () => {
    const abilities = getSurveyAbilities(
      { id: "owner-1", role: UserRole.MEMBER },
      null,
      "owner-1",
    );

    expect(abilities).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: true,
      results: true,
    });
  });

  it("lists only survey-facing abilities for badges", () => {
    const abilities = {
      view: true,
      create: true,
      edit: false,
      delete: true,
      results: false,
    };

    expect(listDisplayableSurveyAbilities(abilities)).toEqual(["view", "delete"]);
  });
});
