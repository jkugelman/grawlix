# Grawlix

All code lives in a single file: `grawlix.html`. Read and edit only that file.

## Coding style

- **No inline styles.** Add CSS to the `<style>` block; never use `style="..."` attributes on elements.
- **Dark mode and light mode have equal weight.** Don't treat one as the default and the other as an override — both get first-class parallel treatment in the CSS.
- **Avoid duplicating functionality.** Unify JS, HTML, and CSS when reasonable. Prefer a single abstraction over copy-pasted variants to keep the UI consistent and maintainable.
