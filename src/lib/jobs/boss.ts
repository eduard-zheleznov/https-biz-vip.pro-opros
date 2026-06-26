import { PgBoss } from "pg-boss";

import { env } from "@/lib/env";
import { ARCHIVE_PURGE_QUEUE, RESPONSE_NOTIFICATION_QUEUE, RESPONSE_TIMEOUT_QUEUE } from "@/lib/jobs/queues";

const globalForBoss = globalThis as unknown as {
  pgBoss?: PgBoss;
  pgBossPromise?: Promise<PgBoss>;
};

async function ensureQueue(boss: PgBoss, name: string) {
  const queue = await boss.getQueue(name);
  if (!queue) {
    await boss.createQueue(name);
  }
}

export async function getBoss() {
  if (globalForBoss.pgBossPromise) {
    return globalForBoss.pgBossPromise;
  }

  globalForBoss.pgBossPromise = (async () => {
    const boss = new PgBoss(env.DATABASE_URL);
    boss.on("error", (error) => {
      console.error("pg-boss error", error);
    });

    await boss.start();
    await ensureQueue(boss, RESPONSE_NOTIFICATION_QUEUE);
    await ensureQueue(boss, RESPONSE_TIMEOUT_QUEUE);
    await ensureQueue(boss, ARCHIVE_PURGE_QUEUE);
    await boss.schedule(RESPONSE_TIMEOUT_QUEUE, "* * * * *", { sweep: true }, { key: "response-timeout-sweep" });
    await boss.schedule(ARCHIVE_PURGE_QUEUE, "0 3 * * *", {});
    globalForBoss.pgBoss = boss;
    return boss;
  })();

  return globalForBoss.pgBossPromise;
}
