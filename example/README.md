# Local Embeddings with NanoContext

This example shows how to run NanoContext semantic search without paid OpenAI embeddings. NanoContext currently supports local embeddings through Ollama.

## Why Use Local Embeddings

OpenAI embeddings are convenient, but every scan, rebuild, watcher sync, memory embedding, and semantic search fallback can call the embedding API. On active projects this can add cost quickly.

Local embeddings move that work to your own machine:

- No per-token embedding cost
- No source snippets sent to an embedding API
- Semantic search still works after vectors are rebuilt locally
- Exact and regex search continue to work even with embeddings disabled

## Minimum System Requirements

For `nomic-embed-text` through Ollama:

- OS: Windows, macOS, or Linux
- RAM: 8 GB minimum, 16 GB recommended
- Disk: about 1-2 GB free for Ollama and the embedding model
- CPU: modern 4-core CPU is enough for small and medium repos
- GPU: optional; embeddings work on CPU, but GPU can make indexing faster
- Network: only needed once to download Ollama and the model

For large repositories, expect indexing to be CPU and disk intensive. Keep the watcher running after the first scan so only changed files are re-embedded.

## Option A: Ollama Installed Locally

Install Ollama from:

```text
https://ollama.com
```

Pull the embedding model:

```bash
ollama pull nomic-embed-text
```

Make sure Ollama is running:

```bash
ollama serve
```

On most desktop installs, Ollama already runs in the background. The default endpoint is:

```text
http://localhost:11434
```

Quick check:

```bash
curl http://localhost:11434/api/tags
```

## Option B: Ollama with Docker

Run Ollama in a container:

```bash
docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama
```

Pull the embedding model into the container:

```bash
docker exec ollama ollama pull nomic-embed-text
```

Check the endpoint from the host:

```bash
curl http://localhost:11434/api/tags
```

## Configure NanoContext

NanoContext stores provider settings in:

```text
<project>/.nanocontext/config.json
```

Use this config for local embeddings and no LLM insights:

```json
{
  "llm": {
    "provider": "none",
    "model": "disabled"
  },
  "embedding": {
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "nomic-embed-text"
  }
}
```

If you want local AI insights too, use Ollama for the LLM section as well:

```json
{
  "llm": {
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "llama3.2"
  },
  "embedding": {
    "provider": "ollama",
    "endpoint": "http://localhost:11434",
    "model": "nomic-embed-text"
  }
}
```

Then pull the LLM model:

```bash
ollama pull llama3.2
```

## Rebuild Existing Vectors

If the project was previously scanned with OpenAI embeddings, rebuild vectors after switching to Ollama:

```bash
nc scan --rebuild-vectors
```

Then start the watcher:

```bash
nc agent-start
```

or:

```bash
nc watch -d
```

## Verify It Works

Check NanoContext status:

```bash
nc status
```

Run a semantic search explicitly:

```bash
nc search -v "authentication flow"
```

Run normal search, which can use exact/regex first and semantic fallback when needed:

```bash
nc search "authentication"
```

If Ollama is not reachable, exact and regex search still work. Semantic search will not have local vectors available until Ollama is running and vectors are rebuilt.

## Disable Embeddings Completely

If you only want free deterministic indexing, exact search, and regex search, disable embeddings:

```json
{
  "llm": {
    "provider": "none",
    "model": "disabled"
  },
  "embedding": {
    "provider": "none",
    "model": "disabled"
  }
}
```

This avoids all embedding work. You lose semantic vector search and vector-backed memory similarity, but structural indexing still works.

## Notes on LM Studio

NanoContext does not currently include an LM Studio embedding provider. The built-in local embedding provider calls Ollama's `/api/embeddings` endpoint, so LM Studio's OpenAI-compatible API will need a separate provider implementation before it can be used directly.

For now, use Ollama for local embeddings.

## Troubleshooting

If vector search returns no results:

1. Confirm Ollama is running:

   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Confirm the model is installed:

   ```bash
   ollama list
   ```

3. Rebuild vectors:

   ```bash
   nc scan --rebuild-vectors
   ```

4. Check project config:

   ```text
   .nanocontext/config.json
   ```

5. Stop and restart the watcher:

   ```bash
   nc watch stop
   nc agent-start
   ```
