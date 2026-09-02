# Tiletag

A dependency-free tileset workbench. Import multiple spritesheets, inspect every tile as a separate image, tag tile coordinates, and combine tiles from different sheets on a temporary level-editor grid.

**Live app:** <https://johannespertl.github.io/tileset-viewer/>

## Run locally

Open `index.html` directly, or serve the directory with any static server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Publish on GitHub Pages

1. Push these files to a GitHub repository.
2. Open **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select your main branch and the `/ (root)` folder.

No build command or backend is required.

## Use it

1. Import one or more spritesheets and set the tile size for each sheet.
2. Select a tile in the library, then tap cells in the test grid to place it. Tapping a cell that already holds that same tile removes it, and the grid grows automatically as you place tiles past its edges.
3. Drag the grid to pan. Pinch, scroll, or use the zoom controls to zoom.
4. Add tags such as `corner`, `left edge`, or `platform` to selected library tiles.
5. Export all imported tilesets and their tags as JSON.

The test grid is deliberately temporary and is never exported. Its only purpose is checking how tiles from one or more tilesets work together.

## Tag exports

Images are processed locally and never uploaded. An export describes all imported tilesets and their tagged, zero-based `(x, y)` tile coordinates. It does not embed image pixels or the temporary test layout. Import the original source images alongside a tag export to restore their annotations.

Older `tiletag-project` JSON files can still be imported so existing annotations are not lost.
