import { notFound } from "next/navigation";

import { PublicRuntime } from "@/components/survey/public-runtime";
import { getPublishedSurveyBySlug } from "@/lib/data";

export default async function PublicSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ restart?: string; retake?: string }>;
}) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};
  const published = await getPublishedSurveyBySlug(slug);

  if (!published) {
    notFound();
  }

  return (
    <main className="w-full px-5 pb-8 pt-14 sm:px-8 sm:py-8 lg:px-10">
      <PublicRuntime
        surveyId={published.survey.id}
        publicSlug={published.survey.publicSlug}
        schema={published.schema}
        restartRequested={query.restart === "1"}
        retakeToken={typeof query.retake === "string" ? query.retake : null}
      />
    </main>
  );
}
