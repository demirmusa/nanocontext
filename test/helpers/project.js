const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createTempProject(extraFiles = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocontext-'));
  fs.writeFileSync(
    path.join(projectRoot, 'nanocontextconfig.json'),
    JSON.stringify({
      version: 1,
      languages: ['typescript'],
      include: ['src/**/*'],
      exclude: [],
      aiInsight: false,
      aiInsightConcurrency: 1,
      watch: { debounceMs: 100 },
      search: { defaultLimit: 3, maxLimit: 20 },
      dependencyDepth: 1,
    }, null, 2),
    'utf-8',
  );

  for (const [relativePath, content] of Object.entries(extraFiles)) {
    const fullPath = path.join(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  return projectRoot;
}

module.exports = { createTempProject };
