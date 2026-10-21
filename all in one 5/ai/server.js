const http = require('http');
const { AGENTS, chooseAgentChain, buildSystemPrompt } = require('./agents');

const PORT = Number(process.env.AI_PORT || 8787);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const tools = [{
  type: 'function',
  function: {
    name: 'transform_selected_part',
    description: 'Apply one safe workspace/design action to the currently selected 3D part.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['scale', 'move', 'rotate', 'explode', 'section', 'measure', 'reset'] },
        factor: { type: 'number', description: 'Multiplicative scale factor, e.g. 1.2 or 0.9.' },
        dx: { type: 'number', description: 'Move amount along camera-right/local X. Normally between -0.15 and 0.15.' },
        dy: { type: 'number', description: 'Move amount vertically. Normally between -0.15 and 0.15.' },
        dz: { type: 'number', description: 'Move amount in depth. Normally between -0.15 and 0.15.' },
        rx: { type: 'number', description: 'Rotation in degrees around X.' },
        ry: { type: 'number', description: 'Rotation in degrees around Y.' },
        rz: { type: 'number', description: 'Rotation in degrees around Z.' },
        explodeFactor: { type: 'number', description: 'Explode amount from 0 to 1.' },
        sectionAxis: { type: 'string', enum: ['x', 'y', 'z'] },
        sectionEnabled: { type: 'boolean' },
        measureEnabled: { type: 'boolean' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
}];

function percent(command) {
  const m = command.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|percentage)/i);
  return m ? Number(m[1]) / 100 : 0.1;
}

function moveAmount(command) {
  const m = command.match(/(?:by|of|amount)\s*(-?\d+(?:\.\d+)?)/);
  const n = m ? Number(m[1]) : 0.04;
  return Math.max(-0.15, Math.min(0.15, n));
}

function fallback(command) {
  const c = command.toLowerCase();
  const p = percent(command);
  const step = moveAmount(command);

  if (/(increase|enlarge|bigger|grow|expand|scale up|make .*bigger|make .*larger).*(size|scale)?|size.*(increase|bigger|larger)|make it bigger|make it larger/.test(c)) {
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'scale', factor: 1 + p } }, explanation: `I increased the selected part by ${Math.round(p * 100)}%.` };
  }
  if (/(decrease|reduce|smaller|shrink|scale down|make .*smaller|make .*smaller).*(size|scale)?|size.*(decrease|smaller)|make it smaller|make it reduce/.test(c)) {
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'scale', factor: Math.max(0.2, 1 - p) } }, explanation: `I reduced the selected part by ${Math.round(p * 100)}%.` };
  }
  if (/reset|restore.*original|undo.*transform/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'reset' } }, explanation: 'I restored the selected part to its original transform.' };
  if (/explode/.test(c)) {
    const factor = /(?:half|50)/.test(c) ? 0.5 : /(?:full|maximum|max|100)/.test(c) ? 1 : 0.7;
    if (/(reduce|decrease|less|close|collapse)/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'explode', explodeFactor: 0 } }, explanation: 'I reduced the assembly explode view.' };
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'explode', explodeFactor: factor } }, explanation: `I set the assembly explode view to ${Math.round(factor * 100)}%.` };
  }
  if (/section|cutaway|cross.?section/.test(c)) {
    const axis = /\by\b/.test(c) ? 'y' : /\bz\b/.test(c) ? 'z' : 'x';
    const enabled = !/(disable|off|remove|hide)/.test(c);
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'section', sectionAxis: axis, sectionEnabled: enabled } }, explanation: `${enabled ? 'I enabled' : 'I disabled'} the ${axis.toUpperCase()}-axis section view.` };
  }
  if (/measure|measurement|distance/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'measure', measureEnabled: true } }, explanation: 'I enabled the measure tool. Pick two points on the model to measure their distance.' };
  if (/right/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: step, dy: 0, dz: 0 } }, explanation: 'I moved the selected part to the right.' };
  if (/left/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: -step, dy: 0, dz: 0 } }, explanation: 'I moved the selected part to the left.' };
  if (/up|higher/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: step, dz: 0 } }, explanation: 'I moved the selected part upward.' };
  if (/down|lower/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: -step, dz: 0 } }, explanation: 'I moved the selected part downward.' };
  if (/forward|toward me|closer/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: 0, dz: step } }, explanation: 'I moved the selected part forward.' };
  if (/backward|away from me|back/.test(c)) return { toolCall: { name: 'transform_selected_part', arguments: { action: 'move', dx: 0, dy: 0, dz: -step } }, explanation: 'I moved the selected part backward.' };
  if (/rotate|turn|spin/.test(c)) {
    const deg = Number((c.match(/(-?\d+(?:\.\d+)?)\s*(?:degrees|degree|deg)/) || [])[1]) || 15;
    const signed = /counter.?clockwise|anticlockwise/.test(c) ? -deg : deg;
    const axis = /\bx\b|around x/.test(c) ? 'rx' : /\bz\b|around z/.test(c) ? 'rz' : 'ry';
    return { toolCall: { name: 'transform_selected_part', arguments: { action: 'rotate', rx: axis === 'rx' ? signed : 0, ry: axis === 'ry' ? signed : 0, rz: axis === 'rz' ? signed : 0 } }, explanation: `I rotated the selected part ${Math.abs(signed)}° ${signed < 0 ? 'counter-clockwise' : 'clockwise'} around ${axis.slice(1).toUpperCase()}.` };
  }
  if (/(material|aluminium|aluminum|titanium|steel|plastic|alloy)/.test(c)) {
    return { explanation: 'Material Agent: For a lightweight engineering part, aluminum is a strong baseline when cost and manufacturability matter. Titanium is a higher-cost option when strength-to-weight is the priority; steel is useful when stiffness, durability, or low material cost dominates. Treat this as a design recommendation, not a certified material-selection result.' };
  }
  if (/(document|documentation|summary|summarize|change log|log this)/.test(c)) {
    return { explanation: 'Documentation Agent: Design change recorded — the requested Kinesis workspace action was analyzed and applied where applicable. Session note: verify the simulation result after the change before finalizing the design.' };
  }
  if (/(stress|simulation|thermal|mass|safe|safety|load)/.test(c)) {
    return { explanation: 'Simulation Agent + Analysis Agent: Kinesis can recalculate its lightweight mass/stress proxy immediately after geometry changes. Use the Live Simulation panel to review mass, stress index, maximum stress, and safety status. These values are demo proxies, not certified FEA.' };
  }
  return { explanation: 'Try commands such as “make it bigger by 20%”, “make it smaller by 10%”, “move it left”, “move it backward”, “rotate 30 degrees around Y”, “explode the assembly”, “enable X section”, “measure this”, “suggest a material”, “summarize the change”, or “reset the part”.' };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/api/ai/health') return json(res, 200, { ok: true, service: 'kinesis-ai', mode: API_KEY ? 'openai' : 'local-fallback' });
  if (req.method !== 'POST' || req.url !== '/api/ai/command') return json(res, 404, { error: 'Not found' });
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const command = String(body.command || '').trim();
      if (!command) return json(res, 400, { error: 'Command is required.' });
      const chain = chooseAgentChain(command);
      const agentChain = chain.map((id) => ({ id, name: AGENTS[id].name }));

      if (!API_KEY) return json(res, 200, { ...fallback(command), agentChain });

      const system = buildSystemPrompt(chain, body.selected);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: command }], tools, tool_choice: 'auto' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status})`);
      const message = data.choices?.[0]?.message;
      const call = message?.tool_calls?.[0];
      if (!call) return json(res, 200, { explanation: message?.content || 'The agents could not map that request to an action.', agentChain });
      return json(res, 200, { toolCall: { name: call.function.name, arguments: JSON.parse(call.function.arguments || '{}') }, explanation: message.content || 'The orchestrated agents processed the request.', agentChain });
    } catch (err) {
      return json(res, 500, { error: err.message || 'AI service error.' });
    }
  });
}

http.createServer(handle).listen(PORT, () => console.log(`[kinesis-ai] Phase 5 orchestrator listening on http://localhost:${PORT}`));
