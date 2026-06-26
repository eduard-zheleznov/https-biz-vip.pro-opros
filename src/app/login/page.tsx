import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getCurrentUser, loginWithPassword, resetPasswordWithInitialPassword } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect("/app");
  }

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const loggedOut = params.loggedOut === "1";
  const forgotPasswordOpen = params.forgot === "1";
  const resetError = typeof params.resetError === "string" ? params.resetError : "";
  const resetDone = params.reset === "success";

  async function loginAction(formData: FormData) {
    "use server";

    const result = await loginWithPassword(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
    if (!result.ok) {
      redirect(`/login?error=${encodeURIComponent(result.error)}`);
    }

    redirect(result.user.forcePasswordChange ? "/app/profile/security" : "/app");
  }

  async function forgotPasswordAction(formData: FormData) {
    "use server";

    const result = await resetPasswordWithInitialPassword(
      String(formData.get("email") ?? ""),
      String(formData.get("initialPassword") ?? ""),
      String(formData.get("nextPassword") ?? ""),
    );

    if (!result.ok) {
      redirect(`/login?forgot=1&resetError=${encodeURIComponent(result.error)}`);
    }

    redirect("/login?reset=success");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-10 sm:px-8">
      <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr),420px]">
        <Card className="border-white/70 p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">Admin workspace</p>
          <h1 className="mt-4 max-w-2xl text-5xl font-semibold tracking-tight text-slate-950">
            Вход в конструктор опросов и управление всеми сценариями в одном кабинете.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Используйте логин администратора для первого входа, создавайте участников, публикуйте ссылки на опросы и
            отслеживайте результаты в реальном времени.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              "Версии и откат изменений",
              "Матрица прав по каждому опросу",
              "Telegram и AI-аналитика ответов",
            ].map((item) => (
              <div key={item} className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-slate-200 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Войти</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-950">Личный кабинет</h2>
          <form action={loginAction} className="mt-8 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Электронная почта</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input name="email" type="email" autoComplete="email" required placeholder="info@biz-vip.ru" className="pl-11" />
              </div>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Пароль</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" className="pl-11" />
              </div>
            </label>
            <div className="flex justify-end">
              <Link href="/login?forgot=1" className="text-sm font-semibold text-sky-700 transition hover:text-sky-800">
                Забыли пароль?
              </Link>
            </div>
            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {loggedOut ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Вы вышли из аккаунта. Введите логин и пароль, чтобы войти снова.</div> : null}
            {resetDone ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Пароль обновлён. Используйте новый пароль для входа.</div> : null}
            <Button type="submit" className="w-full">
              Войти
            </Button>
          </form>
          <div className="mt-6 rounded-[28px] border border-sky-100 bg-sky-50 px-5 py-5 text-sm text-sky-900">
            <p className="font-semibold">Первый вход администратора</p>
            <p className="mt-2">
              Используйте выданные seed-данные администратора для этого развёртывания.
            </p>
            <p className="mt-1">
              После входа сразу смените пароль во вкладке безопасности.
            </p>
          </div>
          <Link href="/" className="mt-6 inline-flex text-sm font-semibold text-sky-700">
            Вернуться на главную
          </Link>
        </Card>
      </div>
      {forgotPasswordOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-10">
          <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Восстановление доступа</p>
                <h2 className="mt-3 text-2xl font-semibold text-slate-950">Сменить пароль</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Укажите электронную почту аккаунта, введите первоначальный пароль и задайте новый пароль для входа.
                </p>
              </div>
              <Link href="/login" className="text-sm font-semibold text-slate-500 transition hover:text-slate-700">
                Закрыть
              </Link>
            </div>

            <form action={forgotPasswordAction} className="mt-6 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Логин</span>
                <Input name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Первоначальный пароль</span>
                <Input
                  name="initialPassword"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="Введите первоначальный пароль"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Новый пароль</span>
                <Input name="nextPassword" type="password" autoComplete="new-password" required minLength={8} placeholder="Минимум 8 символов" />
              </label>
              {resetError ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{resetError}</div> : null}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Отмена
                </Link>
                <Button type="submit">Сменить пароль</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
