/** Tree produced by the scanner. */
export interface FileNode {
  kind: 'file';
  name: string;
  path: string; // workspace-relative, posix separators
  loc: number;
}

export interface DirNode {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

/** Axis-aligned box on the ground plane (x,z) with a height (y). */
export interface Box {
  kind: 'file' | 'dir';
  name: string;
  path: string;
  x: number;
  z: number;
  w: number;
  d: number;
  depth: number;
  loc: number; // for dirs: sum of descendant LOC
  fileCount: number; // for dirs: number of descendant files
  ext: string; // files only
}

export type HeightScale = 'linear' | 'sqrt' | 'log';
