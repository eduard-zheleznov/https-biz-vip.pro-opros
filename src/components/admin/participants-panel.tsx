"use client";

import { useMemo, useState, useTransition } from "react";
import { Shield, Trash2, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { DEFAULT_MEMBER_PASSWORD } from "@/lib/defaults";
import { cn } from "@/lib/utils";

type Participant = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
};

type Survey = {
  id: string;
  title: string;
};

type PermissionRow = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canResults: boolean;
};

type ParticipantsPanelProps = {
  participants: (Participant & { permissions: Array<{ surveyId: string } & PermissionRow> })[];
  surveys: Survey[];
};

const permissionColumns = [
  { key: "canView", label: "Просмотр" },
  { key: "canEdit", label: "Редактирование" },
  { key: "canDelete", label: "Удаление" },
  { key: "canResults", label: "Результаты" },
] as const;

function toneForStatus(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "INVITED":
      return "warning";
    case "DELETED":
      return "danger";
    default:
      return "neutral";
  }
}

export function ParticipantsPanel({ participants, surveys }: ParticipantsPanelProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedParticipantId, setSelectedParticipantId] = useState(participants[0]?.id ?? "");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [matrix, setMatrix] = useState(() =>
    Object.fromEntries(
      participants.map((participant) => [
        participant.id,
        Object.fromEntries(
          surveys.map((survey) => {
            const current = participant.permissions.find((permission) => permission.surveyId === survey.id);
            return [
              survey.id,
              {
                canView: current?.canView ?? false,
                canCreate: current?.canCreate ?? false,
                canEdit: current?.canEdit ?? false,
                canDelete: current?.canDelete ?? false,
                canResults: current?.canResults ?? false,
              },
            ];
          }),
        ),
      ]),
    ),
  );
  const [pending, startTransition] = useTransition();
  const [localParticipants, setLocalParticipants] = useState(participants);

  const selectedParticipant = localParticipants.find((participant) => participant.id === selectedParticipantId) ?? localParticipants[0];
  const selectedRows = selectedParticipant ? matrix[selectedParticipant.id] ?? {} : {};
  const participantAccessEnabled = Object.values(selectedRows).some((row) => row.canCreate);

  const stats = useMemo(
    () => ({
      total: localParticipants.length,
      active: localParticipants.filter((participant) => participant.status === "ACTIVE").length,
      invited: localParticipants.filter((participant) => participant.status === "INVITED").length,
    }),
    [localParticipants],
  );

  const mutateSelected = (mutator: (surveyId: string, row: PermissionRow) => PermissionRow) => {
    if (!selectedParticipant) {
      return;
    }

    setMatrix((current) => ({
      ...current,
      [selectedParticipant.id]: Object.fromEntries(
        Object.entries(current[selectedParticipant.id] ?? {}).map(([surveyId, row]) => [surveyId, mutator(surveyId, row)]),
      ),
    }));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Участники</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Команда опросов</h2>
            </div>
            <div className="rounded-3xl bg-slate-50 px-4 py-3 text-right">
              <p className="text-xs text-slate-400">Всего</p>
              <p className="text-lg font-semibold text-slate-900">{stats.total}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-[28px] bg-slate-50 p-4 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Активные</span>
              <span className="font-semibold text-slate-900">{stats.active}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Ожидают активации</span>
              <span className="font-semibold text-slate-900">{stats.invited}</span>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <Input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              type="email"
              placeholder="name@example.com"
            />
            <Button
              className="w-full"
              disabled={pending || !inviteEmail.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  setSuccessMessage("");

                  const response = await fetch("/api/admin/participants", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email: inviteEmail }),
                  });

                  const payload = (await response.json()) as {
                    error?: string;
                    inviteUrl?: string;
                    memberId?: string;
                  };

                  if (!response.ok || !payload.inviteUrl || !payload.memberId) {
                    setError(payload.error || "Не удалось добавить участника.");
                    return;
                  }

                  const nextParticipant = {
                    id: payload.memberId,
                    email: inviteEmail.trim().toLowerCase(),
                    displayName: null,
                    status: "INVITED",
                    permissions: [],
                  };

                  setLocalParticipants((current) => [nextParticipant, ...current]);
                  setMatrix((current) => ({
                    ...current,
                    [payload.memberId!]: Object.fromEntries(
                      surveys.map((survey) => [
                        survey.id,
                        {
                          canView: false,
                          canCreate: false,
                          canEdit: false,
                          canDelete: false,
                          canResults: false,
                        },
                      ]),
                    ),
                  }));
                  setSelectedParticipantId(payload.memberId);
                  setInviteUrl(payload.inviteUrl);
                  setInviteEmail("");
                  setSuccessMessage(
                    `Участник создан. Пригласительная ссылка готова. Пароль по умолчанию: ${DEFAULT_MEMBER_PASSWORD}.`,
                  );
                })
              }
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Добавить участника
            </Button>
            {inviteUrl ? (
              <div className="rounded-[24px] border border-sky-100 bg-sky-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">Приглашение</p>
                <p className="mt-2 break-all text-sm text-sky-900">{inviteUrl}</p>
                <p className="mt-3 text-sm text-sky-900">
                  Пароль по умолчанию для нового участника: <span className="font-semibold">{DEFAULT_MEMBER_PASSWORD}</span>
                </p>
                <div className="mt-3">
                  <CopyButton text={inviteUrl} label="Скопировать ссылку" />
                </div>
              </div>
            ) : null}
            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {successMessage ? (
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>
            ) : null}
          </div>
        </Card>

        <Card className="border-slate-200 p-3">
          <div className="space-y-2">
            {localParticipants.map((participant) => (
              <button
                key={participant.id}
                type="button"
                onClick={() => setSelectedParticipantId(participant.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[22px] px-4 py-4 text-left transition",
                  selectedParticipant?.id === participant.id
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{participant.displayName || participant.email}</p>
                  <p className={cn("truncate text-xs", selectedParticipant?.id === participant.id ? "text-slate-300" : "text-slate-500")}>
                    {participant.email}
                  </p>
                </div>
                <Badge tone={toneForStatus(participant.status)}>{participant.status}</Badge>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Card className="border-slate-200 p-6">
        {selectedParticipant ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Права доступа</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">{selectedParticipant.displayName || selectedParticipant.email}</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                  Настройте права на каждый опрос. Разрешение на создание своих участников вынесено в отдельную кнопку и не смешивается с матрицей доступа.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  variant={participantAccessEnabled ? "primary" : "secondary"}
                  onClick={() =>
                    mutateSelected((_surveyId, row) => ({
                      ...row,
                      canCreate: !participantAccessEnabled,
                    }))
                  }
                >
                  Участники: {participantAccessEnabled ? "разрешены" : "запрещены"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    startTransition(async () => {
                      if (!confirm("Удалить участника? Опросы останутся доступны администратору.")) {
                        return;
                      }

                      const response = await fetch("/api/admin/participants", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: selectedParticipant.id }),
                      });
                      const payload = (await response.json()) as { error?: string };
                      if (!response.ok) {
                        setError(payload.error || "Не удалось удалить участника.");
                        return;
                      }

                      setLocalParticipants((current) =>
                        current.map((participant) =>
                          participant.id === selectedParticipant.id ? { ...participant, status: "DELETED" } : participant,
                        ),
                      );
                    })
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError("");
                      setSuccessMessage("");

                      const rows = Object.entries(selectedRows);
                      for (const [surveyId, permissions] of rows) {
                        const response = await fetch("/api/admin/permissions", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            userId: selectedParticipant.id,
                            surveyId,
                            ...permissions,
                          }),
                        });
                        const payload = (await response.json()) as { error?: string };
                        if (!response.ok) {
                          setError(payload.error || "Не удалось сохранить права.");
                          return;
                        }
                      }

                      setSuccessMessage("Права доступа сохранены.");
                    })
                  }
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Сохранить права
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  mutateSelected((_surveyId, _row) => ({
                    canView: true,
                    canCreate: _row.canCreate,
                    canEdit: true,
                    canDelete: true,
                    canResults: true,
                  }))
                }
              >
                Включить всё
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  mutateSelected((_surveyId, _row) => ({
                    canView: false,
                    canCreate: _row.canCreate,
                    canEdit: false,
                    canDelete: false,
                    canResults: false,
                  }))
                }
              >
                Очистить всё
              </Button>
              {permissionColumns.map((column) => (
                <Button
                  key={column.key}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    mutateSelected((_surveyId, row) => ({
                      ...row,
                      [column.key]: !Object.values(selectedRows).every((entry) => entry[column.key]),
                    }))
                  }
                >
                  {column.label}
                </Button>
              ))}
            </div>

            <div className="overflow-hidden rounded-[28px] border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Опрос</th>
                      {permissionColumns.map((column) => (
                        <th key={column.key} className="px-4 py-3 font-semibold">
                          {column.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 font-semibold">Строка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {surveys.map((survey) => {
                      const row = selectedRows[survey.id] ?? {
                        canView: false,
                        canCreate: false,
                        canEdit: false,
                        canDelete: false,
                        canResults: false,
                      };

                      return (
                        <tr key={survey.id} className="border-t border-slate-100">
                          <td className="px-4 py-4">
                            <p className="font-semibold text-slate-900">{survey.title}</p>
                          </td>
                          {permissionColumns.map((column) => (
                            <td key={column.key} className="px-4 py-4 text-center">
                              <input
                                type="checkbox"
                                checked={row[column.key]}
                                onChange={(event) =>
                                  setMatrix((current) => ({
                                    ...current,
                                    [selectedParticipant.id]: {
                                      ...current[selectedParticipant.id],
                                      [survey.id]: {
                                        ...current[selectedParticipant.id][survey.id],
                                        [column.key]: event.target.checked,
                                      },
                                    },
                                  }))
                                }
                                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              />
                            </td>
                          ))}
                          <td className="px-4 py-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setMatrix((current) => ({
                                  ...current,
                                  [selectedParticipant.id]: {
                                    ...current[selectedParticipant.id],
                                    [survey.id]: {
                                      canView: true,
                                      canCreate: current[selectedParticipant.id][survey.id]?.canCreate ?? false,
                                      canEdit: true,
                                      canDelete: true,
                                      canResults: true,
                                    },
                                  },
                                }))
                              }
                            >
                              Всё
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {successMessage ? (
              <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-slate-200 px-8 py-16 text-center text-slate-500">
            Добавьте первого участника, чтобы настроить права доступа.
          </div>
        )}
      </Card>
    </div>
  );
}
