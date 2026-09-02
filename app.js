const BASE_CELL_SIZE = 48;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 8;
const GRID_GROWTH_LIMIT = 100000;

const state = {
  sheets: [],
  brush: null,
  tool: "paint",
  query: "",
  previewSize: 72,
  pendingMetadata: [],
  level: {
    columns: 12,
    rows: 10,
    placements: new Map(),
  },
  view: {
    x: 0,
    y: 0,
    zoom: 1,
    initialized: false,
  },
  hoverCell: null,
};

const elements = {
  workspace: document.querySelector("#workspace"),
  fileInput: document.querySelector("#fileInput"),
  tagFileInput: document.querySelector("#tagFileInput"),
  addTilesetsButton: document.querySelector("#addTilesetsButton"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  importTagsButton: document.querySelector("#importTagsButton"),
  exportTagsButton: document.querySelector("#exportTagsButton"),
  dropzone: document.querySelector("#dropzone"),
  defaultTileSize: document.querySelector("#defaultTileSize"),
  searchInput: document.querySelector("#searchInput"),
  paletteZoom: document.querySelector("#paletteZoom"),
  sheetCount: document.querySelector("#sheetCount"),
  emptyLibrary: document.querySelector("#emptyLibrary"),
  tilesetList: document.querySelector("#tilesetList"),
  editor: document.querySelector("#editor"),
  brushStatus: document.querySelector("#brushStatus"),
  paintToolButton: document.querySelector("#paintToolButton"),
  eraseToolButton: document.querySelector("#eraseToolButton"),
  gridColumns: document.querySelector("#gridColumns"),
  gridRows: document.querySelector("#gridRows"),
  applyGridSizeButton: document.querySelector("#applyGridSizeButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  editorZoom: document.querySelector("#editorZoom"),
  fitGridButton: document.querySelector("#fitGridButton"),
  clearGridButton: document.querySelector("#clearGridButton"),
  canvasViewport: document.querySelector("#canvasViewport"),
  mapCanvas: document.querySelector("#mapCanvas"),
  canvasHelp: document.querySelector("#canvasHelp"),
  tagEmpty: document.querySelector("#tagEmpty"),
  tagEditor: document.querySelector("#tagEditor"),
  selectedTileCanvas: document.querySelector("#selectedTileCanvas"),
  selectedTileLabel: document.querySelector("#selectedTileLabel"),
  selectedTilePixels: document.querySelector("#selectedTilePixels"),
  tagInput: document.querySelector("#tagInput"),
  addTagButton: document.querySelector("#addTagButton"),
  tagCount: document.querySelector("#tagCount"),
  tagList: document.querySelector("#tagList"),
  mobileNav: document.querySelector(".mobile-nav"),
  toastRegion: document.querySelector("#toastRegion"),
};

function uid() {
  return globalThis.crypto?.randomUUID?.() || `sheet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampTileSize(value) {
  return clamp(Number.parseInt(value, 10) || 32, 1, 2048);
}

function clampGridSize(value, fallback) {
  return clamp(Number.parseInt(value, 10) || fallback, 2, 200);
}

function cleanName(fileName) {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function sheetById(id) {
  return state.sheets.find((sheet) => sheet.id === id) || null;
}

function selectedTile() {
  if (!state.brush) return null;
  const sheet = sheetById(state.brush.sheetId);
  const tile = sheet?.tiles[state.brush.tileIndex];
  return sheet && tile ? { sheet, tile } : null;
}

function annotationPosition(annotation, tileSize) {
  if (Number.isFinite(annotation.column) && Number.isFinite(annotation.row)) {
    return { column: annotation.column, row: annotation.row };
  }
  if (annotation.grid && Number.isFinite(annotation.grid.x) && Number.isFinite(annotation.grid.y)) {
    return { column: annotation.grid.x, row: annotation.grid.y };
  }
  if (Number.isFinite(annotation.pixelX) && Number.isFinite(annotation.pixelY)) {
    return {
      column: Math.floor(annotation.pixelX / tileSize),
      row: Math.floor(annotation.pixelY / tileSize),
    };
  }
  return {
    column: Number.isFinite(annotation.x) ? annotation.x : -1,
    row: Number.isFinite(annotation.y) ? annotation.y : -1,
  };
}

function createTiles(width, height, tileSize, annotations = []) {
  const columns = Math.floor(width / tileSize);
  const rows = Math.floor(height / tileSize);
  const tagMap = new Map();

  annotations.forEach((annotation) => {
    const { column, row } = annotationPosition(annotation, tileSize);
    if (!Number.isInteger(column) || !Number.isInteger(row)) return;
    const tags = Array.isArray(annotation.tags)
      ? annotation.tags.map((tag) => String(tag).trim().toLocaleLowerCase()).filter(Boolean)
      : [];
    tagMap.set(`${column},${row}`, [...new Set(tags)]);
  });

  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push({
        index: tiles.length,
        column,
        row,
        x: column * tileSize,
        y: row * tileSize,
        tags: tagMap.get(`${column},${row}`) || [],
      });
    }
  }
  return { columns, rows, tiles };
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image"));
    image.src = source;
  });
}

function metadataTileSize(metadata) {
  return clampTileSize(metadata?.tileSize ?? metadata?.tile?.width ?? metadata?.tile?.size);
}

function metadataMatchesFile(metadata, file, image) {
  if (metadata.fileName === file.name) return true;
  return metadata.name === cleanName(file.name) &&
    metadata.image?.width === image.naturalWidth &&
    metadata.image?.height === image.naturalHeight;
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) =>
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name),
  );
  elements.fileInput.value = "";
  if (!files.length) {
    showToast("Choose one or more image files");
    return;
  }

  let imported = 0;
  for (const file of files) {
    const source = URL.createObjectURL(file);
    try {
      const image = await loadImage(source);
      const metadata = state.pendingMetadata.find((item) => metadataMatchesFile(item, file, image));
      const requestedSize = metadata ? metadataTileSize(metadata) : clampTileSize(elements.defaultTileSize.value);
      const tileSize = Math.min(requestedSize, image.naturalWidth, image.naturalHeight);
      const grid = createTiles(image.naturalWidth, image.naturalHeight, tileSize, metadata?.tiles || []);
      state.sheets.push({
        id: uid(),
        name: metadata?.name || cleanName(file.name),
        fileName: file.name,
        source,
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        tileSize,
        ...grid,
      });
      imported += 1;
    } catch (error) {
      URL.revokeObjectURL(source);
      showToast(`${file.name}: ${error.message}`);
    }
  }

  renderLibrary();
  if (imported) showToast(`${imported} tileset${imported === 1 ? "" : "s"} added`);
}

function visibleTiles(sheet) {
  const query = state.query.trim().toLocaleLowerCase();
  if (!query || sheet.name.toLocaleLowerCase().includes(query)) return sheet.tiles;
  const compact = query.replace(/[()\s]/g, "");
  return sheet.tiles.filter((tile) =>
    String(tile.index).includes(query.replace(/^#/, "")) ||
    `${tile.column},${tile.row}`.includes(compact) ||
    tile.tags.some((tag) => tag.includes(query)),
  );
}

function renderLibrary() {
  const sheetLabel = `${state.sheets.length} set${state.sheets.length === 1 ? "" : "s"}`;
  elements.sheetCount.textContent = sheetLabel;
  elements.emptyLibrary.hidden = state.sheets.length > 0;
  elements.exportTagsButton.disabled = state.sheets.length === 0;

  elements.tilesetList.innerHTML = state.sheets.map((sheet) => {
    const tiles = visibleTiles(sheet);
    const tagged = sheet.tiles.filter((tile) => tile.tags.length).length;
    const tileMarkup = tiles.map((tile) => {
      const selected = state.brush?.sheetId === sheet.id && state.brush.tileIndex === tile.index;
      return `
        <button class="tile-card ${selected ? "is-selected" : ""}" type="button" data-select-sheet="${sheet.id}" data-select-tile="${tile.index}" aria-pressed="${selected}">
          <canvas class="tile-art" width="${sheet.tileSize}" height="${sheet.tileSize}" data-preview-sheet="${sheet.id}" data-preview-tile="${tile.index}"></canvas>
          <span class="tile-label"><span>${tile.column},${tile.row}</span><span>${tile.tags.length ? escapeHtml(tile.tags.join(" · ")) : `#${tile.index}`}</span></span>
        </button>
      `;
    }).join("");

    return `
      <section class="tileset-group" data-sheet-group="${sheet.id}">
        <div class="tileset-header">
          <div class="tileset-title">
            <input class="tileset-name" value="${escapeAttribute(sheet.name)}" maxlength="80" data-sheet-name="${sheet.id}" aria-label="Tileset name" />
            <span class="tileset-meta">${sheet.width}×${sheet.height}px · ${sheet.columns}×${sheet.rows} tiles · ${tagged} tagged</span>
          </div>
          <label class="sheet-size">
            <input type="number" min="1" max="2048" value="${sheet.tileSize}" inputmode="numeric" data-sheet-size="${sheet.id}" aria-label="Tile size for ${escapeAttribute(sheet.name)}" /><span>px</span>
          </label>
          <button class="sheet-action apply" type="button" data-sheet-action="apply" data-sheet-id="${sheet.id}">Apply</button>
          <button class="sheet-action remove" type="button" data-sheet-action="remove" data-sheet-id="${sheet.id}" aria-label="Remove ${escapeAttribute(sheet.name)}">×</button>
        </div>
        <div class="tile-palette" style="--tile-preview:${state.previewSize}px">${tileMarkup}</div>
        ${tiles.length ? "" : '<div class="tileset-empty">No matching tiles</div>'}
      </section>
    `;
  }).join("");

  requestAnimationFrame(drawPreviewCanvases);
}

function drawTile(canvas, sheet, tile) {
  if (!canvas || !sheet?.image || !tile) return;
  if (canvas.width !== sheet.tileSize) canvas.width = sheet.tileSize;
  if (canvas.height !== sheet.tileSize) canvas.height = sheet.tileSize;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    sheet.image,
    tile.x,
    tile.y,
    sheet.tileSize,
    sheet.tileSize,
    0,
    0,
    sheet.tileSize,
    sheet.tileSize,
  );
}

function drawPreviewCanvases() {
  document.querySelectorAll("[data-preview-sheet][data-preview-tile]").forEach((canvas) => {
    const sheet = sheetById(canvas.dataset.previewSheet);
    drawTile(canvas, sheet, sheet?.tiles[Number(canvas.dataset.previewTile)]);
  });
  const selection = selectedTile();
  if (selection) drawTile(elements.selectedTileCanvas, selection.sheet, selection.tile);
}

function selectTile(sheetId, tileIndex) {
  const sheet = sheetById(sheetId);
  if (!sheet?.tiles[tileIndex]) return;
  state.brush = { sheetId, tileIndex };
  state.tool = "paint";
  renderLibrary();
  renderTagEditor();
  renderEditorState();
  drawEditor();
  if (globalThis.matchMedia("(max-width: 780px)").matches) setMobileView("editor");
}

function renameSheet(sheetId, value) {
  const sheet = sheetById(sheetId);
  if (!sheet) return;
  sheet.name = value.trim() || sheet.name;
  renderTagEditor();
  renderEditorState();
}

function applyTileSize(sheetId) {
  const sheet = sheetById(sheetId);
  const input = elements.tilesetList.querySelector(`[data-sheet-size="${sheetId}"]`);
  if (!sheet || !input) return;
  const tileSize = Math.min(clampTileSize(input.value), sheet.width, sheet.height);
  if (tileSize === sheet.tileSize) return;

  const hasTags = sheet.tiles.some((tile) => tile.tags.length);
  const hasPlacements = [...state.level.placements.values()].some((placement) => placement.sheetId === sheetId);
  if ((hasTags || hasPlacements) && !window.confirm("Changing this tile size rebuilds the tiles and removes its grid placements. Continue?")) {
    input.value = sheet.tileSize;
    return;
  }

  const annotations = sheet.tiles
    .filter((tile) => tile.tags.length && tile.x % tileSize === 0 && tile.y % tileSize === 0)
    .map((tile) => ({ column: tile.x / tileSize, row: tile.y / tileSize, tags: tile.tags }));
  Object.assign(sheet, { tileSize, ...createTiles(sheet.width, sheet.height, tileSize, annotations) });
  removePlacementsForSheet(sheetId);
  if (state.brush?.sheetId === sheetId) state.brush = null;
  renderLibrary();
  renderTagEditor();
  renderEditorState();
  drawEditor();
}

function removePlacementsForSheet(sheetId) {
  for (const [key, placement] of state.level.placements) {
    if (placement.sheetId === sheetId) state.level.placements.delete(key);
  }
}

function removeSheet(sheetId) {
  const sheet = sheetById(sheetId);
  if (!sheet || !window.confirm(`Remove “${sheet.name}” and its placed tiles?`)) return;
  URL.revokeObjectURL(sheet.source);
  state.sheets = state.sheets.filter((item) => item.id !== sheetId);
  removePlacementsForSheet(sheetId);
  if (state.brush?.sheetId === sheetId) state.brush = null;
  renderLibrary();
  renderTagEditor();
  renderEditorState();
  drawEditor();
}

function renderTagEditor() {
  const selection = selectedTile();
  elements.tagEmpty.hidden = Boolean(selection);
  elements.tagEditor.hidden = !selection;
  if (!selection) return;

  const { sheet, tile } = selection;
  elements.selectedTileLabel.textContent = `${sheet.name} · ${tile.column},${tile.row}`;
  elements.selectedTilePixels.textContent = `tile #${tile.index} · pixel ${tile.x},${tile.y}`;
  elements.tagCount.textContent = tile.tags.length;
  elements.tagList.innerHTML = tile.tags.length
    ? tile.tags.map((tag) => `<button class="tag-chip" type="button" data-remove-tag="${escapeAttribute(tag)}">${escapeHtml(tag)} <span aria-hidden="true">×</span></button>`).join("")
    : '<span class="empty-tags">No tags yet</span>';
  requestAnimationFrame(drawPreviewCanvases);
}

function addTags(rawValue) {
  const selection = selectedTile();
  const tags = [...new Set(rawValue.split(",").map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))];
  if (!selection || !tags.length) return;
  selection.tile.tags = [...new Set([...selection.tile.tags, ...tags])].sort();
  elements.tagInput.value = "";
  renderLibrary();
  renderTagEditor();
}

function removeTag(tag) {
  const selection = selectedTile();
  if (!selection) return;
  selection.tile.tags = selection.tile.tags.filter((item) => item !== tag);
  renderLibrary();
  renderTagEditor();
}

function exportTags() {
  if (!state.sheets.length) return;
  const payload = {
    format: "tiletag-project",
    version: 2,
    exportedAt: new Date().toISOString(),
    coordinateSystem: { origin: "top-left", units: "tiles", zeroBased: true },
    tilesets: state.sheets.map((sheet) => ({
      name: sheet.name,
      fileName: sheet.fileName,
      image: { width: sheet.width, height: sheet.height },
      tile: { width: sheet.tileSize, height: sheet.tileSize },
      tileSize: sheet.tileSize,
      grid: { columns: sheet.columns, rows: sheet.rows },
      tiles: sheet.tiles
        .filter((tile) => tile.tags.length)
        .map((tile) => ({ index: tile.index, x: tile.column, y: tile.row, tags: tile.tags })),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tiletag-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Tags exported");
}

function normalizeMetadata(payload) {
  if (payload?.format === "tiletag-tileset" && payload.tileset) return [payload.tileset];
  if (Array.isArray(payload?.tilesets)) return payload.tilesets;
  throw new Error("Not a Tiletag JSON file");
}

async function importTags(file) {
  try {
    const payload = JSON.parse(await file.text());
    const metadata = normalizeMetadata(payload);
    state.pendingMetadata = metadata;
    let restored = 0;

    state.sheets.forEach((sheet) => {
      const match = metadata.find((item) => item.fileName === sheet.fileName || (
        item.name === sheet.name && item.image?.width === sheet.width && item.image?.height === sheet.height
      ));
      if (!match) return;
      const tileSize = Math.min(metadataTileSize(match), sheet.width, sheet.height);
      Object.assign(sheet, {
        name: match.name || sheet.name,
        tileSize,
        ...createTiles(sheet.width, sheet.height, tileSize, match.tiles || []),
      });
      removePlacementsForSheet(sheet.id);
      if (state.brush?.sheetId === sheet.id) state.brush = null;
      restored += 1;
    });

    renderLibrary();
    renderTagEditor();
    renderEditorState();
    drawEditor();
    showToast(restored ? `Tags restored for ${restored} tileset${restored === 1 ? "" : "s"}` : "JSON loaded — add the matching images");
  } catch (error) {
    showToast(error.message || "Could not import JSON");
  } finally {
    elements.tagFileInput.value = "";
  }
}

function setMobileView(view) {
  elements.workspace.dataset.mobileView = view;
  elements.mobileNav.querySelectorAll("[data-mobile-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mobileTarget === view);
  });
  if (view === "editor") requestAnimationFrame(resizeEditorCanvas);
  if (view === "tags") requestAnimationFrame(drawPreviewCanvases);
}

function renderEditorState() {
  const selection = selectedTile();
  elements.paintToolButton.classList.toggle("is-active", state.tool === "paint");
  elements.eraseToolButton.classList.toggle("is-active", state.tool === "erase");
  elements.brushStatus.textContent = selection
    ? `${selection.sheet.name} · ${selection.tile.column},${selection.tile.row}`
    : state.tool === "erase" ? "Tap a tile to erase" : "Choose a tile";
  elements.editorZoom.textContent = `${Math.round(state.view.zoom * 100)}%`;
  elements.canvasHelp.hidden = Boolean(selection) || state.tool === "erase";
}

function setTool(tool) {
  state.tool = tool;
  renderEditorState();
  drawEditor();
}

function canvasSize() {
  return { width: elements.mapCanvas.clientWidth, height: elements.mapCanvas.clientHeight };
}

function resizeEditorCanvas() {
  const rect = elements.canvasViewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const nextWidth = Math.round(width * ratio);
  const nextHeight = Math.round(height * ratio);
  if (elements.mapCanvas.width !== nextWidth || elements.mapCanvas.height !== nextHeight) {
    elements.mapCanvas.width = nextWidth;
    elements.mapCanvas.height = nextHeight;
    elements.mapCanvas.style.width = `${width}px`;
    elements.mapCanvas.style.height = `${height}px`;
  }
  if (!state.view.initialized) fitGrid();
  else drawEditor();
}

function fitGrid() {
  const { width, height } = canvasSize();
  if (!width || !height) return;
  const padding = 24;
  state.view.zoom = clamp(Math.min(
    (width - padding * 2) / (state.level.columns * BASE_CELL_SIZE),
    (height - padding * 2) / (state.level.rows * BASE_CELL_SIZE),
  ), MIN_ZOOM, MAX_ZOOM);
  const cellSize = BASE_CELL_SIZE * state.view.zoom;
  state.view.x = (width - state.level.columns * cellSize) / 2;
  state.view.y = (height - state.level.rows * cellSize) / 2;
  state.view.initialized = true;
  renderEditorState();
  drawEditor();
}

function setZoom(nextZoom, anchorX, anchorY) {
  const oldZoom = state.view.zoom;
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  if (zoom === oldZoom) return;
  const worldX = (anchorX - state.view.x) / (BASE_CELL_SIZE * oldZoom);
  const worldY = (anchorY - state.view.y) / (BASE_CELL_SIZE * oldZoom);
  state.view.zoom = zoom;
  state.view.x = anchorX - worldX * BASE_CELL_SIZE * zoom;
  state.view.y = anchorY - worldY * BASE_CELL_SIZE * zoom;
  renderEditorState();
  drawEditor();
}

function visibleCellBounds(width, height, cellSize) {
  return {
    startColumn: clamp(Math.floor(-state.view.x / cellSize), 0, state.level.columns),
    endColumn: clamp(Math.ceil((width - state.view.x) / cellSize), 0, state.level.columns),
    startRow: clamp(Math.floor(-state.view.y / cellSize), 0, state.level.rows),
    endRow: clamp(Math.ceil((height - state.view.y) / cellSize), 0, state.level.rows),
  };
}

function drawEditor() {
  const canvas = elements.mapCanvas;
  const context = canvas.getContext("2d");
  const { width, height } = canvasSize();
  if (!width || !height) return;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const cellSize = BASE_CELL_SIZE * state.view.zoom;
  const gridWidth = state.level.columns * cellSize;
  const gridHeight = state.level.rows * cellSize;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#202622";
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(state.view.x, state.view.y, gridWidth, gridHeight);
  context.clip();
  context.fillStyle = "#303832";
  context.fillRect(state.view.x, state.view.y, gridWidth, gridHeight);

  const bounds = visibleCellBounds(width, height, cellSize);
  if (cellSize >= 12) {
    context.fillStyle = "rgba(255,255,255,.018)";
    for (let row = bounds.startRow; row < bounds.endRow; row += 1) {
      for (let column = bounds.startColumn; column < bounds.endColumn; column += 1) {
        if ((row + column) % 2 === 0) context.fillRect(state.view.x + column * cellSize, state.view.y + row * cellSize, cellSize, cellSize);
      }
    }
  }

  context.imageSmoothingEnabled = false;
  state.level.placements.forEach((placement, key) => {
    const [column, row] = key.split(",").map(Number);
    if (column < bounds.startColumn || column >= bounds.endColumn || row < bounds.startRow || row >= bounds.endRow) return;
    const sheet = sheetById(placement.sheetId);
    const tile = sheet?.tiles[placement.tileIndex];
    if (!sheet || !tile) return;
    context.drawImage(sheet.image, tile.x, tile.y, sheet.tileSize, sheet.tileSize, state.view.x + column * cellSize, state.view.y + row * cellSize, cellSize, cellSize);
  });

  if (cellSize >= 5) {
    context.beginPath();
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      const x = Math.round(state.view.x + column * cellSize) + .5;
      context.moveTo(x, state.view.y + bounds.startRow * cellSize);
      context.lineTo(x, state.view.y + bounds.endRow * cellSize);
    }
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      const y = Math.round(state.view.y + row * cellSize) + .5;
      context.moveTo(state.view.x + bounds.startColumn * cellSize, y);
      context.lineTo(state.view.x + bounds.endColumn * cellSize, y);
    }
    context.strokeStyle = "rgba(255,255,255,.16)";
    context.lineWidth = 1;
    context.stroke();
  }

  context.restore();

  if (state.hoverCell) {
    const { column, row } = state.hoverCell;
    const withinBounds = column >= 0 && row >= 0 && column < state.level.columns && row < state.level.rows;
    const isErase = state.tool === "erase";
    if (withinBounds || !isErase) {
      const cellX = state.view.x + column * cellSize;
      const cellY = state.view.y + row * cellSize;
      context.fillStyle = isErase ? "rgba(255,90,82,.25)" : "rgba(217,245,101,.23)";
      if (withinBounds) context.fillRect(cellX, cellY, cellSize, cellSize);
      context.strokeStyle = isErase ? "#ff746d" : "#d9f565";
      context.lineWidth = 2;
      if (!withinBounds) context.setLineDash([4, 3]);
      context.strokeRect(cellX + 1, cellY + 1, Math.max(0, cellSize - 2), Math.max(0, cellSize - 2));
      if (!withinBounds) context.setLineDash([]);
    }
  }

  context.strokeStyle = "rgba(255,255,255,.4)";
  context.lineWidth = 1;
  context.strokeRect(Math.round(state.view.x) + .5, Math.round(state.view.y) + .5, Math.round(gridWidth), Math.round(gridHeight));
}

function screenToCell(x, y) {
  const cellSize = BASE_CELL_SIZE * state.view.zoom;
  return {
    column: Math.floor((x - state.view.x) / cellSize),
    row: Math.floor((y - state.view.y) / cellSize),
  };
}

function growGridIfNeeded(column, row) {
  const level = state.level;
  const shiftX = column < 0 ? -column : 0;
  const shiftY = row < 0 ? -row : 0;
  const columns = Math.max(level.columns + shiftX, column + shiftX + 1);
  const rows = Math.max(level.rows + shiftY, row + shiftY + 1);
  if (columns > GRID_GROWTH_LIMIT || rows > GRID_GROWTH_LIMIT) return null;

  if (shiftX || shiftY) {
    const shifted = new Map();
    level.placements.forEach((placement, key) => {
      const [placedColumn, placedRow] = key.split(",").map(Number);
      shifted.set(`${placedColumn + shiftX},${placedRow + shiftY}`, placement);
    });
    level.placements = shifted;
    const cellSize = BASE_CELL_SIZE * state.view.zoom;
    state.view.x -= shiftX * cellSize;
    state.view.y -= shiftY * cellSize;
  }

  level.columns = columns;
  level.rows = rows;
  elements.gridColumns.value = columns;
  elements.gridRows.value = rows;
  return { column: column + shiftX, row: row + shiftY };
}

function interactWithCell(x, y, forceErase = false) {
  const cell = screenToCell(x, y);

  if (forceErase || state.tool === "erase") {
    const withinBounds = cell.column >= 0 && cell.row >= 0 && cell.column < state.level.columns && cell.row < state.level.rows;
    if (withinBounds) state.level.placements.delete(`${cell.column},${cell.row}`);
    drawEditor();
    return;
  }

  const selection = selectedTile();
  if (!selection) {
    showToast("Choose a tile first");
    return;
  }
  const grown = growGridIfNeeded(cell.column, cell.row);
  if (!grown) {
    showToast("Grid can’t grow any further");
    return;
  }
  const key = `${grown.column},${grown.row}`;
  const existing = state.level.placements.get(key);
  if (existing && existing.sheetId === selection.sheet.id && existing.tileIndex === selection.tile.index) {
    state.level.placements.delete(key);
  } else {
    state.level.placements.set(key, { sheetId: selection.sheet.id, tileIndex: selection.tile.index });
  }
  state.hoverCell = grown;
  drawEditor();
}

function applyGridSize() {
  const columns = clampGridSize(elements.gridColumns.value, state.level.columns);
  const rows = clampGridSize(elements.gridRows.value, state.level.rows);
  const removed = [...state.level.placements.keys()].filter((key) => {
    const [column, row] = key.split(",").map(Number);
    return column >= columns || row >= rows;
  });
  if (removed.length && !window.confirm(`Resize and remove ${removed.length} placed tile${removed.length === 1 ? "" : "s"} outside the new grid?`)) {
    elements.gridColumns.value = state.level.columns;
    elements.gridRows.value = state.level.rows;
    return;
  }
  removed.forEach((key) => state.level.placements.delete(key));
  state.level.columns = columns;
  state.level.rows = rows;
  elements.gridColumns.value = columns;
  elements.gridRows.value = rows;
  fitGrid();
}

function clearGrid() {
  if (!state.level.placements.size) return;
  if (!window.confirm("Clear the temporary grid?")) return;
  state.level.placements.clear();
  drawEditor();
}

const pointers = new Map();
const gesture = { primaryId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, wasPinch: false, pinch: null };

function localPoint(event) {
  const rect = elements.canvasViewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginPinch() {
  const points = [...pointers.values()].slice(0, 2);
  if (points.length < 2) return;
  const middleX = (points[0].x + points[1].x) / 2;
  const middleY = (points[0].y + points[1].y) / 2;
  const distance = Math.max(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 1);
  gesture.pinch = {
    distance,
    zoom: state.view.zoom,
    worldX: (middleX - state.view.x) / (BASE_CELL_SIZE * state.view.zoom),
    worldY: (middleY - state.view.y) / (BASE_CELL_SIZE * state.view.zoom),
  };
  gesture.wasPinch = true;
}

function updatePinch() {
  const points = [...pointers.values()].slice(0, 2);
  if (points.length < 2 || !gesture.pinch) return;
  const middleX = (points[0].x + points[1].x) / 2;
  const middleY = (points[0].y + points[1].y) / 2;
  const distance = Math.max(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 1);
  const zoom = clamp(gesture.pinch.zoom * distance / gesture.pinch.distance, MIN_ZOOM, MAX_ZOOM);
  state.view.zoom = zoom;
  state.view.x = middleX - gesture.pinch.worldX * BASE_CELL_SIZE * zoom;
  state.view.y = middleY - gesture.pinch.worldY * BASE_CELL_SIZE * zoom;
  renderEditorState();
  drawEditor();
}

function handlePointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const point = localPoint(event);
  pointers.set(event.pointerId, point);
  elements.canvasViewport.setPointerCapture(event.pointerId);
  if (pointers.size === 1) {
    Object.assign(gesture, { primaryId: event.pointerId, startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, moved: false, wasPinch: false, pinch: null });
  } else if (pointers.size === 2) {
    beginPinch();
  }
}

function handlePointerMove(event) {
  const point = localPoint(event);
  if (!pointers.has(event.pointerId)) {
    state.hoverCell = screenToCell(point.x, point.y);
    drawEditor();
    return;
  }
  pointers.set(event.pointerId, point);
  if (pointers.size >= 2) {
    updatePinch();
    return;
  }
  if (event.pointerId !== gesture.primaryId) return;
  if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) > 7) gesture.moved = true;
  if (gesture.moved) {
    state.view.x += point.x - gesture.lastX;
    state.view.y += point.y - gesture.lastY;
    elements.canvasViewport.classList.add("is-panning");
    drawEditor();
  }
  gesture.lastX = point.x;
  gesture.lastY = point.y;
}

function finishPointer(event, cancelled = false) {
  const point = localPoint(event);
  const shouldPlace = !cancelled && pointers.size === 1 && event.pointerId === gesture.primaryId && !gesture.moved && !gesture.wasPinch;
  pointers.delete(event.pointerId);
  if (elements.canvasViewport.hasPointerCapture(event.pointerId)) elements.canvasViewport.releasePointerCapture(event.pointerId);
  if (shouldPlace) interactWithCell(point.x, point.y);
  if (pointers.size === 1) {
    const [id, remaining] = pointers.entries().next().value;
    Object.assign(gesture, { primaryId: id, startX: remaining.x, startY: remaining.y, lastX: remaining.x, lastY: remaining.y, moved: true, wasPinch: true, pinch: null });
  } else if (!pointers.size) {
    gesture.primaryId = null;
    gesture.pinch = null;
    elements.canvasViewport.classList.remove("is-panning");
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

elements.addTilesetsButton.addEventListener("click", () => elements.fileInput.click());
elements.emptyAddButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.importTagsButton.addEventListener("click", () => elements.tagFileInput.click());
elements.tagFileInput.addEventListener("change", (event) => event.target.files[0] && importTags(event.target.files[0]));
elements.exportTagsButton.addEventListener("click", exportTags);

["dragenter", "dragover"].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
}));
elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderLibrary();
});
elements.paletteZoom.addEventListener("input", (event) => {
  state.previewSize = Number(event.target.value);
  renderLibrary();
});

elements.tilesetList.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-select-sheet][data-select-tile]");
  if (tile) {
    selectTile(tile.dataset.selectSheet, Number(tile.dataset.selectTile));
    return;
  }
  const action = event.target.closest("[data-sheet-action]");
  if (!action) return;
  if (action.dataset.sheetAction === "apply") applyTileSize(action.dataset.sheetId);
  if (action.dataset.sheetAction === "remove") removeSheet(action.dataset.sheetId);
});
elements.tilesetList.addEventListener("change", (event) => {
  if (event.target.matches("[data-sheet-name]")) renameSheet(event.target.dataset.sheetName, event.target.value);
});
elements.tilesetList.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("[data-sheet-size]")) applyTileSize(event.target.dataset.sheetSize);
});

elements.addTagButton.addEventListener("click", () => addTags(elements.tagInput.value));
elements.tagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTags(event.currentTarget.value);
  }
});
elements.tagList.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-tag]");
  if (chip) removeTag(chip.dataset.removeTag);
});

elements.mobileNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mobile-target]");
  if (button) setMobileView(button.dataset.mobileTarget);
});

elements.paintToolButton.addEventListener("click", () => setTool("paint"));
elements.eraseToolButton.addEventListener("click", () => setTool("erase"));
elements.applyGridSizeButton.addEventListener("click", applyGridSize);
[elements.gridColumns, elements.gridRows].forEach((input) => input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyGridSize();
}));
elements.zoomOutButton.addEventListener("click", () => {
  const { width, height } = canvasSize();
  setZoom(state.view.zoom / 1.25, width / 2, height / 2);
});
elements.zoomInButton.addEventListener("click", () => {
  const { width, height } = canvasSize();
  setZoom(state.view.zoom * 1.25, width / 2, height / 2);
});
elements.fitGridButton.addEventListener("click", fitGrid);
elements.clearGridButton.addEventListener("click", clearGrid);

elements.canvasViewport.addEventListener("pointerdown", handlePointerDown);
elements.canvasViewport.addEventListener("pointermove", handlePointerMove);
elements.canvasViewport.addEventListener("pointerup", (event) => finishPointer(event));
elements.canvasViewport.addEventListener("pointercancel", (event) => finishPointer(event, true));
elements.canvasViewport.addEventListener("pointerleave", () => {
  if (pointers.size) return;
  state.hoverCell = null;
  drawEditor();
});
elements.canvasViewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  const point = localPoint(event);
  setZoom(state.view.zoom * Math.exp(-event.deltaY * .0015), point.x, point.y);
}, { passive: false });
elements.canvasViewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const point = localPoint(event);
  interactWithCell(point.x, point.y, true);
});

if ("ResizeObserver" in globalThis) new ResizeObserver(resizeEditorCanvas).observe(elements.canvasViewport);
else globalThis.addEventListener("resize", resizeEditorCanvas);

renderLibrary();
renderTagEditor();
renderEditorState();
requestAnimationFrame(resizeEditorCanvas);
