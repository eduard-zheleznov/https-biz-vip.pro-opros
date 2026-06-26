import Link from "next/link";
import { ArrowRight, BarChart3, Bot, Layers3, ShieldCheck, TimerReset, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/data";

const highlights = [
  {
    icon: Layers3,
    title: "Конструктор блоков",
    description: "Экран приветствия, контакты, выборы, медиа, рейтинг, шкалы, ранжирование и текстовые ответы.",
  },
  {
    icon: ShieldCheck,
    title: "Роли и права",
    description: "Один главный администратор, приглашённые участники и матрица доступа по каждому опросу.",
  },
  {
    icon: BarChart3,
    title: "Результаты и XLSX",
    description: "Список прохождений, фильтры, сортировка, копирование результатов и экспорт в Excel.",
  },
  {
    icon: TimerReset,
    title: "Таймер и ветвления",
    description: "Автопереходы между вопросами, исключения автоскролла и сохранение частичных ответов.",
  },
  {
    icon: Wand2,
    title: "Telegram и AI",
    description: "Асинхронная отправка результатов в Telegram и AI-анализ итогового ответа по заданному правилу.",
  },
  {
    icon: Bot,
    title: "AI для опросов",
    description: "Создание структуры опроса по задаче, подсказки по формулировкам и быстрая оценка качества анкеты перед публикацией.",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  const cabinetHref = user ? "/app" : "/login";
  const cabinetLabel = user ? "Открыть кабинет" : "Войти в кабинет";

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-8 sm:px-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-4 py-2 shadow-[0_24px_80px_-45px_rgba(15,23,42,0.35)] backdrop-blur">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1d5fd0,#63b8ff)] text-sm font-bold text-white">
            PP
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Survey Builder</p>
            <p className="text-sm font-semibold text-slate-900">Конструктор опросов 2.0</p>
          </div>
        </div>
        <Link href={cabinetHref} prefetch={false}>
          <Button variant="secondary">{cabinetLabel}</Button>
        </Link>
      </header>

      <section className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[minmax(0,1.05fr),420px]">
        <div className="space-y-8">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-600">One workspace. Full survey cycle.</p>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
              Админка, публикация, результаты и история версий в одном сервисе.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              Собирайте опросы из типовых блоков, приглашайте участников, настраивайте доступ, публикуйте ссылки и анализируйте ответы
              без отдельной BI-панели.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={cabinetHref} prefetch={false}>
              <Button className="min-w-[220px]">
                Открыть админку
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#features">
              <Button variant="secondary" className="min-w-[220px]">
                Смотреть возможности
              </Button>
            </a>
          </div>
        </div>

        <Card className="border-white/70 p-6">
          <div className="rounded-[28px] border border-sky-100 bg-[linear-gradient(135deg,#eff6ff,#ffffff)] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-500">Core flow</p>
            <div className="mt-5 space-y-4">
              {[
                "Создание опроса и автосохранение версий",
                "Публикация по ссылке и таймер прохождения",
                "Фильтрация результатов и экспорт XLSX",
                "Telegram-уведомления и AI-анализ",
              ].map((step, index) => (
                <div key={step} className="flex items-center gap-4 rounded-3xl bg-white/90 px-4 py-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.25)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                    {index + 1}
                  </div>
                  <p className="text-sm font-medium text-slate-700">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      <section id="features" className="pb-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Возможности</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Что уже заложено в продукте</h2>
          </div>
          <Link href={cabinetHref} prefetch={false} className="text-sm font-semibold text-sky-700">
            Перейти к настройке
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {highlights.map((highlight) => (
            <Card key={highlight.title} className="border-slate-200 p-6">
              <highlight.icon className="h-8 w-8 text-sky-600" />
              <h3 className="mt-4 text-xl font-semibold text-slate-950">{highlight.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{highlight.description}</p>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
