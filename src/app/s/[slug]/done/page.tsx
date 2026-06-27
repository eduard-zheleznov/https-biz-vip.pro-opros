import { notFound } from "next/navigation";

import { PublicCompletion } from "@/components/survey/public-completion";
import { getPublicResponseCompletionState, getPublishedSurveyBySlug } from "@/lib/data";

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

  const completionState = await getPublicResponseCompletionState(published.survey.id);

  return <PublicCompletion initialState={completionState} surveyId={published.survey.id} />;
}
