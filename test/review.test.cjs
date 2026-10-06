'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { review, format } = require('../review.cjs');

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'image-reference-review-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Synthetic Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const write = (name, content) => { const f = path.join(repo, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  const commit = () => { git('add', '.'); git('commit', '-qm', 'Synthetic fixture snapshot'); return git('rev-parse', 'HEAD'); };
  return { repo, git, write, commit };
}

test('changed image finds unchanged docs, references, spaces, repeated uses; excludes code and HTML images', t => {
  const f = fixture(t);
  f.write('images/settings panel.png', 'before');
  f.write('guide.md', '![Settings overview](<images/settings panel.png>)\n\n![Save location][panel]\n\n[panel]: images/settings%20panel.png\n\n```md\n![not real](<images/settings panel.png>)\n```\n\n`![not real](images/settings%20panel.png)`\n\n<img src="images/settings%20panel.png" alt="not supported">\n');
  f.write('help/faq.md', '> ![Settings overview](../images/settings%20panel.png?version=1#crop)\n');
  const base = f.commit(); f.write('images/settings panel.png', 'after'); const head = f.commit();
  const result = review({ repo: f.repo, base, head });
  assert.equal(result.assets.length, 1);
  const docs = result.assets[0].documents;
  assert.deepEqual(docs.map(d => d.afterDocument), ['guide.md', 'help/faq.md']);
  assert.ok(docs.every(d => !d.documentChanged && d.altComparison === 'unchanged'));
  assert.equal(docs[0].after.length, 2);
  assert.equal(docs[1].after[0].altSource, 'Settings overview');
  assert.match(format(result), /document unchanged; alt source unchanged/);
});

test('changed alt and empty alt are observations, not pass/fail judgements; ignores worktree', t => {
  const f = fixture(t); f.write('a.svg', 'before'); f.write('doc.md', '![old](a.svg)\n\n![](a.svg)\n');
  const base = f.commit(); f.write('a.svg', 'after'); f.write('doc.md', '![new](a.svg)\n\n![](a.svg)\n'); const head = f.commit();
  f.write('doc.md', 'dirty worktree should be ignored');
  const status = f.git('status', '--porcelain');
  const result = review({ repo: f.repo, base, head });
  assert.equal(result.assets[0].documents[0].altComparison, 'changed');
  assert.deepEqual(result.assets[0].documents[0].after.map(r => r.altSource), ['new', '']);
  assert.equal(f.git('status', '--porcelain'), status);
  assert.equal(fs.readFileSync(path.join(f.repo, 'doc.md'), 'utf8'), 'dirty worktree should be ignored');
  const cli = spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), '--repo', f.repo, base, head]);
  assert.equal(cli.status, 0);
});

test('root-relative mapping is explicit; remote images and unsupported paths explain skipped references', t => {
  const f = fixture(t); f.write('public/img/a.png', 'before');
  f.write('doc.md', '![root](/img/a.png)\n\n![remote](https://example.invalid/a.png)\n\n![entity](a&amp;b.png)\n\n![escape](../a.png)\n');
  const base = f.commit(); f.write('public/img/a.png', 'after'); const head = f.commit();
  const noMap = review({ repo: f.repo, base, head });
  assert.equal(noMap.assets[0].documents.length, 0);
  assert.match(format(noMap), /No supported Markdown references found in either snapshot\. This does not prove the asset is unused\./);
  assert.ok(noMap.skippedReferences.some(r => r.reason.includes('--site-root')));
  const result = review({ repo: f.repo, base, head, siteRoot: 'public' });
  assert.equal(result.assets[0].documents[0].after[0].altSource, 'root');
  assert.ok(result.skippedReferences.some(r => r.reason.includes('entity-encoded')));
  assert.throws(() => review({ repo: f.repo, base, head, siteRoot: '../public' }), /repository-relative/);
});

test('asset and Markdown renames pair snapshots, retaining stale references', t => {
  const f = fixture(t); f.write('old.png', 'unchanged image content\n');
  f.write('guide.md', '# Guide\n\nSome unchanged surrounding content to detect document rename.\n\n![stable](old.png)\n');
  f.write('stale.md', '![stale](old.png)\n'); const base = f.commit();
  f.git('mv', 'old.png', 'new.png'); f.git('mv', 'guide.md', 'renamed.md');
  f.write('renamed.md', '# Guide\n\nSome unchanged surrounding content to detect document rename.\n\n![stable](new.png)\n');
  const head = f.commit(); const result = review({ repo: f.repo, base, head });
  assert.equal(result.assets.length, 1); assert.match(result.assets[0].status, /^R/);
  const docs = result.assets[0].documents;
  const renamed = docs.find(d => d.afterDocument === 'renamed.md');
  assert.equal(renamed.beforeDocument, 'guide.md'); assert.equal(renamed.altComparison, 'unchanged');
  const stale = docs.find(d => d.afterDocument === 'stale.md');
  assert.equal(stale.altComparison, 'unchanged'); assert.equal(stale.after[0].targetExists, false);
});

test('deletions and additions preserve references in unchanged documents', t => {
  const f = fixture(t); f.write('deleted.png', 'old');
  f.write('doc.md', '![old](deleted.png)\n\n![future](added.png)\n'); const base = f.commit();
  f.git('rm', '-q', 'deleted.png'); f.write('added.png', 'new'); const head = f.commit();
  const result = review({ repo: f.repo, base, head });
  const added = result.assets.find(a => a.status === 'A').documents[0];
  const deleted = result.assets.find(a => a.status === 'D').documents[0];
  assert.equal(added.documentChanged, false); assert.equal(added.before[0].targetExists, false);
  assert.equal(added.after[0].targetExists, true); assert.equal(deleted.after[0].targetExists, false);
});

test('explicit commit resolution rejects invalid refs; annotated tags resolve; reverse diff works', t => {
  const f = fixture(t); f.write('a.png', 'before'); f.write('doc.md', '![unchanged](a.png)'); const base = f.commit();
  f.git('tag', '-a', 'base-tag', '-m', 'fixture'); f.write('a.png', 'after'); const head = f.commit();
  const result = review({ repo: f.repo, base: 'base-tag', head });
  assert.equal(result.baseCommit, base); assert.equal(result.headCommit, head);
  assert.equal(review({ repo: f.repo, base: head, head: base }).baseCommit, head);
  assert.throws(() => review({ repo: f.repo, base: '--help', head }), /./);
  assert.throws(() => review({ repo: f.repo, base: 'does-not-exist', head }), /./);
  assert.throws(() => review({ repo: f.repo, base }), /Two explicit/);
});

test('GFM table/list references work; MDX, AsciiDoc, HTML and symlink documents are excluded', t => {
  const f = fixture(t); f.write('a.png', 'before');
  f.write('doc.md', '| Picture |\n| --- |\n| ![table](a.png) |\n\n- ![list](a.png)\n\n    ![list second](a.png)\n');
  f.write('doc.mdx', '![mdx](a.png)'); f.write('doc.adoc', 'image::a.png[]'); f.write('doc.html', '<img src="a.png">');
  fs.symlinkSync('doc.md', path.join(f.repo, 'symlink.md')); const base = f.commit();
  f.write('a.png', 'after'); const head = f.commit();
  const result = review({ repo: f.repo, base, head });
  assert.deepEqual(result.assets[0].documents.map(d => d.afterDocument), ['doc.md']);
  assert.deepEqual(result.assets[0].documents[0].after.map(r => r.altSource), ['table', 'list', 'list second']);
});

test('collapsed and shortcut references, fenced and indented code, and no-change comparisons', t => {
  const f = fixture(t); f.write('a.png', 'before');
  f.write('doc.markdown', '![short]\n\n![collapsed][]\n\n[short]: a.png\n[collapsed]: a.png\n\n    ![indented](a.png)\n\n~~~\n![fenced](a.png)\n~~~\n');
  const base = f.commit(); f.write('a.png', 'after'); const head = f.commit();
  const result = review({ repo: f.repo, base, head });
  assert.deepEqual(result.assets[0].documents[0].after.map(r => r.altSource), ['short', 'collapsed']);
  assert.equal(review({ repo: f.repo, base: head, head }).assets.length, 0);
});

test('explicit repository wins over inherited Git repository, object and config overrides', t => {
  const selected = fixture(t); selected.write('a.png', 'before'); selected.write('doc.md', '![selected](a.png)');
  const base = selected.commit(); selected.write('a.png', 'after'); const head = selected.commit();
  const unrelated = fixture(t); unrelated.write('other.md', 'unrelated'); unrelated.commit();
  const result = spawnSync(process.execPath, [path.join(__dirname, '../cli.cjs'), '--repo', selected.repo, '--json', base, head], {
    encoding: 'utf8', env: { ...process.env,
      GIT_DIR: path.join(unrelated.repo, '.git'), GIT_WORK_TREE: unrelated.repo,
      GIT_COMMON_DIR: path.join(unrelated.repo, '.git'), GIT_INDEX_FILE: path.join(unrelated.repo, '.git/index'),
      GIT_OBJECT_DIRECTORY: path.join(unrelated.repo, '.git/objects'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'not-a-valid-config-key', GIT_CONFIG_VALUE_0: 'bad',
      GIT_CONFIG_PARAMETERS: 'invalid configuration parameters',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.baseCommit, base); assert.equal(report.headCommit, head);
  assert.equal(report.assets[0].documents[0].after[0].altSource, 'selected');
});

test('subdirectory invocation ignores diff.relative without changing repository state', t => {
  const f = fixture(t);
  const svg = fill => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${fill}"/></svg>\n`;
  f.write('docs/panel.svg', svg('black')); f.write('images/banner.svg', svg('red'));
  f.write('docs/guide.md', '![Settings panel](panel.svg)\n\n![Project banner](../images/banner.svg)\n');
  const base = f.commit();
  f.write('docs/panel.svg', svg('blue')); f.write('images/banner.svg', svg('green'));
  const head = f.commit();
  f.git('config', '--local', 'diff.relative', 'true');
  const snapshot = () => ['.git/config', '.git/index', 'docs/panel.svg', 'images/banner.svg', 'docs/guide.md']
    .map(name => fs.readFileSync(path.join(f.repo, name)));
  const originalState = snapshot();
  const cli = path.join(__dirname, '../cli.cjs');
  const invocations = [
    { name: 'root control', args: ['--repo', f.repo], cwd: f.repo },
    { name: 'explicit subdirectory', args: ['--repo', path.join(f.repo, 'docs')], cwd: f.repo },
    { name: 'default repository from subdirectory', args: [], cwd: path.join(f.repo, 'docs') },
  ];
  const reports = invocations.map(({ name, args, cwd }) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json', base, head], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.deepEqual(snapshot(), originalState, `${name}: repository state changed`);
    return JSON.parse(result.stdout);
  });
  const expected = reports[0];
  assert.deepEqual(expected.assets.map(a => a.after), ['docs/panel.svg', 'images/banner.svg']);
  assert.deepEqual(expected.skippedReferences, []);
  for (const [i, asset] of expected.assets.entries()) {
    assert.equal(asset.documents.length, 1);
    const doc = asset.documents[0];
    assert.equal(doc.beforeDocument, 'docs/guide.md'); assert.equal(doc.afterDocument, 'docs/guide.md');
    assert.equal(doc.documentChanged, false); assert.equal(doc.altComparison, 'unchanged');
    for (const side of ['before', 'after']) {
      assert.equal(doc[side].length, 1);
      assert.equal(doc[side][0].altSource, ['Settings panel', 'Project banner'][i]);
      assert.equal(doc[side][0].targetExists, true);
    }
  }
  assert.deepEqual(reports.slice(1), [expected, expected]);
});

test('invalid UTF-8 Markdown is rejected rather than replacement-decoded', t => {
  const f = fixture(t); f.write('a.png', 'before'); f.write('doc.md', Buffer.from([0x23, 0x20, 0xff, 0x0a]));
  const base = f.commit(); f.write('a.png', 'after'); const head = f.commit();
  assert.throws(() => review({ repo: f.repo, base, head }), /Invalid UTF-8 in Git cat-file output/);
});

test('one blob parse per review preserves repeated and moved documents, paths and diagnostics', t => {
  const f = fixture(t);
  const source = '![Panel](panel.svg)\n\n![Outside](../outside.png)\n\n![Remote](https://example.invalid/panel.svg)\n';
  for (const folder of ['', 'left/', 'right/']) f.write(`${folder}guide.md`, source);
  const images = ['panel.svg', 'left/panel.svg', 'right/panel.svg', 'moved/panel.svg'];
  for (const image of images) f.write(image, `Before ${image}\n`);
  const base = f.commit();
  f.git('mv', 'left/guide.md', 'moved/guide.md');
  for (const image of images) f.write(image, `After ${image}\n`);
  const head = f.commit();
  const script = `
    const cp = require('node:child_process');
    const original = cp.spawnSync;
    let reads = 0;
    cp.spawnSync = (command, args, options) => {
      if (command === 'git' && args.includes('cat-file')) reads++;
      return original(command, args, options);
    };
    const { review } = require(process.argv[1]);
    const options = JSON.parse(process.argv[2]);
    const first = review(options);
    const firstReads = reads;
    reads = 0;
    const second = review(options);
    process.stdout.write(JSON.stringify({ first, second, firstReads, secondReads: reads }));
  `;
  const run = spawnSync(process.execPath, ['-e', script, path.join(__dirname, '../review.cjs'),
    JSON.stringify({ repo: f.repo, base, head })], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { first, second, firstReads, secondReads } = JSON.parse(run.stdout);
  assert.equal(firstReads, 1); assert.equal(secondReads, 1);
  assert.deepEqual(first, second);
  assert.equal(first.assets.length, 4);
  const pairs = new Map(first.assets.map(asset => [asset.after, asset.documents[0]]));
  for (const [image, doc] of pairs) {
    assert.equal(first.assets.find(asset => asset.after === image).documents.length, 1);
    for (const side of ['before', 'after']) for (const ref of doc[side]) {
      assert.equal(ref.assetPath, image); assert.equal(ref.occurrence, 1);
      assert.equal(ref.altSource, 'Panel'); assert.equal(ref.targetExists, true);
    }
  }
  assert.equal(pairs.get('panel.svg').documentChanged, false);
  assert.equal(pairs.get('right/panel.svg').documentChanged, false);
  assert.equal(pairs.get('left/panel.svg').altComparison, 'references-removed');
  assert.equal(pairs.get('moved/panel.svg').altComparison, 'references-added');
  for (const image of ['left/panel.svg', 'moved/panel.svg']) {
    assert.equal(pairs.get(image).beforeDocument, 'left/guide.md');
    assert.equal(pairs.get(image).afterDocument, 'moved/guide.md');
  }
  assert.deepEqual(first.skippedReferences.map(({ side, document, occurrence, reason }) =>
    [side, document, occurrence, reason]), [
    ['before', 'guide.md', 2, 'destination outside repository'],
    ['before', 'guide.md', 3, 'non-local destination'],
    ['before', 'left/guide.md', 3, 'non-local destination'],
    ['before', 'right/guide.md', 3, 'non-local destination'],
    ['after', 'guide.md', 2, 'destination outside repository'],
    ['after', 'guide.md', 3, 'non-local destination'],
    ['after', 'moved/guide.md', 3, 'non-local destination'],
    ['after', 'right/guide.md', 3, 'non-local destination'],
  ]);
});

test('invalid UTF-8 tracked paths are rejected rather than replacement-decoded', t => {
  const f = fixture(t); f.write('a.png', 'before');
  const invalidPath = Buffer.concat([Buffer.from(f.repo + '/bad-'), Buffer.from([0xff]), Buffer.from('.md')]);
  fs.writeFileSync(invalidPath, '![image](a.png)');
  const base = f.commit(); f.write('a.png', 'after'); const head = f.commit();
  assert.throws(() => review({ repo: f.repo, base, head }), /Invalid UTF-8 in Git ls-tree output/);
});
