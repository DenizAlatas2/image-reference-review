'use strict';
// Only this demonstration creates a temporary synthetic repository. The CLI is read-only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { review, format } = require('../review.cjs');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'image-reference-demo-'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const write = (name, text) => { const p = path.join(repo, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
try {
  git('init', '-q'); git('config', 'user.name', 'Synthetic Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('images/settings panel.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">Save on left</text></svg>\n');
  write('guide.md', '# Settings\n\n![Settings panel](<images/settings panel.svg>)\n\n![Save button on the left][save]\n\n[save]: images/settings%20panel.svg\n');
  write('help/faq.md', '# FAQ\n\n![Settings panel](../images/settings%20panel.svg)\n');
  git('add', '.'); git('commit', '-qm', 'Add synthetic settings documentation'); const base = git('rev-parse', 'HEAD');
  write('images/settings panel.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text x="200" y="20">Save on right</text></svg>\n');
  git('add', '.'); git('commit', '-qm', 'Move synthetic Save control'); const head = git('rev-parse', 'HEAD');
  console.log('Ordinary changed-file list:\n' + git('diff', '--name-only', base, head) + '\n');
  console.log(format(review({ repo, base, head })));
} finally { fs.rmSync(repo, { recursive: true, force: true }); }
