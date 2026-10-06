/**
 * Worker entry point: `fetch` (Hono) + `scheduled` (retention sweep + Telegram
 * notification scan).
 */
import { runSweep } from './cron';
import { runNotifyScan } from './notify';
import { app } from './router';
import type { Env } from './types';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const counts = await runSweep(env);
          console.log('[vps-dog] sweep complete', JSON.stringify(counts));
        } catch (e: unknown) {
          console.error('[vps-dog] sweep failed:', e instanceof Error ? e.message : String(e));
        }
        try {
          const counts = await runNotifyScan(env);
          // Quiet unless something actually went out or failed, to keep
          // `wrangler tail` readable on the common no-alert path.
          if (counts.offline_sent > 0 || counts.online_sent > 0 || counts.send_failures > 0) {
            console.log('[vps-dog] notify scan', JSON.stringify(counts));
          }
        } catch (e: unknown) {
          console.error('[vps-dog] notify scan failed:', e instanceof Error ? e.message : String(e));
        }
      })(),
    );
  },
};

export { app };
