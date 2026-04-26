import { MethodInsight } from '../interfaces/ILLMProvider';

export function parseInsightResponse(content: string, methods: { id: string; name: string; code: string }[]): MethodInsight[] {
  const results: MethodInsight[] = [];
  const lines = content.split('\n').filter(l => l.trim());
  const methodsById = new Map(methods.map(method => [method.id, method]));

  for (const line of lines) {
    // Format: "method:abc123: keywords..." — find the second colon
    const firstColon = line.indexOf(':');
    if (firstColon === -1) continue;
    const secondColon = line.indexOf(':', firstColon + 1);
    if (secondColon === -1) continue;

    const methodId = line.substring(0, secondColon).trim().replace(/^\d+\.\s*/, '');
    const insight = line.substring(secondColon + 1).trim();

    const method = methodsById.get(methodId);
    if (method && insight) {
      results.push({ methodId, methodName: method.name, insight });
    }
  }

  return results;
}

export function buildFileInsightPrompt(methods: { id: string; name: string; code: string }[], language: string): string {
  const methodList = methods.map((m, i) => `### ${i + 1}. ${m.name}\nmethod_id: ${m.id}\n\`\`\`${language}\n${m.code}\n\`\`\``).join('\n\n');

  return `You are analyzing source code methods to produce rich search index entries. These will be used for semantic code search — developers search for concepts and expect to find the right methods.

For each method below, produce EXACTLY one line in this format:
method_id: <description>

The description should be a rich, free-form mix of:
- A short sentence summarizing what the method does and why it exists
- Relevant keywords a developer would search for (specific: "JWT", "Redis", "Firestore"; general: "authentication", "caching", "error handling")
- Domain/business context when clear (e.g. "user login flow", "payment processing", "push notification setup")

Guidelines:
- Write naturally — mix sentences and keywords as needed, separated by commas or inline
- Only include keywords that genuinely apply; do not pad with guesses
- Aim for 1–3 sentences worth of content per method
- Focus on WHAT the method does and its domain purpose — avoid generic programming mechanics like "null check", "error handling", "exception", "try catch", "async", "loop", "return value" unless that IS the core purpose of the method
- Do NOT add any other text, headers, numbering, or explanation. One line per method.

Example output:
method:abc123: Authenticates a user with email and password. user login, credential validation, JWT token generation, session creation, password hash verify, Firebase Auth
method:def456: Fetches a user entity from the database by ID, returning null if not found. user lookup, Firestore query, find by id, null check, async data retrieval
method:ghi789: Processes a Stripe payment charge and records the transaction. payment processing, Stripe API, charge creation, amount validation, transaction logging, error handling

${methodList}`;
}
