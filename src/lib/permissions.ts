import { UserRole, type SurveyPermission, type User } from "@/generated/prisma/client";

export type SurveyAbility = "view" | "create" | "edit" | "delete" | "results";
export type SurveyAbilities = Record<SurveyAbility, boolean>;

export const SURVEY_ABILITY_LABELS: Record<Exclude<SurveyAbility, "create">, string> = {
  view: "Просмотр",
  edit: "Редактирование",
  delete: "Удаление",
  results: "Результаты",
};

function permissionKey(ability: SurveyAbility) {
  switch (ability) {
    case "view":
      return "canView";
    case "create":
      return "canCreate";
    case "edit":
      return "canEdit";
    case "delete":
      return "canDelete";
    case "results":
      return "canResults";
  }
}

export function isAdmin(user: Pick<User, "role"> | null | undefined) {
  return user?.role === UserRole.ADMIN;
}

export function hasSurveyAbility(
  user: Pick<User, "id" | "role"> | null | undefined,
  permission: Pick<SurveyPermission, "userId" | "canView" | "canCreate" | "canEdit" | "canDelete" | "canResults"> | null,
  ownerId: string,
  ability: SurveyAbility,
) {
  if (!user) {
    return false;
  }

  if (isAdmin(user) || user.id === ownerId) {
    return true;
  }

  if (!permission || permission.userId !== user.id) {
    return false;
  }

  return Boolean(permission[permissionKey(ability)]);
}

export function getSurveyAbilities(
  user: Pick<User, "id" | "role"> | null | undefined,
  permission: Pick<SurveyPermission, "userId" | "canView" | "canCreate" | "canEdit" | "canDelete" | "canResults"> | null,
  ownerId: string,
): SurveyAbilities {
  return {
    view: hasSurveyAbility(user, permission, ownerId, "view"),
    create: hasSurveyAbility(user, permission, ownerId, "create"),
    edit: hasSurveyAbility(user, permission, ownerId, "edit"),
    delete: hasSurveyAbility(user, permission, ownerId, "delete"),
    results: hasSurveyAbility(user, permission, ownerId, "results"),
  };
}

export function hasAnySurveyAbility(
  abilities: SurveyAbilities,
  requested: SurveyAbility[] = ["view", "create", "edit", "delete", "results"],
) {
  return requested.some((ability) => abilities[ability]);
}

export function listDisplayableSurveyAbilities(abilities: SurveyAbilities) {
  return (Object.keys(SURVEY_ABILITY_LABELS) as Array<keyof typeof SURVEY_ABILITY_LABELS>).filter(
    (ability) => abilities[ability],
  );
}

export function emptyPermissionRow(surveyId: string, userId: string) {
  return {
    surveyId,
    userId,
    canView: false,
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canResults: false,
  };
}

export function canManageParticipantsByPermission(
  permission:
    | Pick<SurveyPermission, "userId" | "canCreate">
    | null
    | undefined,
  userId: string,
) {
  return Boolean(permission && permission.userId === userId && permission.canCreate);
}
