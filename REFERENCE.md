# Scope and evidence

### Compared with simpler approaches

- **Diff plus manual search:** entirely adequate for one familiar document. In this example the diff does not show either document, and searching the exact spaced filename would miss the percent-encoded forms. Searching the basename more broadly can find them, after which the reviewer still resolves definitions and inspects both revisions. This tool packages those mechanical steps. It is not necessary when manual search is already easy.
- **IfChange/ThenChange-style declarations:** can express an explicit relationship and are suitable when a project wants enforced coupled changes. This prototype discovers supported references without annotations and permits a valid description to remain unchanged. It neither replaces those declarations nor claims to be the first tool to track dependencies.
- **Missing-alt linting:** asks a different question. Every reference in this example has nonempty alt source, including the directional label requiring human review. Conversely, empty alt can be intentional; this tool reports it without failing.
- **Image diff viewers:** help reviewers see the image change. This prototype does not render images; it supplies the document context to review alongside them.

## Three implementation steps

1. **Read immutable snapshots.** Resolve commits, list regular tracked files, and obtain additions, modifications, deletions and Git-detected renames. Read Markdown blobs by object ID, never by checking out files.
2. **Find supported references.** Parse all `.md` and `.markdown` files in both snapshots with marked. Resolve local destinations and retain every occurrence. Join them to changed assets, including unchanged documents and stale references after deletion or rename.
3. **Present evidence.** Compare ordered lists of label source for each document/asset pair and output readable text or JSON. Tests and the demo supply the evidence for the behavior claimed here.

The CLI invokes only Git read operations. Inherited `GIT_*` overrides are removed so the caller's Git context cannot replace the selected repository. External diff/textconv helpers and lazy fetching are disabled. It does not execute repository scripts, invoke AI, make network requests, modify the index/worktree, or generate alt text. Tests and the example create only their own temporary synthetic repositories and remove them afterward.

## Exact scope and limitations

- Image extensions: PNG, JPEG, GIF, WebP, SVG, AVIF, BMP, ICO and TIFF. Recognition is by filename, not file contents. Binary/pixel changes are not interpreted; mode-only changes can also be reported.
- Inline images, full/collapsed/shortcut reference-style images, angle-bracket destinations with spaces, percent-encoded paths, blockquotes, lists and GFM tables use the real parser. Fenced/indented code, inline code, and raw HTML image elements do not become Markdown image references.
- HTML attributes, MDX files/components, AsciiDoc, templated/generated destinations, includes, frontmatter semantics, redirects, and framework asset pipelines are out of scope. This is not a site's rendered dependency graph. Markdown image syntax embedded in an inline HTML context may still be parsed as Markdown by marked; no HTML/MDX semantics are inferred.
- Remote URLs, protocol-relative URLs, fragment-only destinations, escaping paths and unsupported destinations are skipped. JSON explains each skipped parsed reference, separately for each snapshot. Constructs not recognized as Markdown image tokens, including HTML/MDX and template syntax between a label and destination, do not receive per-reference diagnostics. No supported references is not proof an asset is unused or safe to delete.
- Entity-encoded destinations such as `a&amp;b.png` are explicitly skipped, rather than guessing at decoding. Malformed percent encoding and backslash destinations are also skipped.
- `altSource` is marked's source-label text, **not computed DOM alt text**. Emphasis/entity spelling differences can count as a source change even if rendered speech is identical. The CLI does not judge relevance, correctness, verbosity, decorative intent, or accessibility conformance.
- `altComparison` compares the ordered label lists for a document/asset pair. A changed occurrence count/order can change that result. The tool does not claim to match individual reference identities across edits. Image ordinals are within supported Markdown image occurrences in each document; they are not line numbers.
- Renames depend on Git's similarity detection. Undetected renames appear as deletion plus addition. For a detected rename, both old and new paths are considered on both sides to retain stale references. `targetExists` means a regular tracked file exists at that path in that snapshot, not that a published URL works.
- Non-UTF-8 repository paths or Markdown blobs are rejected with an explicit error, never silently replacement-decoded. Symlinks, submodules, Git LFS image contents, shallow histories lacking the requested objects and partial clones requiring missing objects are not supported. LFS pointers can reveal an asset object change, but actual image content is never retrieved.
- This small implementation reads and parses each unique Markdown blob once per review, sharing only immutable source tokens across documents and snapshots. Relative paths, occurrence numbers and diagnostics are still resolved separately for each document and snapshot. Its token cache and reference indexes remain in memory until the review finishes. Each Git output is capped at 32 MiB. No large-repository performance claim is made. Parsed input is local; this is not a sandbox for arbitrary hostile repository content.

## Why the review question is real, and why it stays advisory

The [github/docs screenshot-refresh PR #24041](https://github.com/github/docs/pull/24041) included review requests concerning existing alt wording: [first thread](https://github.com/github/docs/pull/24041#discussion_r1113425331), [second thread](https://github.com/github/docs/pull/24041#discussion_r1113427444), and [third thread](https://github.com/github/docs/pull/24041#discussion_r1113430819). This is qualitative motivation for bringing image references and their labels into a review. Some comments concern phrasing/style, so they do not establish that replacing an image automatically made its previous description wrong.

Counterexamples matter: [Elastic docs-content #6710](https://github.com/elastic/docs-content/pull/6710) says the existing prose/alt remains valid after a screenshot replacement; [Mautic user-documentation #886](https://github.com/mautic/user-documentation/pull/886) deliberately keeps alt while replacing nine screenshots. These cases motivate the absence of an unchanged-alt failure rule.

The adjacent [W3C vc-di-bbs #152](https://github.com/w3c/vc-di-bbs/pull/152) includes a diagram/terminology refresh and [confirmation of alt updates](https://github.com/w3c/vc-di-bbs/pull/152#discussion_r1579837238), but its HTML/SVG context is outside this Markdown-reference prototype's scope.

These discussions are qualitative context, not production validation, a novelty claim, or evidence of adoption demand. The GitHub Docs case was subsequently run as described below; the other repositories were not tested.

## One historical real-repository run

The CLI was run offline on [github/docs PR #24041](https://github.com/github/docs/pull/24041), comparing base [`3a39258fe41734dde8e71474a7035e4a709338b0`](https://github.com/github/docs/commit/3a39258fe41734dde8e71474a7035e4a709338b0) with head [`869541f2afb0f12b8cf287ab8a4b97f95949bd07`](https://github.com/github/docs/commit/869541f2afb0f12b8cf287ab8a4b97f95949bd07) and `--site-root .`. Both were authentic Git commits; all 4,761 Markdown documents per snapshot were scanned. Upstream scripts, builds and dependencies were not run or installed.

The report contained nine changed image assets and seven asset/document pairs across two distinct documents. Both documents already appeared in the ordinary diff: two label-source lists changed and five were removed. **No additional unchanged documents were surfaced.** The observed benefit was a compact cross-reference view, not a discovery the ordinary diff missed.

Two visibility screenshots had real [Liquid-templated references in `creating-gists.md`](https://github.com/github/docs/blob/869541f2afb0f12b8cf287ab8a4b97f95949bd07/content/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists.md#L78), but the CLI reported no supported references for them. Those constructs also did not appear in skipped-reference diagnostics. The four diagnostics were unrelated remote-image references, counted separately in the two snapshots. This illustrates the documented template limitation and why an empty result cannot establish that an image is unused.

The seven reported pairs matched the source references, and no unrelated document candidates were observed. No image-label correctness judgment was made. This one historical PR does not establish general usefulness, precision/recall, production readiness or adoption demand. The unchanged-document discovery benefit remains demonstrated by the synthetic fixtures, not by this real case.

Source documentation and assets: GitHub Docs contributors, [CC BY 4.0](https://github.com/github/docs/blob/869541f2afb0f12b8cf287ab8a4b97f95949bd07/LICENSE).
