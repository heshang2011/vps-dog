/**
 * Worker entry point: `fetch` (Hono) + `scheduled` (retention/offline sweep).
 */
import { runSweep } from './cron';
import { app } from './router';
import type { Env } from './types';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runSweep(env).then(
        (counts) => {
          console.log('[vps-dog] sweep complete', JSON.stringify(counts));
        },
        (e: unknown) => {
          console.error('[vps-dog] sweep failed:', e instanceof Error ? e.message : String(e));
        },
      ),
    );
  },
};

export { app };
