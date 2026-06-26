import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPublishedSurveyBySlug } from "@/lib/data";

export default async function PublicSurveyDonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const published = await getPublishedSurveyBySlug(slug);

  if (!published) {
    notFound();
  }

  const heading = published.schema.settings.completionMessage || "Спасибо за опрос!";
  const compactHeading = heading.trim();
  const keepHeadingOnOneLine = compactHeading.length <= 28 && !compactHeading.includes("\n");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-5 py-8 sm:px-8">
      <Card className="w-full border-slate-200 p-8 text-center">
        <h1
          className={
            keepHeadingOnOneLine
              ? "whitespace-nowrap text-[clamp(1.8rem,8vw,2.5rem)] font-semibold leading-tight tracking-tight text-slate-950"
              : "whitespace-pre-line text-[clamp(1.6rem,7vw,2.5rem)] font-semibold leading-tight tracking-tight text-slate-950"
          }
        >
          {heading}
        </h1>
        {published.schema.settings.showRestartButton ? (
          <div className="mt-8">
            <Link href={`/s/${slug}?restart=1`}>
              <Button variant="secondary">Пройти снова</Button>
            </Link>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
