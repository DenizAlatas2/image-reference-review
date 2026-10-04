#!/usr/bin/env node
'use strict';
const { review, format } = require('./review.cjs');
const usage = 'Usage: node cli.cjs [--repo DIR] [--site-root DIR] [--json] BASE HEAD\n';
try {
  const args = process.argv.slice(2);
  const options = {};
  const revisions = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { process.stdout.write(usage); process.exit(0); }
    if (args[i] === '--json') { json = true; continue; }
    if (['--repo', '--site-root'].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${args[i]} needs a value`);
      options[args[i] === '--repo' ? 'repo' : 'siteRoot'] = args[++i];
    } else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
    else revisions.push(args[i]);
  }
  if (revisions.length !== 2) throw new Error(usage.trim());
  const report = review({ ...options, base: revisions[0], head: revisions[1] });
  process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : format(report));
} catch (error) {
  process.stderr.write(`image-reference-review: ${error.message}\n`);
  process.exitCode = 2;
}
