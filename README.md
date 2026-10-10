# Reading View Full Range

Keep the active note's native Reading View fully rendered while scrolling. This can help layouts such as floated elements that depend on earlier sections remaining in the document.

Enable the plugin and open a Markdown note in Reading View. There are no settings or commands. Only the **active Markdown view** is affected: switching to another pane, entering Editing View, or disabling the plugin restores the previous renderer's range. Inactive split panes keep normal virtualization.

Long notes can use more RAM and take longer to render. The impact depends on the note, its content, and other plugins. Native folding and asynchronous rendering still apply; this does not force folded content open or guarantee that embedded widgets finish immediately.

## Compatibility

Requires Obsidian **1.13.7** or newer. Confirmed working on Obsidian **1.14.4**.

The plugin uses internal Reading View behavior outside the public API, so Obsidian updates may require a compatibility fix. If an incompatibility notice appears, disable the plugin and check for an update.

## Manual installation

1. Download `main.js` and `manifest.json` from the GitHub release.
2. Put both files in `<vault>/.obsidian/plugins/reading-view-full-range/` (use your vault's configuration folder if customized).
3. Reload Obsidian and enable **Reading View Full Range** under **Settings → Community plugins**.

## Development

`main.js` is both the readable source and the distributable plugin. No build step, npm installation, or runtime dependencies are needed. Obsidian provides the `obsidian` module at runtime.

The plugin sets `renderExtraMinPx = Infinity` on the active renderer instance and calls its native `updateVirtualDisplay()` and `queueRender()` methods. It observes the view's internal `data-mode` attribute to track mode changes. Runtime structure checks cannot guarantee compatibility with future changes to these internals.

With Node.js 20 or newer, run `npm run check`, `npm test`, and `npm run release-check`. Tests use a simulated Obsidian API; verify renderer behavior in Obsidian before releasing.

The plugin makes no network requests, collects no telemetry, and does not write note files.

## License

MIT; see [LICENSE](LICENSE).
