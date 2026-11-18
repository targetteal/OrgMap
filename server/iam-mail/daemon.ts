import pg from "pg";
import { assertManagedDispatchTarget } from "../src/managed-dispatch-target.js";
export type MailHandlers = {
  account: () => Promise<unknown>;
  invitation: (organizationId: string) => Promise<unknown>;
  enrollment: (organizationId: string) => Promise<unknown>;
  admission?: (organizationId: string) => Promise<unknown>;
};
export function createIamMailDaemon(dispatch: pg.Pool, handlers: MailHandlers) {
  let running = false;
  return {
    async tick() {
      await assertManagedDispatchTarget(dispatch);
      if (running) return;
      running = true;
      try {
        const scopes = (await dispatch.query("SELECT * FROM iam_mail_claim()"))
          .rows;
        for (const scope of scopes) {
          const args = [scope.kind, scope.organization_id, scope.lease_token];
          let alive = true;
          const heartbeat = setInterval(() => {
            void dispatch
              .query("SELECT iam_mail_heartbeat($1,$2,$3) AS alive", args)
              .then((r) => {
                alive = Boolean(r.rows[0].alive);
              })
              .catch(() => {
                alive = false;
              });
          }, 20000);
          try {
            if (!alive) continue;
            if (scope.kind === "ACCOUNT") await handlers.account();
            else if (scope.kind === "INVITATION")
              await handlers.invitation(scope.organization_id);
            else if (scope.kind === "ENROLLMENT")
              await handlers.enrollment(scope.organization_id);
            else if (scope.kind === "ADMISSION" && handlers.admission)
              await handlers.admission(scope.organization_id);
            else throw Error("UNKNOWN_MAIL_KIND");
          } finally {
            clearInterval(heartbeat);
            await dispatch.query("SELECT iam_mail_release($1,$2,$3)", args);
          }
        }
      } finally {
        running = false;
      }
    },
  };
}
