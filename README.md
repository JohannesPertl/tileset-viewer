# Tiletag

A dependency-free, static tileset viewer and tag editor. Import multiple image files, split them into a configurable grid, tag individual or grouped tiles, search annotations, and export the project as JSON.

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

## Data and exports

Tileset images are processed locally and never uploaded. The exported JSON contains tileset metadata, grid coordinates, and tags; it intentionally does not embed image pixels. When importing a project JSON, import the original source images to reconnect the annotations.
