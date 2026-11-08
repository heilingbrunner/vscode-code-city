import * as vscode from 'vscode';
import type { DirNode, FileNode } from './types.ts';
import { extOf } from './layout.ts';

export interface ScanProgress {
  counts: Record<string, number>; // scanned files per extension so far
  done: number;
  total: number;
}

function countLines(buf: Uint8Array): number | null {
  if (buf.length === 0) return 0;
  const probe = Math.min(buf.length, 8000);
  for (let i = 0; i < probe; i++) if (buf[i] === 0) return null; // binary
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}

/** List candidate files (after excludes), without reading them. */
export async function listFiles(folder: vscode.Uri, exclude: string[], token?: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const excludeGlob = exclude.length ? `{${exclude.join(',')}}` : undefined;
  return vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), excludeGlob, undefined, token);
}

export const relPath = (folder: vscode.Uri, u: vscode.Uri) => u.path.slice(folder.path.length).replace(/^\/+/, '');

/** Count lines of the given files and build the DirNode tree. */
export async function scan(
  folder: vscode.Uri,
  uris: vscode.Uri[],
  maxFileSizeKB: number,
  token?: vscode.CancellationToken,
  onProgress?: (p: ScanProgress) => void,
): Promise<DirNode> {
  const root: DirNode = { kind: 'dir', name: folder.path.split('/').pop() || 'root', path: '', children: [] };
  const dirs = new Map<string, DirNode>([['', root]]);

  const getDir = (path: string): DirNode => {
    let d = dirs.get(path);
    if (d) return d;
    const i = path.lastIndexOf('/');
    const parent = getDir(i < 0 ? '' : path.slice(0, i));
    d = { kind: 'dir', name: path.slice(i + 1), path, children: [] };
    parent.children.push(d);
    dirs.set(path, d);
    return d;
  };

  const counts: Record<string, number> = {};
  let done = 0;
  const maxBytes = maxFileSizeKB * 1024;
  // Sort descending because pop() takes from the end: files then enter the tree
  // in ascending path order, making the result deterministic regardless of
  // worker completion order (and squarify's stable-sort tie-breaking too).
  const queue = uris.slice().sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  const worker = async () => {
    for (let u = queue.pop(); u && !token?.isCancellationRequested; u = queue.pop()) {
      try {
        const stat = await vscode.workspace.fs.stat(u);
        if (stat.size > maxBytes) continue;
        const loc = countLines(await vscode.workspace.fs.readFile(u));
        if (loc === null) continue;
        const rel = relPath(folder, u);
        const i = rel.lastIndexOf('/');
        const file: FileNode = { kind: 'file', name: rel.slice(i + 1), path: rel, loc };
        getDir(i < 0 ? '' : rel.slice(0, i)).children.push(file);
        const ext = extOf(file.name);
        counts[ext] = (counts[ext] ?? 0) + 1;
      } catch { /* unreadable file: skip */ }
      finally { done++; onProgress?.({ counts, done, total: uris.length }); }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return root;
}
