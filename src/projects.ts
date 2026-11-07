export interface ProjectType {
  name: string;
  patterns: string[]; // glob patterns, e.g. "**/*.go"
}

export const ALL_FILES = 'All files';

function toType(rawName: string, patternList: string): ProjectType | undefined {
  const name = rawName.trim();
  const patterns = patternList.split('|').map(p => p.trim()).filter(Boolean)
    .map(p => (p.includes('/') ? p : `**/${p}`));
  return name && patterns.length ? { name, patterns } : undefined;
}

/**
 * Parse the `codeCity.projectTypes` setting: an object mapping a project name
 * to its patterns, e.g. { "Go project": "*.go", "CSharp project": "*.cs|*.xaml" }.
 * Patterns without a "/" match at any depth (a "**\/" prefix is added).
 * Malformed entries (no name or no patterns) are ignored; the first of two
 * equal names wins.
 */
export function parseProjectTypes(input: Record<string, string> | null | undefined): ProjectType[] {
  const out: ProjectType[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [name, value] of Object.entries(input)) {
    const t = typeof value === 'string' ? toType(name, value) : undefined;
    if (t && !out.some(o => o.name === t.name)) out.push(t);
  }
  return out;
}

/** Setting value meaning "detect the project type from the scanned files". */
export const AUTO = 'Auto';

/** Convert a glob (`*`, `**`, `?`) to a case-insensitive RegExp over posix relative paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchesProject(path: string, type: ProjectType): boolean {
  return type.patterns.some(p => globToRegExp(p).test(path));
}

/**
 * Pick the project type matching the most files. Ties go to the earlier entry;
 * returns undefined when nothing matches.
 */
export function detectProject(paths: string[], types: ProjectType[]): ProjectType | undefined {
  let best: ProjectType | undefined;
  let bestCount = 0;
  for (const t of types) {
    const res = t.patterns.map(globToRegExp);
    const count = paths.reduce((n, p) => n + (res.some(r => r.test(p)) ? 1 : 0), 0);
    if (count > bestCount) { best = t; bestCount = count; }
  }
  return best;
}

/** Resolve the setting value (Auto / All files / a name) to a project type, or undefined for "no filter". */
export function resolveProject(active: string, paths: string[], types: ProjectType[]): ProjectType | undefined {
  if (active === AUTO) return detectProject(paths, types);
  return types.find(t => t.name === active);
}

/**
 * Turn folder names (".git", "node_modules", "cmake-build-*") into exclude globs
 * that match that folder at any depth. Blank names and names containing
 * commas or braces (which would break the brace-joined glob) are dropped.
 */
export function folderExcludeGlobs(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/^\/+|\/+$/g, '');
    if (!name || /[,{}]/.test(name)) continue;
    const glob = `**/${name}/**`;
    if (!out.includes(glob)) out.push(glob);
  }
  return out;
}
