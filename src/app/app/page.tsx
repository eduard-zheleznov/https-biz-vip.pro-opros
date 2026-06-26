import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Archive, Sparkles } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  archiveSurvey,
  deleteSurveyPermanently,
  duplicateSurvey,
  getDashboardData,
  moveSurveyToFolder,
  renameSurvey,
  requireCurrentUser,
  restoreSurvey,
} from "@/lib/data";
import { SURVEY_ABILITY_LABELS, listDisplayableSurveyAbilities } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatDateTimeInTimeZone, formatResponseStatus, formatSurveyLifecycleStatus } from "@/lib/utils";

function formatFolderLabel(folderKey: string) {
  switch (folderKey) {
    case "MY_SURVEYS":
      return "Мои опросы";
    case "ARCHIVE":
      return "Архив";
    case "RESTORED":
      return "Восстановленные";
    case "CUSTOM":
      return "Пользовательская папка";
    default:
      return folderKey;
  }
}

function filterSurvey(folderFilter: string, survey: Awaited<ReturnType<typeof getDashboardData>>["surveys"][number]) {
  if (folderFilter === "archive") {
    return survey.folderKey === "ARCHIVE";
  }

  if (folderFilter === "restored") {
    return survey.folderKey === "RESTORED";
  }

  if (folderFilter === "mine") {
    return survey.folderKey === "MY_SURVEYS";
  }

  if (folderFilter.startsWith("folder:")) {
    return survey.folderId === folderFilter.replace("folder:", "");
  }

  return true;
}

export default async function AppDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireCurrentUser();
  const data = await getDashboardData(user.id);
  const availableFolders = await prisma.folder.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const params = await searchParams;
  const folderFilter = typeof params.folder === "string" ? params.folder : "all";

  async function renameSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await renameSurvey(String(formData.get("surveyId") ?? ""), currentUser.id, String(formData.get("title") ?? ""));
    revalidatePath("/app");
  }

  async function duplicateSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    const survey = await duplicateSurvey(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
    revalidatePath(`/app/surveys/${survey.id}`);
  }

  async function moveSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await moveSurveyToFolder(
      String(formData.get("surveyId") ?? ""),
      currentUser.id,
      String(formData.get("folderId") ?? "") || null,
    );
    revalidatePath("/app");
  }

  async function archiveSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await archiveSurvey(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  async function restoreSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await restoreSurvey(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  async function deletePermanentlySurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await deleteSurveyPermanently(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  const visibleSurveys = data.surveys.filter((survey) => filterSurvey(folderFilter, survey));

  return (
    <div className="space-y-6">
      <section className="grid gap-5 xl:grid-cols-3">
        <Card className="border-slate-200 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Обзор</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Панель управления опросами</h1>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            Все папки и быстрые действия теперь вынесены в левую панель. Здесь остаётся обзор и список опросов.
          </p>
        </Card>

        <Card className="min-w-0 overflow-hidden border-slate-200 p-4 sm:p-6">
          <p className="text-sm text-slate-500">Опросов доступно</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{data.surveys.length}</p>
        </Card>

        <Card className="border-slate-200 p-6">
          <p className="text-sm text-slate-500">Последний ответ</p>
          <p className="mt-2 text-sm font-semibold text-slate-950">
            {data.recentResponses[0]
              ? `${formatDateTimeInTimeZone(data.recentResponses[0].startedAt, { timeZone: "Europe/Moscow" })} (по мск)`
              : "Пока нет ответов"}
          </p>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr),360px]">
        <Card className="border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Список</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Опросы</h2>
            </div>
            <Badge>{visibleSurveys.length}</Badge>
          </div>
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {visibleSurveys.map((survey) => (
              (() => {
                const surveyHref =
                  survey.abilities.view || survey.abilities.edit
                    ? `/app/surveys/${survey.id}`
                    : survey.abilities.results
                      ? `/app/surveys/${survey.id}?tab=results`
                      : null;
                const canDuplicate = survey.abilities.view || survey.abilities.edit;
                const canEditSurvey = survey.abilities.edit;
                const canDeleteSurvey = survey.abilities.delete;
                const canRestoreSurvey = survey.folderKey === "ARCHIVE" && canEditSurvey;
                const hasMenuActions =
                  survey.folderKey === "ARCHIVE"
                    ? canRestoreSurvey || canDeleteSurvey
                    : canDuplicate || canEditSurvey || canDeleteSurvey;

                return (
                  <Card key={survey.id} className="h-full min-w-0 overflow-hidden border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-sky-200 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {surveyHref ? (
                          <Link href={surveyHref} className="block">
                            <h3 className="truncate text-xl font-semibold text-slate-950">{survey.title}</h3>
                          </Link>
                        ) : (
                          <h3 className="truncate text-xl font-semibold text-slate-950">{survey.title}</h3>
                        )}
                        <p className="mt-2 text-sm leading-7 text-slate-600">{survey.description || "Описание пока не задано."}</p>
                      </div>
                      {hasMenuActions ? (
                        <ActionMenu panelClassName="w-[20rem]">
                          {survey.folderKey === "ARCHIVE" ? (
                            <>
                              {canRestoreSurvey ? (
                                <form action={restoreSurveyAction}>
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <Button type="submit" variant="secondary" size="sm" className="w-full">
                                    Восстановить
                                  </Button>
                                </form>
                              ) : null}

                              {canDeleteSurvey ? (
                                <form action={deletePermanentlySurveyAction} className={canRestoreSurvey ? "mt-2" : ""}>
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <Button type="submit" variant="ghost" size="sm" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                                    Удалить навсегда
                                  </Button>
                                </form>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {canEditSurvey ? (
                                <form action={renameSurveyAction} className="space-y-2">
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <Input name="title" defaultValue={survey.title} />
                                  <Button type="submit" variant="secondary" size="sm" className="w-full">
                                    Переименовать
                                  </Button>
                                </form>
                              ) : null}

                              {canDuplicate ? (
                                <form action={duplicateSurveyAction} className={canEditSurvey ? "mt-2" : ""}>
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <Button type="submit" variant="secondary" size="sm" className="w-full">
                                    Дублировать
                                  </Button>
                                </form>
                              ) : null}

                              {canEditSurvey ? (
                                <form action={moveSurveyAction} className="mt-2 space-y-2">
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <select
                                    name="folderId"
                                    defaultValue={survey.folderId ?? ""}
                                    className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                  >
                                    <option value="">Мои опросы</option>
                                    {availableFolders.map((folder) => (
                                      <option key={folder.id} value={folder.id}>
                                        {folder.name}
                                      </option>
                                    ))}
                                  </select>
                                  <Button type="submit" variant="secondary" size="sm" className="w-full">
                                    Переместить в папку
                                  </Button>
                                </form>
                              ) : null}

                              {canDeleteSurvey ? (
                                <form action={archiveSurveyAction} className="mt-2">
                                  <input type="hidden" name="surveyId" value={survey.id} />
                                  <Button type="submit" variant="ghost" size="sm" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                                    Удалить
                                  </Button>
                                </form>
                              ) : null}
                            </>
                          )}
                        </ActionMenu>
                      ) : null}
                    </div>

                    <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                      <Badge tone={survey.lifecycleStatus === "ARCHIVED" ? "warning" : survey.lifecycleStatus === "PUBLISHED" ? "success" : "neutral"}>
                        {formatSurveyLifecycleStatus(survey.lifecycleStatus)}
                      </Badge>
                      <Badge tone="neutral" className="min-w-0 max-w-full whitespace-normal break-words text-left leading-5">
                        Автор: {survey.owner.displayName || survey.owner.email}
                      </Badge>
                      {user.role !== "ADMIN"
                        ? listDisplayableSurveyAbilities(survey.abilities).map((ability) => (
                            <Badge key={ability} tone="neutral">
                              {SURVEY_ABILITY_LABELS[ability]}
                            </Badge>
                          ))
                        : null}
                    </div>

                    <div className="mt-5 grid gap-2 text-sm text-slate-500">
                      <p>{survey.abilities.results ? `${survey._count.responses} ответов` : "Результаты скрыты"}</p>
                      <p>Обновлён: {formatDateTime(survey.updatedAt)}</p>
                      <p>Папка: {survey.folder?.name || formatFolderLabel(survey.folderKey)}</p>
                    </div>
                  </Card>
                );
              })()
            ))}
          </div>
        </Card>

        <Card className="border-slate-200 p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-600" />
            <p className="text-sm font-semibold text-slate-900">Последние результаты</p>
          </div>
          <div className="mt-5 space-y-3">
            {data.recentResponses.map((response) => (
              <div key={response.id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{response.survey.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTimeInTimeZone(response.startedAt, { timeZone: "Europe/Moscow" })} (по мск)
                    </p>
                  </div>
                  <Badge tone={response.status === "COMPLETED" ? "success" : response.status === "TIMED_OUT" ? "warning" : "neutral"}>
                    {formatResponseStatus(response.status)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-slate-600">Баллы: {response.totalScore}</p>
              </div>
            ))}
            {!data.recentResponses.length ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Пока нет ответов. Опубликуйте первый опрос и откройте публичную ссылку.
              </div>
            ) : null}
          </div>
          <div className="mt-6 rounded-[28px] bg-slate-950 px-5 py-5 text-white">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-sky-300" />
              <p className="text-sm font-semibold">Архив на 30 дней</p>
            </div>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              Удалённые опросы не пропадают сразу: они уходят в архив и автоматически очищаются только через 30 дней.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
