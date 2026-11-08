import * as vscode from 'vscode';
import { listFiles, relPath, scan, type ScanProgress } from './scanner.ts';
import { ALL_FILES, AUTO, folderExcludeGlobs, matchesProject, parseProjectTypes, resolveProject } from './projects.ts';

let panel: vscode.WebviewPanel | undefined;
let watcher: vscode.FileSystemWatcher | undefined;
let timer: NodeJS.Timeout | undefined;
let rootUri: vscode.Uri | undefined;

function cfg() {
  const c = vscode.workspace.getConfiguration('codeCity');
  return {
    exclude: [...c.get<string[]>('exclude', []), ...folderExcludeGlobs(c.get<string[]>('ignoredFolders', []))],
    heightScale: c.get<string>('heightScale', 'sqrt'),
    maxFileSizeKB: c.get<number>('maxFileSizeKB', 1024),
    projectTypes: parseProjectTypes(c.get<Record<string, string>>('projectTypes', {})),
    activeProject: c.get<string>('activeProject', AUTO),
  };
}

let renderSeq = 0;

async function render() {
  if (!panel || !rootUri) return;
  const seq = ++renderSeq; // a newer render supersedes this one
  panel.webview.postMessage({ type: 'scanning' });
  const { exclude, heightScale, maxFileSizeKB, projectTypes, activeProject } = cfg();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Code City: scanning…' }, async () => {
   try {
    const all = await listFiles(rootUri!, exclude);
    const project = resolveProject(activeProject, all.map(u => relPath(rootUri!, u)), projectTypes);
    const uris = project ? all.filter(u => matchesProject(relPath(rootUri!, u), project)) : all;
    let lastPost = 0;
    const onProgress = (p: ScanProgress) => {
      const now = Date.now();
      if (seq !== renderSeq || (now - lastPost < 100 && p.done < p.total)) return; // throttle; stale scans stay silent
      lastPost = now;
      panel?.webview.postMessage({ type: 'progress', counts: p.counts, done: p.done, total: p.total });
    };
    panel?.webview.postMessage({ type: 'progress', counts: {}, done: 0, total: uris.length });
    const tree = await scan(rootUri!, uris, maxFileSizeKB, undefined, onProgress);
    if (seq !== renderSeq) return; // stale result: a newer scan is running
    if (panel) panel.title = `Code City: ${tree.name}`;
    panel?.webview.postMessage({ type: 'city', tree, heightScale, rootName: tree.name, rootKey: rootUri!.toString(),
      projects: [AUTO, ALL_FILES, ...projectTypes.map(p => p.name)], activeProject, detected: project?.name ?? ALL_FILES });
   } catch (err) {
    if (seq === renderSeq) panel?.webview.postMessage({ type: 'error', message: String(err) });
   }
  });
}

async function setProject(name: string) {
  await vscode.workspace.getConfiguration('codeCity').update('activeProject', name, vscode.ConfigurationTarget.Workspace);
  // the configuration-change listener triggers the refresh
}

async function selectProject() {
  const { projectTypes, activeProject } = cfg();
  const items = [AUTO, ALL_FILES, ...projectTypes.map(p => p.name)].map(label => ({
    label, description: label === activeProject ? 'active' : projectTypes.find(p => p.name === label)?.patterns.join(', ').replace(/\*\*\//g, ''),
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Which files should the city include?' });
  if (pick) await setProject(pick.label);
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(render, 500);
}

function html(webview: vscode.Webview, ctx: vscode.ExtensionContext): string {
  const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'webview.js'));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family)}
  canvas{display:block}
  #stage{position:fixed;top:var(--bar-h);bottom:0;left:var(--side-w);right:0;transition:left .15s ease;overflow:hidden}
  #busy{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;
        background:color-mix(in srgb,var(--vscode-editor-background) 70%,transparent);font-size:13px;z-index:10}
  #busy.hidden{display:none}
  .spinner{width:36px;height:36px;border-radius:50%;border:4px solid var(--vscode-editorWidget-border,#888);
           border-top-color:var(--vscode-progressBar-background,#0e70c0);animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  #busy.failed .spinner{display:none}
  body{--side-w:176px;--bar-h:26px}
  body.side-collapsed{--side-w:22px}
  #types{position:fixed;top:var(--bar-h);bottom:0;left:0;width:var(--side-w);z-index:20;box-sizing:border-box;display:flex;flex-direction:column;
         background:var(--vscode-sideBar-background,var(--vscode-editorWidget-background));
         border-right:1px solid var(--vscode-editorWidget-border,transparent);font-size:12px;transition:width .15s ease;overflow:hidden}
  #typesToggle{all:unset;box-sizing:border-box;cursor:pointer;user-select:none;font-weight:600;white-space:nowrap;display:flex;align-items:center;gap:6px;padding:8px}
  #typesToggle:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.2))}
  /* vertical-rl: the inline axis runs top-to-bottom, so row stacks arrow above title */
  body.side-collapsed #typesToggle{flex-direction:row;gap:8px;padding:8px 0;justify-content:flex-start;align-items:center;width:100%;writing-mode:vertical-rl}
  #typesArrow{display:inline-block;transition:transform .15s;writing-mode:horizontal-tb}
  body.side-collapsed #typesArrow{transform:rotate(180deg)}
  body.side-collapsed #typeList{display:none}
  #typeList{display:flex;flex-direction:column;gap:2px;padding:0 8px 8px;overflow-y:auto;flex:1 1 auto;min-height:0}
  .trow{display:flex;align-items:center;gap:6px}
  .pill{flex:0 0 auto;box-sizing:border-box;min-width:36px;padding:1px 6px;border-radius:3px;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.6);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tcount{margin-left:auto;font-variant-numeric:tabular-nums;opacity:.85}
  #tip{position:fixed;pointer-events:none;display:none;padding:4px 8px;border-radius:4px;font-size:12px;
       background:var(--vscode-editorHoverWidget-background);border:1px solid var(--vscode-editorHoverWidget-border);white-space:pre}
  #ui{position:fixed;top:0;left:0;right:0;height:var(--bar-h);z-index:30;box-sizing:border-box;padding:0 8px;font-size:11px;
      display:flex;gap:12px;align-items:center;white-space:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
      background:var(--vscode-sideBar-background,var(--vscode-editorWidget-background));
      border-bottom:1px solid var(--vscode-editorWidget-border,transparent)}
  #ui::-webkit-scrollbar{display:none}
  #ui label{display:flex;align-items:center;gap:4px}
  #ui select{height:18px;padding:0 2px;font-size:11px}
  #ui input[type=range]{height:14px;margin:0}
  #stats{margin-left:auto}
  select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border)}
</style></head><body>
<div id="ui"><b id="title">Code City</b>
  <label>Project <select id="projectMode"></select></label>
  <label title="Street width between districts">Streets <input id="street" type="range" min="0" max="24" step="1" value="4" style="width:60px"></label>
  <label title="Soft sun shadows"><input id="shadows" type="checkbox" checked> Shadows</label>
  <label>Color <select id="colorMode"><option value="loc">LOC</option><option value="ext" selected>Extension</option></select></label>
  <label>Height <select id="scaleMode"><option>linear</option><option>sqrt</option><option>log</option></select></label>
  <label>Scheme <select id="scheme"></select></label>
  <span id="stats"></span></div>
<aside id="types"><button id="typesToggle" title="Show / hide file types"><span id="typesArrow">◀</span><span id="typesTitle">File types</span></button><div id="typeList"></div></aside>
<div id="stage"><div id="busy"><div class="spinner"></div><div id="busyText">Scanning …</div></div></div>
<div id="tip"></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
}

export function activate(ctx: vscode.ExtensionContext) {

  const watchRoot = () => {
    watcher?.dispose();
    watcher = undefined;
    if (!rootUri) return;
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(rootUri, '**/*'));
    watcher.onDidCreate(scheduleRefresh); watcher.onDidDelete(scheduleRefresh); watcher.onDidChange(scheduleRefresh);
  };

  /** Resolve the explorer's right-clicked resource (or undefined when run from the palette) to a folder. */
  const folderFrom = async (arg: unknown): Promise<vscode.Uri | undefined> => {
    if (!(arg instanceof vscode.Uri)) return undefined;
    const stat = await vscode.workspace.fs.stat(arg);
    return stat.type & vscode.FileType.Directory ? arg : vscode.Uri.joinPath(arg, '..');
  };

  // `arg` is the explorer node when run from the context menu.
  const show = async (arg?: unknown) => {
    const chosen = await folderFrom(arg);
    if (chosen) rootUri = chosen;
    else if (!panel) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length > 1) {
        const pick = await vscode.window.showQuickPick(
          folders.map(f => ({ label: f.name, description: f.uri.fsPath, uri: f.uri })),
          { placeHolder: 'Select the workspace folder to visualize' });
        if (!pick) return;
        rootUri = pick.uri;
      } else rootUri = folders[0]?.uri;
    }
    if (!rootUri) { vscode.window.showWarningMessage('Code City: open a folder first.'); return; }

    if (panel) {
      panel.reveal();
      if (chosen) { watchRoot(); render(); } // new root for the existing panel
      return;
    }

    panel = vscode.window.createWebviewPanel('codeCity', 'Code City', vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'dist')] });
    panel.webview.html = html(panel.webview, ctx);

    panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'ready') render();
      else if (msg.type === 'setProject' && typeof msg.name === 'string') setProject(msg.name);
      else if (msg.type === 'openFile' && rootUri && typeof msg.path === 'string' && !msg.path.includes('..')) {
        await vscode.window.showTextDocument(vscode.Uri.joinPath(rootUri, msg.path));
      }
    });

    watchRoot();
    panel.onDidDispose(() => { panel = undefined; watcher?.dispose(); watcher = undefined; clearTimeout(timer); });
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('codeCity.show', show),
    vscode.commands.registerCommand('codeCity.selectProject', selectProject),
    vscode.commands.registerCommand('codeCity.refresh', () => (panel ? render() : show())),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('codeCity')) scheduleRefresh(); }),
  );
}

export function deactivate() { watcher?.dispose(); }
