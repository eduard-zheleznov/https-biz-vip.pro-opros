import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiProvider } from "@/generated/prisma/client";
import { FolderKanban, FolderPlus, LayoutDashboard, LogOut, Plus, Settings2, UsersRound } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { AiSurveyCreateForm, type AiSurveyCreateFormState } from "@/components/admin/ai-survey-create-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AI_MODEL_OPTIONS } from "@/lib/ai-models";
import { AI_PROMPT_FILE_ACCEPT, buildAiPromptInput } from "@/lib/ai-prompt-files";
import {
  archiveSurvey,
  canManageParticipants,
  createFolder,
  createSurvey,
  createSurveyFromPrompt,
  deleteSurveyPermanently,
  deleteFolder,
  duplicateSurvey,
  getSurveySelectOptions,
  logoutCurrentUser,
  moveSurveyToFolder,
  renameSurvey,
  renameFolder,
  requireCurrentUser,
  restoreSurvey,
} from "@/lib/data";
import { SURVEY_ABILITY_LABELS, listDisplayableSurveyAbilities } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cn, formatSurveyLifecycleStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireCurrentUser();
  const [surveys, folders, participantManager] = await Promise.all([
    getSurveySelectOptions(user.id),
    prisma.folder.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    canManageParticipants(user.id),
  ]);

  const aiProviderOptions = [
    { value: AiProvider.OPENROUTER, label: "OpenRouter" },
    { value: AiProvider.OPENAI, label: "OpenAI" },
  ] as const;

  async function createSurveyAction() {
    "use server";

    const currentUser = await requireCurrentUser();
    const survey = await createSurvey(currentUser.id);
    redirect(`/app/surveys/${survey.id}`);
  }

  async function createAiSurveyAction(
    _state: AiSurveyCreateFormState,
    formData: FormData,
  ): Promise<AiSurveyCreateFormState> {
    "use server";

    const currentUser = await requireCurrentUser();
    let surveyId: string | null = null;

    try {
      const prompt = await buildAiPromptInput({
        prompt: String(formData.get("prompt") ?? ""),
        file: formData.get("promptFile"),
      });

      const survey = await createSurveyFromPrompt(currentUser.id, {
        prompt,
        provider: String(formData.get("aiProvider") ?? "") === AiProvider.OPENAI ? AiProvider.OPENAI : AiProvider.OPENROUTER,
        model: String(formData.get("aiModel") ?? "") || null,
        apiKey: String(formData.get("aiApiKey") ?? "") || null,
      });

      surveyId = survey.id;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Не удалось создать опрос с помощью ИИ.",
      };
    }

    if (!surveyId) {
      return {
        error: "Не удалось создать опрос с помощью ИИ.",
      };
    }

    redirect(`/app/surveys/${surveyId}`);
  }

  async function createFolderAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await createFolder(String(formData.get("name") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  async function renameFolderAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await renameFolder(String(formData.get("folderId") ?? ""), currentUser.id, String(formData.get("name") ?? ""));
    revalidatePath("/app");
  }

  async function deleteFolderAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await deleteFolder(String(formData.get("folderId") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  async function renameSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await renameSurvey(String(formData.get("surveyId") ?? ""), currentUser.id, String(formData.get("title") ?? ""));
    revalidatePath("/app");
  }

  async function duplicateSurveyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await duplicateSurvey(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
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

  async function deleteSurveyPermanentlyAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await deleteSurveyPermanently(String(formData.get("surveyId") ?? ""), currentUser.id);
    revalidatePath("/app");
  }

  async function logoutAction() {
    "use server";

    await logoutCurrentUser();
    redirect("/login?loggedOut=1");
  }

  const navItems = [
    { href: "/app", label: "Обзор", icon: LayoutDashboard },
    ...(participantManager ? [{ href: "/app/participants", label: "Участники", icon: UsersRound }] : []),
    { href: "/app/profile", label: "Профиль", icon: Settings2 },
  ];
  const activeSurveys = surveys.filter((survey) => survey.folderKey !== "ARCHIVE");
  const systemFolders = [
    {
      href: "/app?folder=mine",
      label: "Мои опросы",
      tone: "hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900",
    },
    {
      href: "/app?folder=archive",
      label: "Архив",
      tone: "hover:border-amber-200 hover:bg-amber-50 hover:text-amber-900",
    },
    {
      href: "/app?folder=restored",
      label: "Восстановленные",
      tone: "hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900",
    },
  ] as const;

  const createSurveyPanel = (
    <div className="mt-6 rounded-[26px] border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-sky-600" />
          <p className="text-sm font-semibold text-slate-900">Опросы</p>
        </div>
        <form action={createSurveyAction}>
          <Button type="submit" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Новый опрос
          </Button>
        </form>
      </div>
      <div className="mt-3 space-y-2">
        {activeSurveys.map((survey) => (
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
            const hasMenuActions = canDuplicate || canEditSurvey || canDeleteSurvey;

            return (
              <div key={survey.id} className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600 transition hover:bg-sky-50 hover:text-sky-900">
                <div className="flex items-start gap-2">
                  {surveyHref ? (
                    <Link href={surveyHref} className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{survey.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatSurveyLifecycleStatus(survey.lifecycleStatus)}</p>
                      {user.role !== "ADMIN" ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {listDisplayableSurveyAbilities(survey.abilities).map((ability) => (
                            <Badge key={ability} tone="neutral" className="bg-white text-[10px]">
                              {SURVEY_ABILITY_LABELS[ability]}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{survey.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatSurveyLifecycleStatus(survey.lifecycleStatus)}</p>
                      {user.role !== "ADMIN" ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {listDisplayableSurveyAbilities(survey.abilities).map((ability) => (
                            <Badge key={ability} tone="neutral" className="bg-white text-[10px]">
                              {SURVEY_ABILITY_LABELS[ability]}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                  {hasMenuActions ? (
                    <ActionMenu panelClassName="w-[20rem]">
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
                        <form action={duplicateSurveyAction} className={cn(canEditSurvey ? "mt-2" : "")}>
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
                            {folders.map((folder) => (
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
                    </ActionMenu>
                  ) : null}
                </div>
              </div>
            );
          })()
        ))}
      </div>
      <details className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900">
          Создать с ИИ
        </summary>
        <AiSurveyCreateForm
          action={createAiSurveyAction}
          modelOptions={AI_MODEL_OPTIONS}
          promptFileAccept={AI_PROMPT_FILE_ACCEPT}
          defaultProvider={AiProvider.OPENROUTER}
          providerOptions={aiProviderOptions.map((item) => ({ value: item.value, label: item.label }))}
        />
      </details>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1760px] gap-5 px-4 py-4 sm:px-6 lg:px-8">
      <aside className="hidden w-[320px] shrink-0 xl:block">
        <Card className="sticky top-4 border-white/70 p-4">
          <div className="rounded-[28px] bg-slate-950 px-5 py-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace</p>
            <h1 className="mt-2 text-2xl font-semibold">Конструктор опросов</h1>
            <p className="mt-2 text-sm text-slate-300">{user.displayName || user.email}</p>
            <Badge className="mt-4 bg-white/10 text-white">{user.role}</Badge>
          </div>

          <nav className="mt-4 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-[22px] px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          {createSurveyPanel}

          <div className="mt-4 rounded-[26px] border border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-slate-500" />
              <p className="text-sm font-semibold text-slate-900">Папки</p>
            </div>

            <form action={createFolderAction} className="mt-3 flex gap-2">
              <Input name="name" required placeholder="Новая папка" className="h-10" />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                <FolderPlus className="mr-2 h-4 w-4" />
                Создать
              </Button>
            </form>

            <div className="mt-3 space-y-2">
              {systemFolders.map((folder) => (
                <Link
                  key={folder.href}
                  href={folder.href}
                  className={cn(
                    "block rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 transition",
                    folder.tone,
                  )}
                >
                  {folder.label}
                </Link>
              ))}
              {folders.map((folder) => (
                <div key={folder.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/app?folder=folder:${folder.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                      {folder.name}
                    </Link>
                    <ActionMenu panelClassName="w-[18rem]">
                      <form action={renameFolderAction} className="space-y-2">
                        <input type="hidden" name="folderId" value={folder.id} />
                        <Input name="name" defaultValue={folder.name} />
                        <Button type="submit" variant="secondary" size="sm" className="w-full">
                          Переименовать
                        </Button>
                      </form>
                      <form action={deleteFolderAction} className="mt-2">
                        <input type="hidden" name="folderId" value={folder.id} />
                        <Button type="submit" variant="ghost" size="sm" className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                          Удалить
                        </Button>
                      </form>
                    </ActionMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form action={logoutAction} className="mt-4">
            <Button
              type="submit"
              variant="ghost"
              className="flex w-full items-center justify-start gap-3 rounded-[22px] px-4 py-3 text-sm font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </form>
        </Card>
      </aside>

      <div className="min-w-0 flex-1 space-y-5">
        <Card className="border-white/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Личный кабинет</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{user.displayName || user.email}</p>
            </div>
          </div>
          {user.forcePasswordChange ? (
            <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              Для безопасности смените пароль. Профиль уже открыт по ссылке в меню.
            </div>
          ) : null}
        </Card>
        <div className="xl:hidden">
          {createSurveyPanel}
        </div>
        {children}
      </div>
    </div>
  );
}
