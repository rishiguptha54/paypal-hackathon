import { clientToolRunner, createAiHarness, type AgAiAgentRun, type AgAiHarnessSetup } from 'ag-studio';
import { ErrorEnvelopeSchema, STUDIO_TOOL_NAMES, StudioEventSchema } from '@intentlock/shared';

const allowed = new Set<string>(STUDIO_TOOL_NAMES);

export const runStudioTurn: AgAiAgentRun = async function* (input, ctx) {
  const tools = input.tools.filter((t) => allowed.has(t.name) && (!t.kind || t.kind === 'client'));
  const response = await fetch('/api/studio-agent/turn', {
    method: 'POST', credentials: 'same-origin', signal: ctx.signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      threadId: input.threadId, runId: input.runId,
      messages: [
        { id: 'dashboard-instructions', role: 'system', content: ctx.instructions() ?? '' },
        ...input.messages,
      ],
      tools,
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    const parsed = ErrorEnvelopeSchema.safeParse(body);
    throw new Error(parsed.success ? `${parsed.data.error.code}: ${parsed.data.error.message}`
      : `Governance Analyst returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error('Governance Analyst returned no event stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) yield StudioEventSchema.parse(JSON.parse(line.slice(6)));
        }
      }
      if (done) {
        if (buffer.trim()) throw new Error('Governance Analyst stream ended mid-event.');
        break;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};

export const governanceAi: AgAiHarnessSetup = ({ api }) => createAiHarness(api, ({ builtIn }) => ({
  primary: 'lead',
  agents: Object.values(builtIn).map((definition) => clientToolRunner({
    ...definition, maxTurns: 8, run: runStudioTurn,
    tools: (ctx, params) => (definition.tools?.(ctx, params) ?? []).filter((tool) => allowed.has(tool.name)),
  })),
  promptStarters: [
    { label: 'Explain blocks', prompt: 'Why were offers blocked? Add a widget showing blocks by primary reason.' },
    { label: 'Capture integrity', prompt: 'Show capture blocks by reason and explain the Mandate Integrity & MCP Gate.' },
    { label: 'MCP outcomes', prompt: 'Add a widget comparing MCP outcomes, clearly separating sample data.' },
  ],
}));
