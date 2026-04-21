import { MethodInsight } from '../interfaces/ILLMProvider';

export function parseInsightResponse(content: string, methods: { id: string; name: string; code: string }[]): MethodInsight[] {
  const results: MethodInsight[] = [];
  const lines = content.split('\n').filter(l => l.trim());
  const methodsById = new Map(methods.map(method => [method.id, method]));

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const methodId = line.substring(0, colonIdx).trim().replace(/^\d+\.\s*/, '');
    const insight = line.substring(colonIdx + 1).trim();

    const method = methodsById.get(methodId);
    if (method && insight) {
      results.push({ methodId, methodName: method.name, insight });
    }
  }

  return results;
}

export function buildFileInsightPrompt(methods: { id: string; name: string; code: string }[], language: string): string {
  const methodList = methods.map((m, i) => `### ${i + 1}. ${m.name}\nmethod_id: ${m.id}\n\`\`\`${language}\n${m.code}\n\`\`\``).join('\n\n');

  return `You are analyzing source code methods to generate keywords for a vector search index. These keywords will be used for semantic code search — developers will search for concepts like "user authentication", "database query", "error handling", etc. and expect to find relevant methods.

For each method below, produce EXACTLY one line in this format:
method_id: keyword1, keyword2, keyword3, ...

Guidelines:
- Choose keywords that a developer would naturally search for when looking for this functionality
- Include both specific terms (e.g. "JWT", "Redis", "SQL") and general concepts (e.g. "authentication", "caching", "validation")
- Include the domain/business context when obvious (e.g. "user login", "payment processing", "file upload")
- Maximum 20 keywords per method
- Do NOT add any other text, headers, numbering, or explanation. One line per method.

Example output:
method:abc123: user authentication, login, credential validation, JWT token, session creation, password verify
method:def456: user lookup, database query, find by id, entity retrieval, null check
method:ghi789: payment processing, Stripe charge, transaction, amount validation, error handling

${methodList}`;
}
