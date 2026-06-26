import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import { getProfileData, requireCurrentUser, syncTelegramConnection } from "@/lib/data";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireCurrentUser();
  const profile = await getProfileData(user.id);
  const params = await searchParams;
  const message = typeof params.message === "string" ? params.message : "";

  async function telegramAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    const username = String(formData.get("username") ?? "").trim();
    await syncTelegramConnection(currentUser.id, username);
    revalidatePath("/app/profile/notifications");
    redirect("/app/profile/notifications?message=telegram-updated");
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Уведомления</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Подключение Telegram</h1>
      </Card>

      <Card className="max-w-3xl border-slate-200 p-6">
        <div className="space-y-3 text-sm text-slate-600">
          {!env.TELEGRAM_BOT_TOKEN ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              На сервере пока не задан `TELEGRAM_BOT_TOKEN`. Пока токен не будет добавлен в окружение сервиса, уведомления в Telegram не заработают даже при корректном username или Chat ID.
            </div>
          ) : null}
          <p>
            1. Откройте бота{" "}
            <a href="https://t.me/Progress_Pro_bot" target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:text-sky-900">
              @Progress_Pro_bot
            </a>{" "}
            в Telegram.
          </p>
          <p>2. Нажмите Start и отправьте любое сообщение.</p>
          <p>3. Укажите свой username без ссылки и сохраните форму ниже.</p>
          <p>
            4. Если нужен Chat ID вручную, откройте{" "}
            <a href="https://t.me/username_to_id_bot" target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:text-sky-900">
              @username_to_id_bot
            </a>
            . Даже при ручном Chat ID бот <span className="font-semibold text-slate-900">@Progress_Pro_bot</span> должен быть предварительно запущен в нужном чате.
          </p>
        </div>
        {message ? (
          <div className="mt-4 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-700">Проверка Telegram выполнена. Статус обновлён.</div>
        ) : null}
        <form action={telegramAction} className="mt-6 space-y-4">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Telegram username</span>
            <Input name="username" defaultValue={profile.telegramConnection?.username ?? ""} placeholder="@username" />
          </label>
          <Button type="submit">Проверить и сохранить</Button>
        </form>
        <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          <p>Статус: {profile.telegramConnection?.status || "PENDING"}</p>
          <p className="mt-2">Chat ID: {profile.telegramConnection?.chatId || "ещё не определён"}</p>
          <p className="mt-2">
            Бот для связи:{" "}
            <Link href="https://t.me/Progress_Pro_bot" target="_blank" className="font-semibold text-sky-700 hover:text-sky-900">
              @Progress_Pro_bot
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
