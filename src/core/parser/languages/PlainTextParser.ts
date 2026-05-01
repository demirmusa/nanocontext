import * as path from 'path';
import { ILanguageParser } from '../../interfaces/IParser';
import { ParsedFile, ParsedMethodInfo } from '../../interfaces/types';

const MAX_CHUNK_LINES = 80;
const MAX_SIG_LENGTH = 120;

export class PlainTextParser implements ILanguageParser {
  readonly language = 'text';
  readonly extensions = ['.md', '.mdx', '.txt'];

  async parse(content: string, filePath: string): Promise<ParsedFile> {
    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split('\n');
    const isMarkdown = ext === '.md' || ext === '.mdx';
    const methods = isMarkdown ? parseMarkdownSections(lines) : parseTextChunks(lines);

    return {
      file: filePath,
      lang: isMarkdown ? 'markdown' : 'text',
      classes: [],
      methods,
      imports: [],
      exports: [],
    };
  }
}

function parseMarkdownSections(lines: string[]): ParsedMethodInfo[] {
  const sections: ParsedMethodInfo[] = [];
  let currentHeading = '';
  let currentStart = 1;
  let currentLines: string[] = [];

  const flush = (endLine: number) => {
    const text = currentLines.join('\n').trim();
    if (!text) return;
    sections.push(makeSection(currentHeading || 'intro', currentStart, endLine, text));
  };

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      flush(i);
      currentHeading = headingMatch[1].trim();
      currentStart = i + 1;
      currentLines = [];
    } else {
      currentLines.push(lines[i]);
    }
  }
  flush(lines.length);

  if (sections.length === 0) {
    const text = lines.join('\n').trim();
    if (text) return [makeSection('content', 1, lines.length, text)];
  }

  return sections;
}

function parseTextChunks(lines: string[]): ParsedMethodInfo[] {
  const chunks: ParsedMethodInfo[] = [];
  let chunkStart = 1;
  let chunkLines: string[] = [];
  let chunkIdx = 1;

  const flush = (endLine: number) => {
    const text = chunkLines.join('\n').trim();
    if (!text) return;
    chunks.push(makeSection(`paragraph ${chunkIdx++}`, chunkStart, endLine, text));
    chunkLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    chunkLines.push(lines[i]);
    const isBlank = !lines[i].trim();
    const tooLong = chunkLines.length >= MAX_CHUNK_LINES;
    if ((isBlank && chunkLines.some(l => l.trim())) || tooLong) {
      flush(i + 1);
      chunkStart = i + 2;
    }
  }
  if (chunkLines.some(l => l.trim())) flush(lines.length);

  return chunks;
}

function makeSection(name: string, startLine: number, endLine: number, text: string): ParsedMethodInfo {
  const firstLine = text.split('\n')[0].trim();
  const sig = firstLine.length > MAX_SIG_LENGTH ? firstLine.slice(0, MAX_SIG_LENGTH) + '...' : firstLine;
  return {
    name,
    loc: `${startLine}-${endLine}`,
    sig,
    refs: [],
    insight: text,
  };
}
