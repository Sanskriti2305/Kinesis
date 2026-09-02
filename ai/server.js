const http = require('http');

const PORT = Number(process.env.AI_PORT || 8787);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const tools = [{
  type: 'function',
  function: {
    name: 'transform_selected_part',
    description: 'Apply a small design change to the currently selected 3D mesh. Use this for natural-language geometry manipulation.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scale', 'move', 'rotate'] },
        factor: { type: 'number', description: 'Multiplicative scale factor, e.g. 1.2 or 0.9.' },
        dx: { type: 'number', description: 'Normalized horizontal move amount, normally between -0.15 and 0.15.' },
        dy: { type: 'number', description: 'Normalized vertical move amount, normally between -0.15 and 0.15.' },
        dz: { type: 'number', description: 'Normalized depth move amount, normally between -0.15 and 0.15.' },
        rx: { type: 'number', description: 'Rotation in degrees around X.' },
        ry: { type: 'number', description: 'Rotation in degrees around Y.' },
        rz: { type: 'number', description: 'Rotation in degrees around Z.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
}];

function fallback(command) {
  const c = command.toLowerCase();
  const pct = c.match(/(\d+(?:\.\d+)?)\s*%/);
  const p = pct ? Number(pct[1]) / 100 : 0.1;
  if (/(increase|enlarge|bigger|grow|expand).*(size|scale)|size.*(increase|bigger)/.test(c)) {
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'scale', factor: 1 + p } }, explanation: `I increased the selected part by ${Math.round(p * 100)}%.` };
  }
  if (/(decrease|reduce|smaller|shrink|scale down).*(size|scale)|size.*(decrease|smaller)/.test(c)) {
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'scale', factor: 1 - p } }, explanation: `I reduced the selected part by ${Math.round(p * 100)}%.` };
  }
  if (/right/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0.04, dy: 0, dz: 0 } }, explanation: 'I moved the selected part slightly to the right.' };
  if (/left/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: -0.04, dy: 0, dz: 0 } }, explanation: 'I moved the selected part slightly to the left.' };
  if (/up|higher/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: -0.04, dz: 0 } }, explanation: 'I moved the selected part slightly upward.' };
  if (/down|lower/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: 0.04, dz: 0 } }, explanation: 'I moved the selected part slightly downward.' };
  return { explanation: 'Try commands such as “increase the selected part by 20%”, “make it smaller by 10%”, or “move it to the right”.' };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(payload);
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'POST' || req.url !== '/api/ai/command') return json(res, 404, { error: 'Not found' });
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const command = String(body.command || '').trim();
      if (!command) return json(res, 400, { error: 'Command is required.' });

      if (!API_KEY) return json(res, 200, fallback(command));

      const system = `You are Kinesis, an AI design assistant for a 3D engineering workspace. The UI already has a selected mesh. Convert the user's request into ONE safe, small transform_selected_part function call when possible. Never invent a part selection. Keep moves small. For percentage size changes, use factor 1 + percentage or 1 - percentage. Then briefly explain what changed. Selected part: ${JSON.stringify(body.selected || null)}`;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: command }], tools, tool_choice: 'auto' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status})`);
      const message = data.choices?.[0]?.message;
      const call = message?.tool_calls?.[0];
      if (!call) return json(res, 200, { explanation: message?.content || 'I could not map that request to a model change.' });
      return json(res, 200, { toolCall: { name: call.function.name, arguments: JSON.parse(call.function.arguments || '{}') }, explanation: message.content || 'Applied the requested design change.' });
    } catch (err) {
      return json(res, 500, { error: err.message || 'AI service error.' });
    }
  });
}

http.createServer(handle).listen(PORT, () => console.log(`[kinesis-ai] listening on http://localhost:${PORT}`));
