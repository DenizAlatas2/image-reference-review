'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path').posix;
const { lexer } = require('marked');

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?)$/i;
const MARKDOWN = /\.(?:md|markdown)$/i;
const REGULAR = new Set(['100644', '100755']);

function git(repo, args) {
  // The selected repository and snapshots must not depend on the caller's Git context.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' });
  const result = spawnSync('git', ['--no-pager', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], {
    maxBuffer: 32 * 1024 * 1024, env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8').trim() || `git exited ${result.status}`);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout);
  } catch {
    throw new Error(`Invalid UTF-8 in Git ${args[0]} output; only UTF-8 paths and Markdown are supported`);
  }
}

function resolveCommit(repo, revision) {
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
}

function tree(repo, commit) {
  const files = new Map();
  for (const record of git(repo, ['ls-tree', '-rz', '--full-tree', commit]).split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (type === 'blob' && REGULAR.has(mode)) files.set(record.slice(tab + 1), { oid, mode });
  }
  return files;
}

function changes(repo, base, head) {
  const parts = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all',
    '--find-renames', '--name-status', '-z', base, head, '--']).split('\0');
  const result = [];
  for (let i = 0; i < parts.length && parts[i];) {
    const status = parts[i++];
    const first = parts[i++];
    if (status.startsWith('R')) result.push({ status, before: first, after: parts[i++] });
    else result.push({ status, before: status === 'A' ? null : first, after: status === 'D' ? null : first });
  }
  return result;
}

function imageTokens(tokens) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image') { found.push(value); return; }
    if (['html', 'code', 'codespan'].includes(value.type)) return;
    for (const key of ['tokens', 'items', 'header', 'rows']) if (value[key]) visit(value[key]);
  }
  visit(tokens);
  return found;
}

function localPath(doc, href, siteRoot) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return { reason: 'non-local destination' };
  // marked exposes destination entities verbatim; do not guess at HTML decoding.
  if (/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i.test(href)) return { reason: 'entity-encoded destination unsupported' };
  let destination;
  try { destination = decodeURIComponent(href.split(/[?#]/, 1)[0]); }
  catch { return { reason: 'invalid percent encoding' }; }
  if (!destination || destination.includes('\0') || destination.includes('\\')) return { reason: 'unsupported destination' };
  if (destination.startsWith('/') && siteRoot === undefined) return { reason: 'root-relative destination needs --site-root' };
  const resolved = path.normalize(destination.startsWith('/')
    ? path.join(siteRoot, destination.slice(1)) : path.join(path.dirname(doc), destination));
  if (resolved === '..' || resolved.startsWith('../') || path.isAbsolute(resolved)) return { reason: 'destination outside repository' };
  return { path: resolved };
}

function references(repo, files, siteRoot, diagnostics, side) {
  const byAsset = new Map();
  for (const [doc, file] of files) {
    if (!MARKDOWN.test(doc)) continue;
    const source = git(repo, ['cat-file', 'blob', file.oid]);
    let occurrence = 0;
    for (const token of imageTokens(lexer(source, { gfm: true }))) {
      occurrence++;
      const destination = localPath(doc, token.href, siteRoot);
      if (!destination.path) {
        diagnostics.push({ side, document: doc, occurrence, href: token.href, reason: destination.reason });
        continue;
      }
      if (!byAsset.has(destination.path)) byAsset.set(destination.path, new Map());
      const docs = byAsset.get(destination.path);
      if (!docs.has(doc)) docs.set(doc, []);
      docs.get(doc).push({ occurrence, href: token.href, altSource: token.text,
        assetPath: destination.path, targetExists: files.has(destination.path) });
    }
  }
  return byAsset;
}

function review({ repo = '.', base, head, siteRoot }) {
  if (!base || !head) throw new Error('Two explicit Git revisions are required');
  if (siteRoot !== undefined) {
    siteRoot = path.normalize(siteRoot);
    if (path.isAbsolute(siteRoot) || siteRoot === '..' || siteRoot.startsWith('../') || siteRoot.includes('\\')) {
      throw new Error('--site-root must be a repository-relative directory');
    }
  }
  const baseCommit = resolveCommit(repo, base);
  const headCommit = resolveCommit(repo, head);
  const beforeTree = tree(repo, baseCommit);
  const afterTree = tree(repo, headCommit);
  const delta = changes(repo, baseCommit, headCommit);
  const documentRenames = new Map(delta.filter(c => c.status.startsWith('R') &&
    MARKDOWN.test(c.before) && MARKDOWN.test(c.after)).map(c => [c.before, c.after]));
  const diagnostics = [];
  const beforeRefs = references(repo, beforeTree, siteRoot, diagnostics, 'before');
  const afterRefs = references(repo, afterTree, siteRoot, diagnostics, 'after');
  const assets = delta.filter(c => (c.before && IMAGE.test(c.before) && beforeTree.has(c.before)) ||
    (c.after && IMAGE.test(c.after) && afterTree.has(c.after))).map(change => {
    // Retain references to missing paths, including stale links after deletion/rename.
    const paths = [...new Set([change.before, change.after].filter(Boolean))];
    function collect(index) {
      const docs = new Map();
      for (const assetPath of paths) for (const [doc, refs] of index.get(assetPath) || []) {
        docs.set(doc, [...(docs.get(doc) || []), ...refs]);
      }
      for (const refs of docs.values()) refs.sort((a, b) => a.occurrence - b.occurrence);
      return docs;
    }
    const oldDocs = collect(beforeRefs);
    const newDocs = collect(afterRefs);
    const paired = new Map();
    for (const doc of oldDocs.keys()) paired.set(documentRenames.get(doc) || doc, doc);
    for (const doc of newDocs.keys()) if (!paired.has(doc)) {
      const previousName = [...documentRenames].find(([, to]) => to === doc)?.[0] || doc;
      paired.set(doc, beforeTree.has(previousName) ? previousName : null);
    }
    const documents = [...paired].sort(([a], [b]) => a.localeCompare(b)).map(([newName, oldName]) => {
      const oldReferences = oldDocs.get(oldName) || [];
      const newReferences = newDocs.get(newName) || [];
      const beforeDocument = oldName && beforeTree.has(oldName) ? oldName : null;
      const afterDocument = afterTree.has(newName) ? newName : null;
      const oldAlts = oldReferences.map(r => r.altSource);
      const newAlts = newReferences.map(r => r.altSource);
      const comparison = !oldReferences.length ? 'references-added' : !newReferences.length ? 'references-removed' :
        JSON.stringify(oldAlts) === JSON.stringify(newAlts) ? 'unchanged' : 'changed';
      return { beforeDocument, afterDocument,
        documentChanged: !beforeDocument || !afterDocument || beforeDocument !== afterDocument ||
          beforeTree.get(beforeDocument).oid !== afterTree.get(afterDocument).oid,
        altComparison: comparison, before: oldReferences, after: newReferences };
    });
    return { ...change, documents };
  });
  return { schemaVersion: 1, advisory: true, baseCommit, headCommit,
    siteRoot: siteRoot ?? null, assets, skippedReferences: diagnostics };
}

function format(report) {
  const lines = [`Image reference review (advisory)`, `${report.baseCommit} → ${report.headCommit}`,
    `${report.assets.length} changed image asset(s). Unchanged alt text can be correct.`, ''];
  for (const asset of report.assets) {
    lines.push(`${asset.status} ${JSON.stringify(asset.before === asset.after ? asset.after :
      `${asset.before ?? '(added)'} → ${asset.after ?? '(deleted)'}`)}`);
    if (!asset.documents.length) lines.push('  No supported Markdown references found in either snapshot. This does not prove the asset is unused.');
    for (const doc of asset.documents) {
      lines.push(`  ${JSON.stringify(doc.afterDocument || doc.beforeDocument)} [document ${doc.documentChanged ? 'changed' : 'unchanged'}; alt source ${doc.altComparison}]`);
      for (const side of ['before', 'after']) {
        for (const ref of doc[side]) lines.push(`    ${side} image #${ref.occurrence}: ${JSON.stringify(ref.altSource)} (${JSON.stringify(ref.href)})${ref.targetExists ? '' : ' [target missing]'}`);
      }
    }
  }
  if (report.skippedReferences.length) lines.push('', `${report.skippedReferences.length} skipped reference(s); see --json for reasons.`);
  return lines.join('\n') + '\n';
}
module.exports = { review, format };
