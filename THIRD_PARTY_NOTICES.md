# Third-party notices

## Lucide icons

`src/client/05-icons.js` vendors the SVG node data of the following
[Lucide](https://lucide.dev) icons (lucide-static v0.460.0) so the client bundle
stays a single plain-JavaScript module with `react` as its only runtime import:

`files`, `text-search`, `git-branch`, `folder`, `file`, `chevron-right`,
`refresh-cw`, `save`, `x`, `triangle-alert`, `lock`, `circle`,
`loader-circle`, `folder-tree`, `palette`, `check`

Lucide is licensed under the ISC License; the icons listed as derived from the
Feather project (`chevron-right`, `circle`, `lock`, `x`, …) additionally carry
the Feather MIT License. The full license texts ship in
[`licenses/lucide-LICENSE.txt`](licenses/lucide-LICENSE.txt).

The plugin's own layout, styles and remaining glyph composition are original to
this package (`dsh-workspace-ide`, MIT).
