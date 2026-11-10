import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  AnalyticsQuerySchema,
  STUDIO_TOOL_NAMES,
  StudioModelResultSchema,
  StudioTurnRequestSchema,
} from '@intentlock/shared';
import type { StudioGenerator } from '../adapters/studio/gemini';
import { AppError, notFound } from '../errors';
import type { Logger } from '../logger';
import { rateLimit } from '../middleware/rateLimit';
import type { AnalyticsRepository } from '../repo/analytics';

export function studioRouter(
  analytics: AnalyticsRepository,
  enabled: boolean,
  generate: StudioGenerator | undefined,
  logger: Logger,
) {
  const router = Router();
  router.get('/analytics/dataset', rateLimit(120), async (req, res) => {
    const { days } = AnalyticsQuerySchema.parse(req.query);
    res.json(await analytics.dataset(req.sessionId, days));
  });
  const runs = new Map<string, { turns: number; expires: number }>();
  router.post(
    '/studio-agent/turn',
    (_req, _res, next) => {
      if (!enabled) throw notFound();
      next();
    },
    rateLimit(15),
    async (req, res) => {
      const input = StudioTurnRequestSchema.parse(req.body);
      const allowed = new Set<string>(STUDIO_TOOL_NAMES);
      const rejected = input.tools
        .filter((tool) => !allowed.has(tool.name))
        .map((tool) => tool.name);
      if (rejected.length) {
        await analytics.rejectedTools(req.sessionId, rejected);
        input.tools = input.tools.filter((tool) => allowed.has(tool.name));
      }
      if (!generate)
        throw new AppError(
          503,
          'AI_UNAVAILABLE',
          'Governance Analyst requires Gemini configuration.',
        );
      const now = Date.now();
      for (const [key, run] of runs) if (run.expires < now) runs.delete(key);
      const key = `${req.sessionId}:${input.threadId}:${input.runId ?? input.threadId}`;
      const run = runs.get(key) ?? { turns: 0, expires: now + 600_000 };
      if (run.turns >= 8)
        throw new AppError(409, 'TURN_LIMIT', 'The eight-turn dashboard run limit was reached.');
      if (!runs.has(key) && runs.size >= 10000)
        throw new AppError(503, 'AGENT_BUSY', 'Governance Analyst is busy. Please try later.');
      run.turns++;
      runs.set(key, run);
      const rows = (await analytics.dataset(req.sessionId, 90)).rows;
      const abort = new AbortController();
      const disconnect = () => abort.abort();
      res.on('close', disconnect);
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]);
      try {
        // Validate the entire model reply before streaming executable tool calls.
        const result = StudioModelResultSchema.parse(await generate(input, rows, signal));
        const offered = new Set(input.tools.map((t) => t.name));
        if (result.calls.some((c) => !offered.has(c.name)))
          throw new AppError(
            502,
            'INVALID_AGENT_OUTPUT',
            'The analyst requested an unavailable dashboard tool.',
          );
        if (signal.aborted)
          throw new AppError(504, 'UPSTREAM_TIMEOUT', 'Governance Analyst timed out.');
        res.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        const runId = input.runId ?? randomUUID();
        send({ type: 'RUN_STARTED', threadId: input.threadId, runId });
        if (result.text) {
          const messageId = randomUUID();
          send({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
          send({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: result.text });
          send({ type: 'TEXT_MESSAGE_END', messageId });
        }
        for (const call of result.calls) {
          const toolCallId = randomUUID();
          send({ type: 'TOOL_CALL_START', toolCallId, toolCallName: call.name });
          send({ type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify(call.args) });
          send({ type: 'TOOL_CALL_END', toolCallId });
        }
        send({ type: 'RUN_FINISHED', threadId: input.threadId, runId });
        res.end();
      } catch (error) {
        if (abort.signal.aborted) return;
        if (error instanceof AppError) throw error;
        logger.warn({ provider: 'ai', timeout: signal.aborted }, 'Governance Analyst failed');
        throw new AppError(
          signal.aborted ? 504 : 502,
          signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR',
          'Governance Analyst could not complete this turn.',
        );
      } finally {
        res.off('close', disconnect);
      }
    },
  );
  return router;
}
