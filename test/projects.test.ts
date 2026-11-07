import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectTypes, globToRegExp, matchesProject, detectProject, resolveProject, folderExcludeGlobs } from '../src/projects.ts';

const types = parseProjectTypes({
  'Go project': '*.go',
  'CSharp project': '*.cs, *.xaml, *.xaml.cs, *.resx',
  'Empty': '',
  'Blank patterns': ' , ',
  '': '*.x',
  'Src only': 'src/**/*.ts',
});

test('parses object entries and drops malformed ones', () => {
  assert.deepEqual(types.map(t => t.name), ['Go project', 'CSharp project', 'Src only']);
});

test('glob: *.go matches at any depth, not other extensions', () => {
  const go = types[0];
  assert.ok(matchesProject('main.go', go));
  assert.ok(matchesProject('a/b/server.go', go));
  assert.ok(!matchesProject('a/b/server.gox', go));
  assert.ok(!matchesProject('README.md', go));
});

test('glob: path patterns and escaping', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b.ts'));
  assert.ok(!globToRegExp('src/**/*.ts').test('lib/b.ts'));
  assert.ok(globToRegExp('**/*.xaml.cs').test('V/Main.xaml.cs'));
  assert.ok(!globToRegExp('*.c').test('xcc'));
});

test('detect: picks the type matching most files', () => {
  const paths = ['a.go', 'b.go', 'App.xaml', 'x.cs', 'y.cs', 'z.cs', 'README.md'];
  assert.equal(detectProject(paths, types)?.name, 'CSharp project');
  assert.equal(detectProject(['a.go'], types)?.name, 'Go project');
  assert.equal(detectProject(['README.md'], types), undefined);
});

test('resolve: Auto detects, explicit name wins, All files = no filter', () => {
  const paths = ['a.go', 'b.go', 'x.cs'];
  assert.equal(resolveProject('Auto', paths, types)?.name, 'Go project');
  assert.equal(resolveProject('CSharp project', paths, types)?.name, 'CSharp project');
  assert.equal(resolveProject('All files', paths, types), undefined);
});

test('folderExcludeGlobs: names become any-depth folder globs', () => {
  assert.deepEqual(folderExcludeGlobs(['.git', ' .svn ', '/.claude/', '', '.git', 'bad,name', 'cmake-build-*']),
    ['**/.git/**', '**/.svn/**', '**/.claude/**', '**/cmake-build-*/**']);
});

test('folderExcludeGlobs: generated globs match files inside the folder only', () => {
  const re = globToRegExp(folderExcludeGlobs(['.git'])[0]);
  assert.ok(re.test('.git/config'));
  assert.ok(re.test('a/b/.git/hooks/x'));
  assert.ok(!re.test('a/.github/x'));
  assert.ok(!re.test('a/.gitignore'));
});

test('null / undefined settings give no project types', () => {
  assert.deepEqual(parseProjectTypes(undefined), []);
  assert.deepEqual(parseProjectTypes(null), []);
});
