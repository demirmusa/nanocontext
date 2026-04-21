const state = {
  runs: [],
  filteredRuns: [],
  selectedRunId: null,
};

const pickFolderButton = document.querySelector('#pick-folder-button');
const folderStatus = document.querySelector('#folder-status');
const runFilter = document.querySelector('#run-filter');
const runList = document.querySelector('#run-list');
const aggregateEmpty = document.querySelector('#aggregate-empty');
const aggregateContent = document.querySelector('#aggregate-content');
const aggregateCards = document.querySelector('#aggregate-cards');
const aggregateBadges = document.querySelector('#aggregate-badges');
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
  }

  renderRunList();
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
    aggregateBadges.innerHTML = '';
    return;
  }

  aggregateEmpty.classList.add('hidden');
  aggregateContent.classList.remove('hidden');

  const analytics = buildAggregateAnalytics(state.runs);
  aggregateBadges.innerHTML = '';
  aggregateCards.innerHTML = '';
  aggregateTableBody.innerHTML = '';

  const badgeItems = [
    `${analytics.totalRuns} total runs`,
    `${analytics.totalTasks} unique tasks`,
    `${analytics.totalRepositories} repos`,
  ];
  badgeItems.forEach((label) => aggregateBadges.appendChild(createBadge(label)));

  [
    ['NC Avg Token Savings', formatPercent(analytics.nanocontext.avgSavingsRatio), 'baseline total token spend reduction'],
    ['NC Avg Non-Cached Savings', formatPercent(analytics.nanocontext.avgNonCachedSavingsRatio), 'baseline spend excluding cached input'],
    ['SmartSearch Avg Token Savings', formatPercent(analytics.smartsearch.avgSavingsRatio), 'baseline total token spend reduction'],
    ['SmartSearch Avg Non-Cached Savings', formatPercent(analytics.smartsearch.avgNonCachedSavingsRatio), 'baseline spend excluding cached input'],
    ['Smart vs NC Gain', formatPercent(analytics.smartsearch.avgSavingsVsNanoRatio), 'extra reduction vs normal NC'],
    ['Smart vs NC Non-Cached Gain', formatPercent(analytics.smartsearch.avgNonCachedSavingsVsNanoRatio), 'extra non-cached reduction vs normal NC'],
  ].forEach(([label, value, subtext]) => {
    aggregateCards.appendChild(createMetricCard(label, value, subtext));
  });

  for (const task of analytics.tasks) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(task.benchmarkId)}<br><span class="tiny">${escapeHtml(task.repository)} · ${escapeHtml(task.taskKey)}</span></td>
      <td>${task.runCount}</td>
      <td>${formatPercent(task.nanocontext.avgSavingsRatio)}</td>
      <td>${formatPercent(task.nanocontext.avgNonCachedSavingsRatio)}</td>
      <td>${formatPercent(task.smartsearch.avgSavingsRatio)}</td>
      <td>${formatPercent(task.smartsearch.avgNonCachedSavingsRatio)}</td>
      <td>${formatPercent(task.smartsearch.avgSavingsVsNanoRatio)}</td>
    `;
    aggregateTableBody.appendChild(row);
  }
}

function renderSelectedRun() {
  const run = state.runs.find((item) => item.runId === state.selectedRunId);
  if (!run) {
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
    ['NC Token Savings', formatPercent(ratioOrNull(run.comparison?.comparison?.nanocontextVsBaselineTotalTokenSavings, totalTokens(run.conditions.baseline?.usage))), 'baseline total token reduction'],
    ['NC Non-Cached Savings', formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions.nanocontext?.usage)), 'cached input excluded'],
    ['SmartSearch Token Savings', formatPercent(ratioOrNull(run.comparison?.comparison?.smartsearchVsBaselineTotalTokenSavings, totalTokens(run.conditions.baseline?.usage))), 'baseline total token reduction'],
    ['SmartSearch Non-Cached Savings', formatPercent(nonCachedSavingsRatio(run.conditions.baseline?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'cached input excluded'],
    ['Smart vs NC Gain', formatPercent(ratioOrNull(run.comparison?.comparison?.smartsearchVsNanocontextTotalTokenSavings, totalTokens(run.conditions.nanocontext?.usage))), 'extra reduction vs normal NC'],
    ['Smart vs NC Non-Cached Gain', formatPercent(nonCachedDeltaRatio(run.conditions.nanocontext?.usage, run.conditions['nanocontext-smartsearch']?.usage)), 'cached input excluded'],
  ].forEach(([label, value, subtext]) => {
    selectedRunCards.appendChild(createMetricCard(label, value, subtext));
  });

  selectedRunConditions.innerHTML = '';
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

function buildAggregateAnalytics(runs) {
  const taskMap = new Map();
  const repos = new Set();

  for (const run of runs) {
    repos.add(run.repository);
    const key = run.benchmarkId;
    if (!taskMap.has(key)) {
      taskMap.set(key, {
        benchmarkId: run.benchmarkId,
        repository: run.repository,
        taskKey: run.taskKey,
        runCount: 0,
        baselineTokens: [],
        baselineNonCached: [],
        nanocontextTokens: [],
        nanocontextNonCached: [],
        smartsearchTokens: [],
        smartsearchNonCached: [],
      });
    }

    const task = taskMap.get(key);
    task.runCount += 1;
    if (run.conditions.baseline) {
      task.baselineTokens.push(totalTokens(run.conditions.baseline.usage));
      task.baselineNonCached.push(nonCachedTokens(run.conditions.baseline.usage));
    }
    if (run.conditions.nanocontext) {
      task.nanocontextTokens.push(totalTokens(run.conditions.nanocontext.usage));
      task.nanocontextNonCached.push(nonCachedTokens(run.conditions.nanocontext.usage));
    }
    if (run.conditions['nanocontext-smartsearch']) {
      task.smartsearchTokens.push(totalTokens(run.conditions['nanocontext-smartsearch'].usage));
      task.smartsearchNonCached.push(nonCachedTokens(run.conditions['nanocontext-smartsearch'].usage));
    }
  }

  const tasks = Array.from(taskMap.values()).map((task) => {
    const baselineAvg = average(task.baselineTokens);
    const baselineNonCachedAvg = average(task.baselineNonCached);
    const nanocontextAvg = average(task.nanocontextTokens);
    const nanocontextNonCachedAvg = average(task.nanocontextNonCached);
    const smartsearchAvg = average(task.smartsearchTokens);
    const smartsearchNonCachedAvg = average(task.smartsearchNonCached);
    return {
      ...task,
      baseline: {
        avgTokens: baselineAvg,
        avgNonCachedTokens: baselineNonCachedAvg,
      },
      nanocontext: {
        avgTokens: nanocontextAvg,
        avgSavingsRatio: ratioOrNull((baselineAvg - nanocontextAvg), baselineAvg),
        avgNonCachedTokens: nanocontextNonCachedAvg,
        avgNonCachedSavingsRatio: ratioOrNull((baselineNonCachedAvg - nanocontextNonCachedAvg), baselineNonCachedAvg),
      },
      smartsearch: {
        avgTokens: smartsearchAvg,
        avgSavingsRatio: ratioOrNull((baselineAvg - smartsearchAvg), baselineAvg),
        avgNonCachedTokens: smartsearchNonCachedAvg,
        avgNonCachedSavingsRatio: ratioOrNull((baselineNonCachedAvg - smartsearchNonCachedAvg), baselineNonCachedAvg),
        avgSavingsVsNanoRatio: ratioOrNull((nanocontextAvg - smartsearchAvg), nanocontextAvg),
        avgNonCachedSavingsVsNanoRatio: ratioOrNull((nanocontextNonCachedAvg - smartsearchNonCachedAvg), nanocontextNonCachedAvg),
      },
    };
  }).sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId));

  return {
    totalRuns: runs.length,
    totalTasks: tasks.length,
    totalRepositories: repos.size,
    nanocontext: {
      count: tasks.length,
      avgSavingsRatio: average(tasks.map((task) => task.nanocontext.avgSavingsRatio).filter(Number.isFinite)),
      avgNonCachedSavingsRatio: average(tasks.map((task) => task.nanocontext.avgNonCachedSavingsRatio).filter(Number.isFinite)),
    },
    smartsearch: {
      count: tasks.length,
      avgSavingsRatio: average(tasks.map((task) => task.smartsearch.avgSavingsRatio).filter(Number.isFinite)),
      avgNonCachedSavingsRatio: average(tasks.map((task) => task.smartsearch.avgNonCachedSavingsRatio).filter(Number.isFinite)),
      avgSavingsVsNanoRatio: average(tasks.map((task) => task.smartsearch.avgSavingsVsNanoRatio).filter(Number.isFinite)),
      avgNonCachedSavingsVsNanoRatio: average(tasks.map((task) => task.smartsearch.avgNonCachedSavingsVsNanoRatio).filter(Number.isFinite)),
    },
    tasks,
  };
}

function renderConditionPanel(conditionName, summary) {
  const fragment = conditionTemplate.content.cloneNode(true);
  fragment.querySelector('.condition-eyebrow').textContent = summary.repository || 'Condition';
  fragment.querySelector('.condition-title').textContent = conditionName;

  const badges = fragment.querySelector('.condition-badges');
  badges.appendChild(createBadge(`Exit ${summary.exitCode}`, summary.exitCode === 0 ? 'good' : 'bad'));
  badges.appendChild(createBadge(`${formatNumber(totalTokens(summary.usage))} tokens`));
  badges.appendChild(createBadge(`${formatNumber(summary.durationMs)} ms`));

  const metrics = fragment.querySelector('.condition-metrics');
  [
    ['Input Tokens', formatNumber(summary.usage?.input_tokens)],
    ['Cached Input', formatNumber(summary.usage?.cached_input_tokens)],
    ['Output Tokens', formatNumber(summary.usage?.output_tokens)],
    ['Commands', formatNumber(summary.commands?.length || 0)],
    ['File Changes', formatNumber(summary.fileChanges?.length || 0)],
    ['Messages', formatNumber(summary.consoleMessages?.length || 0)],
  ].forEach(([label, value]) => metrics.appendChild(createMiniMetric(label, value)));

  fragment.querySelector('.final-answer').textContent = summary.finalAnswer || '(empty)';

  const commandList = fragment.querySelector('.command-list');
  if (summary.commands?.length) {
    summary.commands.forEach((command) => {
      const element = document.createElement('pre');
      element.className = 'command-item';
      element.textContent = `${command.command}\n\nExit: ${command.exitCode}\n\n${command.output || ''}`.trim();
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
      element.textContent = message.text || '';
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
  if (!usage) return null;
  return safeNumber(usage.input_tokens) + safeNumber(usage.output_tokens);
}

function nonCachedTokens(usage) {
  if (!usage) return null;
  return Math.max(0, safeNumber(usage.input_tokens) - safeNumber(usage.cached_input_tokens)) + safeNumber(usage.output_tokens);
}

function nonCachedSavingsRatio(baselineUsage, comparedUsage) {
  const baseline = nonCachedTokens(baselineUsage);
  const compared = nonCachedTokens(comparedUsage);
  return ratioOrNull(baseline - compared, baseline);
}

function nonCachedDeltaRatio(baseUsage, improvedUsage) {
  const base = nonCachedTokens(baseUsage);
  const improved = nonCachedTokens(improvedUsage);
  return ratioOrNull(base - improved, base);
}

function summarizeUsage(usage) {
  if (!usage) return 'No usage recorded';
  return `in ${formatNumber(usage.input_tokens)} · out ${formatNumber(usage.output_tokens)} · cached ${formatNumber(usage.cached_input_tokens)}`;
}

function average(values) {
  const filtered = values.filter(Number.isFinite);
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
