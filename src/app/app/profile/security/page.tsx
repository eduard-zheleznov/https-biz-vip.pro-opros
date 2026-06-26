import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireCurrentUser, updatePassword } from "@/lib/data";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const message = typeof params.message === "string" ? params.message : "";

  async function changePasswordAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    const nextPassword = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (nextPassword.length < 8) {
      redirect("/app/profile/security?message=password-too-short");
    }

    if (nextPassword !== confirmPassword) {
      redirect("/app/profile/security?message=password-mismatch");
    }

    await updatePassword(currentUser.id, nextPassword);
    revalidatePath("/app/profile");
    redirect("/app/profile/security?message=password-updated");
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Безопасность</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Смена пароля</h1>
      </Card>

      <Card className="max-w-2xl border-slate-200 p-6">
        <p className="text-sm text-slate-600">Для аккаунта {user.email} рекомендуется сразу заменить пароль по умолчанию.</p>
        {message ? (
          <div className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-700">
            {message === "invite-accepted"
              ? "Аккаунт активирован. Задайте постоянный пароль."
              : message === "password-updated"
                ? "Пароль успешно обновлён."
                : message === "password-mismatch"
                  ? "Пароли не совпадают."
                  : "Пароль должен быть не короче 8 символов."}
          </div>
        ) : null}
        <form action={changePasswordAction} className="mt-6 space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Новый пароль</span>
            <Input name="password" type="password" required minLength={8} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Подтверждение</span>
            <Input name="confirmPassword" type="password" required minLength={8} />
          </label>
          <Button type="submit">Обновить пароль</Button>
        </form>
      </Card>
    </div>
  );
}
