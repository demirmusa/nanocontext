import * as path from 'path';

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectPathError';
  }
}

function isAbsoluteLike(inputPath: string): boolean {
  return path.isAbsolute(inputPath)
    || /^[A-Za-z]:[\\/]/.test(inputPath)
    || inputPath.startsWith('//')
    || inputPath.startsWith('\\\\');
}

function isOutsideProject(relativePath: string): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);
}

function toPortablePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

export function normalizeProjectPath(inputPath: string, projectRoot: string): string {
  if (typeof inputPath !== 'string') {
    throw new ProjectPathError('Path must be a string.');
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new ProjectPathError('Path is required.');
  }

  if (trimmed.includes('\0')) {
    throw new ProjectPathError('Path contains invalid characters.');
  }

  const root = path.resolve(projectRoot);
  const portableInput = toPortablePath(trimmed);
  const resolved = isAbsoluteLike(portableInput)
    ? path.resolve(portableInput)
    : path.resolve(root, portableInput);
  const relativePath = path.relative(root, resolved);

  if (!relativePath || relativePath === '.' || isOutsideProject(relativePath)) {
    throw new ProjectPathError('Path must stay within the project root.');
  }

  return toPortablePath(relativePath);
}

export function resolveProjectPath(
  inputPath: string,
  projectRoot: string,
): { relativePath: string; absolutePath: string } {
  const relativePath = normalizeProjectPath(inputPath, projectRoot);
  return {
    relativePath,
    absolutePath: path.join(path.resolve(projectRoot), relativePath),
  };
}

export function normalizeProjectPathFromUriSegment(segment: string, projectRoot: string): string {
  let decoded: string;

  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new ProjectPathError('Resource path is not valid URI encoding.');
  }

  return normalizeProjectPath(decoded, projectRoot);
}
