import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { acceptInvitation, getCurrentUser } from "@/lib/data";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/app");
  }

  const { token } = await params;
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";

  async function acceptAction() {
    "use server";

    try {
      await acceptInvitation(token);
      redirect("/app/profile/security?message=invite-accepted");
    } catch (issue) {
      redirect(`/invite/${token}?error=${encodeURIComponent(issue instanceof Error ? issue.message : "Ошибка активации")}`);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-5 py-10 sm:px-8">
      <Card className="w-full border-slate-200 p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">Приглашение</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">Активируйте доступ к конструктору опросов</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          После активации создастся аккаунт участника с логином по вашей почте и временным паролем по умолчанию. Сразу
          после входа система переведёт вас на смену пароля.
        </p>
        {error ? <div className="mx-auto mt-6 max-w-xl rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <form action={acceptAction} className="mt-8">
          <Button type="submit" className="min-w-[260px]">
            Активировать аккаунт
          </Button>
        </form>
      </Card>
    </main>
  );
}
