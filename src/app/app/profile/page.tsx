import Link from "next/link";

import { Card } from "@/components/ui/card";
import { getProfileData, requireCurrentUser } from "@/lib/data";

export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const profile = await getProfileData(user.id);

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Профиль</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">{profile.displayName || profile.email}</h1>
        <p className="mt-3 text-base leading-7 text-slate-600">
          Здесь находятся персональные настройки, безопасность аккаунта и подключение уведомлений.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-900">Основные данные</p>
          <div className="mt-5 space-y-3 text-sm text-slate-600">
            <p>Email: {profile.email}</p>
            <p>Роль: {profile.role}</p>
            <p>Статус: {profile.status}</p>
            <p>Telegram: {profile.telegramConnection?.status || "Не подключен"}</p>
          </div>
        </Card>
        <Card className="border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-900">Разделы</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link href="/app/profile/security" className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900">
              Безопасность
            </Link>
            <Link href="/app/profile/notifications" className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900">
              Уведомления
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
