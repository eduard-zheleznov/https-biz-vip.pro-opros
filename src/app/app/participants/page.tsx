import { ParticipantsPanel } from "@/components/admin/participants-panel";
import { Card } from "@/components/ui/card";
import { listParticipants, requireParticipantManagerUser } from "@/lib/data";

export default async function ParticipantsPage() {
  const user = await requireParticipantManagerUser();
  const data = await listParticipants(user.id);
  const isAdmin = user.role === "ADMIN";

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Участники</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
          {isAdmin ? "Матрица доступа и приглашения" : "Ваши участники и их права"}
        </h1>
      </Card>
      <ParticipantsPanel participants={data.participants} surveys={data.surveys} />
    </div>
  );
}
