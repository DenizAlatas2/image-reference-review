# Image reference review

Replaced a screenshot, but the Markdown that describes it never appeared in the diff?

Find changed image assets and the Markdown documents that refer to them, including documents absent from the Git diff. Review their before/after label source alongside an image diff.

Use it when:

- A refreshed screenshot moves a button, but its image label still says "on the left".
- One diagram appears in several guides and you want to find the labels to review together.
- An image is renamed or deleted and you want to find Markdown references still using its old path.

Compare the commits before and after the image change, open the reported documents, and inspect their labels alongside the image in your usual diff viewer. The [demo below](#example) walks through a moved button referenced by two unchanged documents.

This small local prototype is advisory. It does not inspect pixels, generate alt text, or decide whether a description is correct. An unchanged description may still be right.

## Setup

Requires Git, npm and Node **22.12.0 or later**. For a new copy:

```sh
git clone https://github.com/DenizAlatas2/image-reference-review.git
cd image-reference-review
npm ci --ignore-scripts
npm test
node examples/demo.cjs
```

Already cloned or downloaded a ZIP? Open that project's folder and start at `npm ci` above.

Expect 11 passing tests, then a demo report with **one changed image asset** and **two unchanged documents**, `guide.md` and `help/faq.md`. The [example below](#example) explains what to review.

The only runtime dependency is exactly `marked@17.0.5`; `package-lock.json` pins its registry artifact and integrity hash. Setup downloads that dependency. Reviewing a repository is offline and never fetches missing Git objects.

**Verification:** fresh `npm ci --ignore-scripts` installs from the official npm registry passed with **Node 22.12.0 / npm 10.9.0** and **Node 24.19.0 / npm 11.9.0** on Linux with Git 2.52.0. Each used a separate source copy, empty dependency cache and home directory, and no existing `node_modules` or `NODE_PATH`; audit and funding requests were disabled. All 11 synthetic tests and the demo passed in both configurations. Other operating systems and Node versions have **not** been tested.

Why 22.12.0? The installed marked package declares Node >=20, but this tool uses CommonJS `require()` to load marked's ESM entry point. [Node's module history](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require) records unflagged support from 22.12.0 in the 22.x line. The package sets that supported baseline rather than promising every Node 20 or early Node 22 release works. Node 22.12.0 prints an `ExperimentalWarning` for this module loading; the tested commands still complete successfully.

## Use

```sh
node cli.cjs --repo /path/to/repo BASE_COMMIT HEAD_COMMIT
node cli.cjs --repo /path/to/repo --json BASE_COMMIT HEAD_COMMIT
node cli.cjs --repo /path/to/repo --site-root public BASE_COMMIT HEAD_COMMIT
```

- Supply two explicit commit hashes or commit-resolving refs. Tags work. Both refs are resolved to immutable commits before reading
- The comparison is exactly those two snapshots. Choose a merge-base explicitly if needed
- `--site-root public` maps `/img/a.png` to `public/img/a.png`; root-relative references are otherwise skipped with a reason
- Exit 0 means a report was produced, including when labels are unchanged or empty. Exit 2 means invalid input or a processing error
- The selected repository's index and working tree are not modified; uncommitted changes are not reviewed

## Example

```sh
node examples/demo.cjs
```

The demo creates and removes a synthetic Git repository. Only `images/settings panel.svg` changes: a button moves from left to right. The report finds two unchanged Markdown documents, including these unchanged labels:

```text
guide.md:    "Settings panel", "Save button on the left"
help/faq.md: "Settings panel"
```

A reviewer can inspect the directional label while leaving the generic one alone. The CLI does not infer that either is wrong. See [actual example output](examples/output.txt) for the full report; synthetic commit IDs change on each run.

### Historical example

An image-only update in [RateCalculator](https://github.com/raiguard/RateCalculator/pull/131) left nearby README prose saying 1.07 extra assemblers while the screenshot showed 1. The later README fix confirms the mismatch.
Comparing `d9e27fb` with `786ef0b` in a retrospective run surfaced the unchanged `README.md` through two screenshot references.
Both image labels were empty. The report points to the document for a reviewer to compare its prose with the image. It does not read the pixels or diagnose the mismatch.

## Scope

Supports local image references in `.md` and `.markdown`, including inline/reference-style images, relative paths, percent-encoded paths, repeated uses and Git-detected renames. It reports source labels, not computed DOM alt text.

HTML/MDX, templated/generated destinations, generated asset pipelines, remote images, image contents and accessibility conformance are outside scope. A report with no supported references is not proof an asset is unused or safe to delete. Skipped-reference diagnostics cover parsed image tokens, not every unrecognized construct. Paths and Markdown must be UTF-8. This is not a sandbox for hostile repositories and has no large-repository performance claim.

[Detailed behavior, limitations and evidence](REFERENCE.md) explain exactly what is covered. The 11 tests and demo use synthetic fixtures. A historical run on [github/docs #24041](https://github.com/github/docs/pull/24041) found no documents beyond the normal diff and did not recognize two Liquid-templated image references. These retrospective checks do not establish production readiness or adoption demand.

## Development and distribution

```sh
npm test
npm pack --dry-run --ignore-scripts
```

See [contributor guidance](AGENTS.md). `private: true` intentionally blocks npm publication; it does not prevent sharing the source in a public Git repository. No CI integration or registry release is configured.

## License

MIT, copyright 2026 Deniz Alatas. See [LICENSE](LICENSE).
