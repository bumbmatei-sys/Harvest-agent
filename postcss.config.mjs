// Tailwind v4 ships its PostCSS plugin in a package of its own; the
// `tailwindcss` package is no longer a PostCSS plugin at all.
//
// `autoprefixer` is deliberately gone rather than merely unused. v4 runs the
// output through Lightning CSS itself, which does the vendor prefixing (and
// the `@import` inlining `postcss-import` used to do) against the project's
// browserslist. Leaving autoprefixer in the chain would re-prefix already
// prefixed declarations — the upgrade guide's own instruction is to remove it.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
