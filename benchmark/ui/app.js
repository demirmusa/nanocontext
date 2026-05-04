const state = {
  runs: [],
  filteredRuns: [],
  selectedRunId: null,
  focusedCondition: null,
};

const pickFolderButton = document.querySelector('#pick-folder-button');
const folderStatus = document.querySelector('#folder-status');
const runFilter = document.querySelector('#run-filter');
const runList = document.querySelector('#run-list');
const aggregateEmpty = document.querySelector('#aggregate-empty');
const aggregateContent = document.querySelector('#aggregate-content');
const aggregateTableBody = document.querySelector('#aggregate-table tbody');
const selectedRunEmpty = document.querySelector('#selected-run-empty');
const selectedRunContent = document.querySelector('#selected-run-content');
const selectedRunTitle = document.querySelector('#selected-run-title');
const selectedRunMeta = document.querySelector('#selected-run-meta');
const selectedRunCards = document.querySelector('#selected-run-cards');
const selectedRunConditions = document.querySelector('#selected-run-conditions');
const conditionTemplate = document.querySelector('#condition-template');

pickFolderButton?.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    folderStatus.textContent = 'This UI needs a Chromium browser with File System Access support.';
    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker();
    folderStatus.textContent = `Loading runs from ${directoryHandle.name}...`;
    const runs = await loadRunsFromDirectory(directoryHandle);
    state.runs = runs.sort((a, b) => b.runId.localeCompare(a.runId));
    state.filteredRuns = [...state.runs];
    state.selectedRunId = state.filteredRuns[0]?.runId ?? null;
    state.focusedCondition = null;
    folderStatus.textContent = `${state.runs.length} run(s) loaded from ${directoryHandle.name}.`;
    renderAll();
  } catch (error) {
    folderStatus.textContent = `Folder selection failed: ${error.message}`;
  }
});

runFilter?.addEventListener('input', () => {
  const query = runFilter.value.trim().toLowerCase();
  state.filteredRuns = state.runs.filter((run) => {
    return [
      run.runId,
      run.benchmarkId,
      run.repository,
      run.taskKey,
    ].some((value) => (value || '').toLowerCase().includes(query));
  });

  if (!state.filteredRuns.some((run) => run.runId === state.selectedRunId)) {
    state.selectedRunId = state.filteredRuns[0]?.runId ?? null;
    state.focusedCondition = null;
  }

  renderRunList();
  renderAggregate();
  renderSelectedRun();
});

function renderAll() {
  renderRunList();
  renderAggregate();
  renderSelectedRun();
}

function renderRunList() {
  runList.innerHTML = '';

  if (!state.filteredRuns.length) {
    runList.innerHTML = '<div class="empty-state">No runs match the current filter.</div>';
    return;
  }

  for (const run of state.filteredRuns) {
    const button = document.createElement('button');
    button.className = `run-button${run.runId === state.selectedRunId ? ' active' : ''}`;
    button.innerHTML = `
      <strong>${escapeHtml(run.runId)}</strong>
      <span>${escapeHtml(run.repository)} · ${escapeHtml(run.taskKey)} · ${formatTimestamp(run.completedAt)}</span>
      <span>${escapeHtml(run.benchmarkId)}</span>
    `;
    button.addEventListener('click', () => {
      state.selectedRunId = run.runId;
      state.focusedCondition = null;
      renderRunList();
      renderSelectedRun();
    });
    runList.appendChild(button);
  }
}

function renderAggregate() {
  if (!state.runs.length) {
    aggregateEmpty.classList.remove('hidden');
    aggregateContent.classList.add('hidden');
    return;
  }

  aggregateEmpty.classList.add('hidden');
  aggregateContent.classList.remove('hidden');

  aggregateTableBody.innerHTML = '';

  for (const run of state.filteredRuns) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(run.benchmarkId)}<br><span class="tiny">${escapeHtml(run.repository)} · ${escapeHtml(run.taskKey)}</span></td>
      <td>${escapeHtml(run.runId)}<br><span class="tiny">${formatTimestamp(run.completedAt)}</span></td>
      <td>${formatPercent(tokenSavingsRatio(run.conditions.baseline?.usage, run.conditions.nanocontext?.usage))}</td>
      <td>${formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions.nanocontext?.usage))}</td>
      <td>${formatPercent(tokenSavingsRatio(run.conditions.baseline?.usage, run.conditions['nanocontext-smartsearch']?.usage))}</td>
      <td>${formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions['nanocontext-smartsearch']?.usage))}</td>
      <td>${formatPercent(tokenSavingsRatio(run.conditions.nanocontext?.usage, run.conditions['nanocontext-smartsearch']?.usage))}</td>
    `;
    row.addEventListener('click', () => {
      state.selectedRunId = run.runId;
      state.focusedCondition = null;
      renderRunList();
      renderSelectedRun();
    });
    aggregateTableBody.appendChild(row);
  }
}

function renderSelectedRun() {
  const run = state.runs.find((item) => item.runId === state.selectedRunId);
  if (!run) {
    state.focusedCondition = null;
    selectedRunEmpty.classList.remove('hidden');
    selectedRunContent.classList.add('hidden');
    return;
  }

  selectedRunEmpty.classList.add('hidden');
  selectedRunContent.classList.remove('hidden');

  selectedRunTitle.textContent = run.runId;
  selectedRunMeta.innerHTML = '';
  [
    `${run.repository}`,
    `${run.taskKey}`,
    `${formatTimestamp(run.completedAt)}`,
  ].forEach((label) => selectedRunMeta.appendChild(createBadge(label)));

  selectedRunCards.innerHTML = '';
  [
    ['NC Token Savings', formatPercent(tokenSavingsRatio(run.conditions.baseline?.usage, run.conditions.nanocontext?.usage)), 'baseline total token reduction'],
    ['NC Non-Cached Savings', formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions.nanocontext?.usage)), 'cached input excluded'],
    ['SmartSearch Token Savings', formatPercent(tokenSavingsRatio(run.conditions.baseline?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'baseline total token reduction'],
    ['SmartSearch Non-Cached Savings', formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'cached input excluded'],
    ['Smart vs NC Gain', formatPercent(tokenSavingsRatio(run.conditions.nanocontext?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'extra reduction vs normal NC'],
    ['Smart vs NC Non-Cached Gain', formatPercent(nonCachedDeltaRatio(run.conditions.nanocontext?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'cached input excluded'],
  ].forEach(([label, value, subtext]) => {
    selectedRunCards.appendChild(createMetricCard(label, value, subtext));
  });

  selectedRunConditions.innerHTML = '';
  selectedRunConditions.classList.toggle('focus-mode', Boolean(state.focusedCondition));
  for (const conditionName of ['baseline', 'nanocontext', 'nanocontext-smartsearch']) {
    const summary = run.conditions[conditionName];
    if (!summary) continue;
    selectedRunConditions.appendChild(renderConditionPanel(conditionName, summary));
  }
}

async function loadRunsFromDirectory(directoryHandle) {
  const runs = [];

  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'directory') continue;
    const run = await loadRunDirectory(entry);
    if (run) runs.push(run);
  }

  return runs;
}

async function loadRunDirectory(runDirectoryHandle) {
  const comparison = await readJsonIfExists(runDirectoryHandle, 'comparison.json');
  const baseline = await readJsonIfExists(runDirectoryHandle, 'baseline/summary.json');
  const nanocontext = await readJsonIfExists(runDirectoryHandle, 'nanocontext/summary.json');
  const smartsearch = await readJsonIfExists(runDirectoryHandle, 'nanocontext-smartsearch/summary.json');

  if (!comparison && !baseline && !nanocontext && !smartsearch) {
    return null;
  }

  return {
    runId: comparison?.runId || baseline?.runId || nanocontext?.runId || smartsearch?.runId || runDirectoryHandle.name,
    benchmarkId: comparison?.benchmarkId || baseline?.benchmarkId || nanocontext?.benchmarkId || smartsearch?.benchmarkId || 'unknown',
    repository: comparison?.repository || baseline?.repository || nanocontext?.repository || smartsearch?.repository || 'unknown',
    taskKey: comparison?.taskKey || baseline?.taskKey || nanocontext?.taskKey || smartsearch?.taskKey || 'unknown',
    completedAt: baseline?.completedAt || nanocontext?.completedAt || smartsearch?.completedAt || '',
    comparison,
    conditions: {
      baseline,
      nanocontext,
      'nanocontext-smartsearch': smartsearch,
    },
  };
}

async function readJsonIfExists(rootHandle, relativePath) {
  try {
    const fileHandle = await getFileHandleByPath(rootHandle, relativePath);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getFileHandleByPath(rootHandle, relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  let currentHandle = rootHandle;

  for (let index = 0; index < parts.length - 1; index += 1) {
    currentHandle = await currentHandle.getDirectoryHandle(parts[index]);
  }

  return currentHandle.getFileHandle(parts.at(-1));
}

function renderConditionPanel(conditionName, summary) {
  const fragment = conditionTemplate.content.cloneNode(true);
  const panel = fragment.querySelector('.condition-panel');
  panel.dataset.condition = conditionName;
  panel.classList.toggle('focused', state.focusedCondition === conditionName);

  fragment.querySelector('.condition-eyebrow').textContent = summary.repository || 'Condition';
  fragment.querySelector('.condition-title').textContent = conditionName;

  const badges = fragment.querySelector('.condition-badges');
  badges.appendChild(createBadge(`Exit ${summary.exitCode}`, summary.exitCode === 0 ? 'good' : 'bad'));
  if (!hasUsage(summary.usage)) {
    badges.appendChild(createBadge('No usage', 'warn'));
  }
  badges.appendChild(createBadge(`${formatNumber(totalTokens(summary.usage))} tokens`));
  badges.appendChild(createBadge(`${formatNumber(summary.durationMs)} ms`));

  const expandButton = fragment.querySelector('.panel-expand-button');
  expandButton.textContent = state.focusedCondition === conditionName ? 'Show All' : 'Focus';
  expandButton.addEventListener('click', () => {
    state.focusedCondition = state.focusedCondition === conditionName ? null : conditionName;
    renderSelectedRun();
  });

  const metrics = fragment.querySelector('.condition-metrics');
  [
    ['Input Tokens', formatNumber(summary.usage?.input_tokens)],
    ['Cached Input', formatNumber(summary.usage?.cached_input_tokens)],
    ['Output Tokens', formatNumber(summary.usage?.output_tokens)],
    ['Commands', formatNumber(summary.commands?.length || 0)],
    ['File Changes', formatNumber(summary.fileChanges?.length || 0)],
    ['Messages', formatNumber(summary.consoleMessages?.length || 0)],
  ].forEach(([label, value]) => metrics.appendChild(createMiniMetric(label, value)));

  fragment.querySelector('.final-answer').textContent = sanitizeTerminalText(summary.finalAnswer || '(empty)');

  const commandList = fragment.querySelector('.command-list');
  if (summary.commands?.length) {
    summary.commands.forEach((command) => {
      const element = document.createElement('pre');
      element.className = 'command-item';
      element.textContent = sanitizeTerminalText(`${command.command}\n\nExit: ${command.exitCode}\n\n${command.output || ''}`.trim());
      commandList.appendChild(element);
    });
  } else {
    commandList.innerHTML = '<div class="empty-state">No command records.</div>';
  }

  const messageList = fragment.querySelector('.message-list');
  if (summary.consoleMessages?.length) {
    summary.consoleMessages.forEach((message) => {
      const element = document.createElement('pre');
      element.className = 'message-item';
      element.textContent = sanitizeTerminalText(message.text || '');
      messageList.appendChild(element);
    });
  } else {
    messageList.innerHTML = '<div class="empty-state">No console messages.</div>';
  }

  const logList = fragment.querySelector('.log-list');
  [
    ['Prompt Path', summary.promptPath],
    ['Events Path', summary.eventsPath],
    ['Stdout Path', summary.stdoutPath],
    ['Stderr Path', summary.stderrPath],
    ['Command Path', summary.commandPath],
    ['Run Events', summary.runEventsPath],
    ['Condition Events', summary.conditionEventsPath],
  ].forEach(([label, value]) => {
    const element = document.createElement('pre');
    element.className = 'log-item';
    element.textContent = `${label}\n${value || '(missing)'}`;
    logList.appendChild(element);
  });

  return fragment;
}

function createMetricCard(label, value, subtext) {
  const card = document.createElement('div');
  card.className = 'metric-card';
  card.innerHTML = `
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${escapeHtml(value)}</div>
    <div class="subtext">${escapeHtml(subtext || '')}</div>
  `;
  return card;
}

function createMiniMetric(label, value) {
  const card = document.createElement('div');
  card.className = 'mini-metric';
  card.innerHTML = `
    <div class="mini-label">${escapeHtml(label)}</div>
    <div class="mini-value">${escapeHtml(value)}</div>
  `;
  return card;
}

function createBadge(label, variant = '') {
  const badge = document.createElement('span');
  badge.className = `badge ${variant}`.trim();
  badge.textContent = label;
  return badge;
}

function totalTokens(usage) {
  if (!hasUsage(usage)) return null;
  return Number(usage.input_tokens) + Number(usage.output_tokens);
}

function nonCachedTokens(usage) {
  if (!hasUsage(usage)) return null;
  return Math.max(0, Number(usage.input_tokens) - safeNumber(usage.cached_input_tokens)) + Number(usage.output_tokens);
}

function tokenSavingsRatio(baselineUsage, comparedUsage) {
  return deltaRatioOrNull(totalTokens(baselineUsage), totalTokens(comparedUsage));
}

function nonCachedSavingsRatio(baselineUsage, comparedUsage) {
  return deltaRatioOrNull(nonCachedTokens(baselineUsage), nonCachedTokens(comparedUsage));
}

function nonCachedDeltaRatio(baseUsage, improvedUsage) {
  return deltaRatioOrNull(nonCachedTokens(baseUsage), nonCachedTokens(improvedUsage));
}

function deltaRatioOrNull(base, compared) {
  if (!Number.isFinite(base) || !Number.isFinite(compared)) {
    return null;
  }
  return ratioOrNull(base - compared, base);
}

function hasUsage(usage) {
  return Boolean(usage)
    && Number.isFinite(Number(usage.input_tokens))
    && Number.isFinite(Number(usage.output_tokens));
}

function ratioOrNull(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function formatTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sanitizeTerminalText(value) {
  return normalizeMojibake(String(value ?? '')
    .replaceAll(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(/\u001b[@-_]/g, '')
    .replaceAll(/[\u0000-\u0008\u000b-\u001a\u007f-\u009f]/g, ''));
}

function normalizeMojibake(value) {
  return value
    .replaceAll('Γöé', '│')
    .replaceAll('â”‚', '│')
    .replaceAll('â”€', '─')
    .replaceAll('â”œ', '├')
    .replaceAll('â””', '└')
    .replaceAll('â”¬', '┬')
    .replaceAll('â”¼', '┼')
    .replaceAll('â†’', '→')
    .replaceAll('∩╗┐', '')
    .replaceAll('ï»¿', '')
    .replaceAll(/\uFEFF/g, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
