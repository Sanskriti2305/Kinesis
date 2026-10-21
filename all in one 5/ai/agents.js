const AGENTS = {
  design: {
    name: 'Design Agent',
    purpose: 'Translate natural-language design requests into safe model transformations or workspace actions.'
  },
  simulation: {
    name: 'Simulation Agent',
    purpose: 'Evaluate the effect of a proposed design change using the live lightweight simulation state.'
  },
  analysis: {
    name: 'Analysis Agent',
    purpose: 'Explain the design change, trade-offs, and safety implications in plain language.'
  },
  material: {
    name: 'Material Agent',
    purpose: 'Suggest a suitable engineering material when the user asks about material, strength, weight, cost, or temperature.'
  },
  documentation: {
    name: 'Documentation Agent',
    purpose: 'Create concise change-log style summaries of the design decision.'
  }
};

function chooseAgentChain(command) {
  const c = command.toLowerCase();
  const chain = [];
  const add = (id) => { if (!chain.includes(id)) chain.push(id); };

  if (/(material|aluminium|aluminum|titanium|steel|plastic|alloy|strength|weight|cost|temperature)/.test(c)) add('material');
  if (/(stress|simulation|thermal|mass|safe|safety|load|optimi[sz]e)/.test(c)) add('simulation');
  if (/(why|explain|analyse|analyze|trade.?off|impact|problem|risk)/.test(c)) add('analysis');
  if (/(document|summary|summari[sz]e|change log|log this)/.test(c)) add('documentation');

  // Geometry-changing requests always start with Design, then optionally
  // hand off to Simulation and Analysis so Phase 5 is visible in the demo.
  if (/(increase|decrease|reduce|smaller|bigger|enlarge|shrink|grow|scale|move|left|right|up|down|forward|backward|rotate|turn|clockwise|counter.?clockwise|explode|section|measure|reset)/.test(c)) {
    chain.unshift('design');
    add('simulation');
    add('analysis');
  }

  if (chain.length === 0) chain.push('analysis');
  return chain;
}

function buildSystemPrompt(chain, selected) {
  const roles = chain.map((id) => `${AGENTS[id].name}: ${AGENTS[id].purpose}`).join('\n');
  return `You are the Kinesis Phase 5 orchestrator. Coordinate these specialized agents in order:\n${roles}\n\nThe UI already has the selected mesh below. Never invent a different selection. Convert the user's request into ONE safe, small workspace action when possible. Supported geometry actions are scale, move, rotate, explode, section, measure, and reset. For geometry changes, return a transform_selected_part tool call. Keep movement small (normally <= 0.15 per axis per command). For percentage size changes, use a multiplicative factor. For rotation, use degrees. If the user asks for a workspace action such as explode/section/measure/reset, use the matching action. If the request is informational, return a concise explanation without a tool call.\n\nSelected part: ${JSON.stringify(selected || null)}`;
}

module.exports = { AGENTS, chooseAgentChain, buildSystemPrompt };
