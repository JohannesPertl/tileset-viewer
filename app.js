const BASE_CELL_SIZE = 64;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;

const state = {
  sheets: [],
  activeId: null,
  brush: null,
  tool: "paint",
  search: "",
  paletteSize: 80,
  pendingMetadata: [],
  level: {
    columns: 32,
    rows: 18,
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
  fileInput: document.querySelector("#fileInput"),
  tagFileInput: document.querySelector("#tagFileInput"),
  addTilesetsButton: document.querySelector("#addTilesetsButton"),
  importTagsButton: document.querySelector("#importTagsButton"),
  exportTagsButton: document.querySelector("#exportTagsButton"),
  dropzone: document.querySelector("#dropzone"),
  defaultTileSize: document.querySelector("#defaultTileSize"),
  paletteZoom: document.querySelector("#paletteZoom"),
  sheetCount: document.querySelector("#sheetCount"),
  sheetList: document.querySelector("#sheetList"),
  emptyLibrary: document.querySelector("#emptyLibrary"),
  activeLibrary: document.querySelector("#activeLibrary"),
  sheetNameInput: document.querySelector("#sheetNameInput"),
  activeTileSize: document.querySelector("#activeTileSize"),
  applyTileSizeButton: document.querySelector("#applyTileSizeButton"),
  removeSheetButton: document.querySelector("#removeSheetButton"),
  sheetMeta: document.querySelector("#sheetMeta"),
  searchInput: document.querySelector("#searchInput"),
  tilePalette: document.querySelector("#tilePalette"),
  noResults: document.querySelector("#noResults"),
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
  return clamp(Number.parseInt(value, 10) || fallback, 4, 200);
}

function cleanName(fileName) {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function activeSheet() {
  return state.sheets.find((sheet) => sheet.id === state.activeId) || null;
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
    tagMap.set(`${column},${row}`, Array.isArray(annotation.tags) ? annotation.tags : []);
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
        tags: [...new Set(tagMap.get(`${column},${row}`) || [])],
      });
    }
  }

  return { columns, rows, tiles };
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be decoded."));
    image.src = source;
  });
}

function metadataTileSize(metadata) {
  return clampTileSize(metadata?.tileSize ?? metadata?.tile?.width ?? metadata?.tile?.size);
}

function metadataMatchesFile(metadata, file, image) {
  if (metadata.fileName === file.name) return true;
  const dimensionsMatch =
    metadata.image?.width === image.naturalWidth &&
    metadata.image?.height === image.naturalHeight;
  return dimensionsMatch && metadata.name === cleanName(file.name);
}

function findMetadata(file, image) {
  return state.pendingMetadata.find((metadata) => metadataMatchesFile(metadata, file, image)) || null;
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) =>
    file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name),
  );
  if (!files.length) {
    elements.fileInput.value = "";
    showToast("Choose one or more image files.");
    return;
  }

  let imported = 0;
  let firstImportedId = null;

  for (const file of files) {
    const source = URL.createObjectURL(file);
    try {
      const image = await loadImage(source);
      const metadata = findMetadata(file, image);
      const requestedSize = metadata
        ? metadataTileSize(metadata)
        : clampTileSize(elements.defaultTileSize.value);
      const tileSize = Math.min(requestedSize, image.naturalWidth, image.naturalHeight);
      const grid = createTiles(
        image.naturalWidth,
        image.naturalHeight,
        tileSize,
        metadata?.tiles || [],
      );
      const sheet = {
        id: uid(),
        name: metadata?.name || cleanName(file.name),
        fileName: file.name,
        source,
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        tileSize,
        ...grid,
      };
      state.sheets.push(sheet);
      firstImportedId ||= sheet.id;
      imported += 1;
    } catch (error) {
      URL.revokeObjectURL(source);
      showToast(`${file.name}: ${error.message}`);
    }
  }

  if (imported) {
    state.activeId = firstImportedId;
    state.search = "";
    elements.searchInput.value = "";
    render();
    requestAnimationFrame(() => {
      if (!state.view.initialized) fitGrid();
    });
    showToast(`${imported} tileset${imported === 1 ? "" : "s"} imported.`);
  }

  elements.fileInput.value = "";
}

function setActiveSheet(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  state.search = "";
  elements.searchInput.value = "";
  render();
}

function visibleTiles(sheet) {
  const query = state.search.trim().toLocaleLowerCase();
  if (!query) return sheet.tiles;

  const coordinateQuery = query.replace(/[()\s]/g, "");
  return sheet.tiles.filter((tile) => {
    const matchesIndex = `#${tile.index}`.includes(query) || String(tile.index) === query;
    const matchesCoordinates =
      `${tile.column},${tile.row}`.includes(coordinateQuery) ||
      `x${tile.column}y${tile.row}`.includes(coordinateQuery);
    const matchesTag = tile.tags.some((tag) => tag.toLocaleLowerCase().includes(query));
    return matchesIndex || matchesCoordinates || matchesTag;
  });
}

function render() {
  const sheet = activeSheet();
  elements.sheetCount.textContent = state.sheets.length;
  elements.emptyLibrary.hidden = Boolean(sheet);
  elements.activeLibrary.hidden = !sheet;
  elements.exportTagsButton.disabled = !sheet;

  renderSheetList();

  if (sheet) {
    elements.sheetNameInput.value = sheet.name;
    elements.activeTileSize.value = sheet.tileSize;
    const remainderX = sheet.width % sheet.tileSize;
    const remainderY = sheet.height % sheet.tileSize;
    const remainder = remainderX || remainderY
      ? ` · unused edge ${remainderX}×${remainderY}px`
      : "";
    elements.sheetMeta.textContent =
      `${sheet.columns} × ${sheet.rows} tiles · ${sheet.width} × ${sheet.height}px${remainder}`;
    renderPalette();
  } else {
    elements.tilePalette.innerHTML = "";
  }

  renderTagEditor();
  renderEditorState();
  requestAnimationFrame(drawLibraryCanvases);
}

function renderSheetList() {
  elements.sheetList.innerHTML = state.sheets.map((sheet) => {
    const tagged = sheet.tiles.filter((tile) => tile.tags.length).length;
    return `
      <button class="sheet-card ${sheet.id === state.activeId ? "is-active" : ""}" type="button" data-sheet-id="${sheet.id}">
        <canvas class="sheet-thumbnail" data-sheet-thumbnail="${sheet.id}" width="42" height="42"></canvas>
        <span>
          <strong>${escapeHtml(sheet.name)}</strong>
          <span>${sheet.columns}×${sheet.rows} · ${tagged} tagged</span>
        </span>
      </button>
    `;
  }).join("");
}

function renderPalette() {
  const sheet = activeSheet();
  const tiles = visibleTiles(sheet);
  elements.tilePalette.style.setProperty("--tile-preview", `${state.paletteSize}px`);
  elements.tilePalette.innerHTML = tiles.map((tile) => {
    const selected = state.brush?.sheetId === sheet.id && state.brush.tileIndex === tile.index;
    const tagSummary = tile.tags.join(", ") || "untagged";
    return `
      <button
        class="tile-card ${selected ? "is-selected" : ""}"
        type="button"
        data-tile-index="${tile.index}"
        aria-pressed="${selected}"
        aria-label="Tile ${tile.index}, coordinate ${tile.column}, ${tile.row}, ${escapeAttribute(tagSummary)}"
      >
        <canvas class="tile-art" data-preview-sheet="${sheet.id}" data-preview-tile="${tile.index}"></canvas>
        <span class="tile-label">
          <span>(${tile.column},${tile.row})</span>
          <span>${tile.tags.length ? escapeHtml(tile.tags.join(" · ")) : `#${tile.index}`}</span>
        </span>
      </button>
    `;
  }).join("");
  elements.noResults.hidden = tiles.length > 0;
}

function drawCheckerboard(context, width, height) {
  const size = 8;
  context.fillStyle = "#e7eae4";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#dce1da";
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((x / size + y / size) % 2 === 0) context.fillRect(x, y, size, size);
    }
  }
}

function drawTileToCanvas(canvas, sheet, tile) {
  if (!canvas || !sheet?.image || !tile) return;
  const displayWidth = Math.max(1, Math.round(canvas.clientWidth || 80));
  const displayHeight = Math.max(1, Math.round(canvas.clientHeight || displayWidth));
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(displayWidth * ratio);
  canvas.height = Math.round(displayHeight * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, displayWidth, displayHeight);
  drawCheckerboard(context, displayWidth, displayHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    sheet.image,
    tile.x,
    tile.y,
    sheet.tileSize,
    sheet.tileSize,
    0,
    0,
    displayWidth,
    displayHeight,
  );
}

function drawLibraryCanvases() {
  document.querySelectorAll("[data-sheet-thumbnail]").forEach((canvas) => {
    const sheet = sheetById(canvas.dataset.sheetThumbnail);
    drawTileToCanvas(canvas, sheet, sheet?.tiles[0]);
  });

  document.querySelectorAll("[data-preview-sheet][data-preview-tile]").forEach((canvas) => {
    const sheet = sheetById(canvas.dataset.previewSheet);
    const tile = sheet?.tiles[Number(canvas.dataset.previewTile)];
    drawTileToCanvas(canvas, sheet, tile);
  });

  const selection = selectedTile();
  if (selection) drawTileToCanvas(elements.selectedTileCanvas, selection.sheet, selection.tile);
}

function selectTile(tileIndex) {
  const sheet = activeSheet();
  if (!sheet?.tiles[tileIndex]) return;
  state.brush = { sheetId: sheet.id, tileIndex };
  state.tool = "paint";
  renderPalette();
  renderTagEditor();
  renderEditorState();
  requestAnimationFrame(drawLibraryCanvases);
  drawEditor();
}

function renderTagEditor() {
  const selection = selectedTile();
  elements.tagEmpty.hidden = Boolean(selection);
  elements.tagEditor.hidden = !selection;
  if (!selection) return;

  const { sheet, tile } = selection;
  elements.selectedTileLabel.textContent = `${sheet.name} · (${tile.column},${tile.row})`;
  elements.selectedTilePixels.textContent = `#${tile.index} · pixel ${tile.x},${tile.y}`;
  elements.tagCount.textContent = tile.tags.length;
  elements.tagList.innerHTML = tile.tags.length
    ? tile.tags.map((tag) => `
        <button class="tag-chip" type="button" data-remove-tag="${escapeAttribute(tag)}" title="Remove tag">
          ${escapeHtml(tag)} <span aria-hidden="true">×</span>
        </button>
      `).join("")
    : '<span class="empty-tags">No tags yet.</span>';
}

function addTags(rawValue) {
  const selection = selectedTile();
  const tags = [...new Set(
    rawValue
      .split(",")
      .map((tag) => tag.trim().toLocaleLowerCase())
      .filter(Boolean),
  )];
  if (!selection || !tags.length) return;

  selection.tile.tags = [...new Set([...selection.tile.tags, ...tags])].sort();
  elements.tagInput.value = "";
  renderSheetList();
  renderPalette();
  renderTagEditor();
  requestAnimationFrame(drawLibraryCanvases);
}

function removeTag(tag) {
  const selection = selectedTile();
  if (!selection) return;
  selection.tile.tags = selection.tile.tags.filter((item) => item !== tag);
  renderSheetList();
  renderPalette();
  renderTagEditor();
  requestAnimationFrame(drawLibraryCanvases);
}

function applyTileSize() {
  const sheet = activeSheet();
  if (!sheet) return;
  const tileSize = Math.min(clampTileSize(elements.activeTileSize.value), sheet.width, sheet.height);
  if (tileSize === sheet.tileSize) return;

  const hasTags = sheet.tiles.some((tile) => tile.tags.length);
  const hasPlacements = [...state.level.placements.values()].some((placement) => placement.sheetId === sheet.id);
  if (
    (hasTags || hasPlacements) &&
    !window.confirm("Changing the tile size rebuilds this tileset. Tags at matching pixel origins are kept; its temporary grid placements are removed. Continue?")
  ) {
    elements.activeTileSize.value = sheet.tileSize;
    return;
  }

  const annotations = sheet.tiles
    .filter((tile) => tile.tags.length && tile.x % tileSize === 0 && tile.y % tileSize === 0)
    .map((tile) => ({
      column: tile.x / tileSize,
      row: tile.y / tileSize,
      tags: tile.tags,
    }));
  Object.assign(sheet, {
    tileSize,
    ...createTiles(sheet.width, sheet.height, tileSize, annotations),
  });
  removePlacementsForSheet(sheet.id);
  if (state.brush?.sheetId === sheet.id) state.brush = null;
  render();
  drawEditor();
  showToast(`Tileset rebuilt as ${tileSize}px tiles.`);
}

function removePlacementsForSheet(sheetId) {
  for (const [key, placement] of state.level.placements) {
    if (placement.sheetId === sheetId) state.level.placements.delete(key);
  }
}

function removeActiveSheet() {
  const sheet = activeSheet();
  if (!sheet || !window.confirm(`Remove “${sheet.name}” and its temporary grid placements?`)) return;

  const index = state.sheets.findIndex((item) => item.id === sheet.id);
  URL.revokeObjectURL(sheet.source);
  state.sheets.splice(index, 1);
  removePlacementsForSheet(sheet.id);
  if (state.brush?.sheetId === sheet.id) state.brush = null;
  state.activeId = state.sheets[Math.min(index, state.sheets.length - 1)]?.id || null;
  render();
  drawEditor();
}

function exportTags() {
  const sheet = activeSheet();
  if (!sheet) return;

  const payload = {
    format: "tiletag-tileset",
    version: 2,
    exportedAt: new Date().toISOString(),
    coordinateSystem: {
      origin: "top-left",
      units: "tiles",
      zeroBased: true,
    },
    tileset: {
      name: sheet.name,
      fileName: sheet.fileName,
      image: { width: sheet.width, height: sheet.height },
      tile: { width: sheet.tileSize, height: sheet.tileSize },
      grid: { columns: sheet.columns, rows: sheet.rows },
      tiles: sheet.tiles
        .filter((tile) => tile.tags.length)
        .map((tile) => ({
          index: tile.index,
          x: tile.column,
          y: tile.row,
          tags: tile.tags,
        })),
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${sheet.fileName.replace(/\.[^/.]+$/, "") || "tileset"}-tags.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Tags for the active tileset exported. The test grid was not included.");
}

function normalizeMetadata(payload) {
  if (payload?.format === "tiletag-tileset" && payload.tileset) return [payload.tileset];
  if (payload?.format === "tiletag-project" && Array.isArray(payload.tilesets)) return payload.tilesets;
  if (Array.isArray(payload?.tilesets)) return payload.tilesets;
  throw new Error("This is not a Tiletag tag export.");
}

function applyMetadataToSheet(sheet, metadata) {
  const tileSize = Math.min(metadataTileSize(metadata), sheet.width, sheet.height);
  Object.assign(sheet, {
    name: metadata.name || sheet.name,
    tileSize,
    ...createTiles(sheet.width, sheet.height, tileSize, metadata.tiles || []),
  });
  removePlacementsForSheet(sheet.id);
  if (state.brush?.sheetId === sheet.id) state.brush = null;
}

async function importTags(file) {
  try {
    const payload = JSON.parse(await file.text());
    const metadata = normalizeMetadata(payload);
    state.pendingMetadata = metadata;

    let restored = 0;
    state.sheets.forEach((sheet) => {
      const match = metadata.find((item) =>
        item.fileName === sheet.fileName ||
        (
          item.name === sheet.name &&
          item.image?.width === sheet.width &&
          item.image?.height === sheet.height
        )
      );
      if (!match) return;
      applyMetadataToSheet(sheet, match);
      restored += 1;
    });

    render();
    drawEditor();
    showToast(
      restored
        ? `Tags restored for ${restored} tileset${restored === 1 ? "" : "s"}.`
        : "Tags loaded. Import the matching source image next.",
    );
  } catch (error) {
    showToast(error.message || "Could not import this tag file.");
  } finally {
    elements.tagFileInput.value = "";
  }
}

function renderEditorState() {
  const selection = selectedTile();
  elements.paintToolButton.classList.toggle("is-active", state.tool === "paint");
  elements.eraseToolButton.classList.toggle("is-active", state.tool === "erase");
  elements.brushStatus.textContent = selection
    ? `${selection.sheet.name} · (${selection.tile.column},${selection.tile.row})`
    : state.tool === "erase"
      ? "Tap a cell to erase"
      : "Select a tile to paint";
  elements.editorZoom.textContent = `${Math.round(state.view.zoom * 100)}%`;
  elements.canvasHelp.hidden = Boolean(selection) || state.tool === "erase";
}

function setTool(tool) {
  state.tool = tool;
  renderEditorState();
  drawEditor();
}

function canvasSize() {
  return {
    width: elements.mapCanvas.clientWidth,
    height: elements.mapCanvas.clientHeight,
  };
}

function resizeEditorCanvas() {
  const rect = elements.canvasViewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const changed =
    elements.mapCanvas.width !== Math.round(width * ratio) ||
    elements.mapCanvas.height !== Math.round(height * ratio);

  if (changed) {
    elements.mapCanvas.width = Math.round(width * ratio);
    elements.mapCanvas.height = Math.round(height * ratio);
    elements.mapCanvas.style.width = `${width}px`;
    elements.mapCanvas.style.height = `${height}px`;
  }

  if (!state.view.initialized) fitGrid();
  else drawEditor();
}

function fitGrid() {
  const { width, height } = canvasSize();
  if (!width || !height) return;
  const padding = 30;
  state.view.zoom = clamp(
    Math.min(
      (width - padding * 2) / (state.level.columns * BASE_CELL_SIZE),
      (height - padding * 2) / (state.level.rows * BASE_CELL_SIZE),
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );
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
  context.fillStyle = "#232a26";
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.rect(state.view.x, state.view.y, gridWidth, gridHeight);
  context.clip();
  context.fillStyle = "#323b35";
  context.fillRect(state.view.x, state.view.y, gridWidth, gridHeight);

  const bounds = visibleCellBounds(width, height, cellSize);
  if (cellSize >= 16) {
    context.fillStyle = "rgba(255,255,255,0.018)";
    for (let row = bounds.startRow; row < bounds.endRow; row += 1) {
      for (let column = bounds.startColumn; column < bounds.endColumn; column += 1) {
        if ((row + column) % 2 === 0) {
          context.fillRect(
            state.view.x + column * cellSize,
            state.view.y + row * cellSize,
            cellSize,
            cellSize,
          );
        }
      }
    }
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  state.level.placements.forEach((placement, key) => {
    const [column, row] = key.split(",").map(Number);
    if (
      column < bounds.startColumn ||
      column >= bounds.endColumn ||
      row < bounds.startRow ||
      row >= bounds.endRow
    ) return;
    const sheet = sheetById(placement.sheetId);
    const tile = sheet?.tiles[placement.tileIndex];
    if (!sheet || !tile) return;
    context.drawImage(
      sheet.image,
      tile.x,
      tile.y,
      sheet.tileSize,
      sheet.tileSize,
      state.view.x + column * cellSize,
      state.view.y + row * cellSize,
      cellSize,
      cellSize,
    );
  });

  if (cellSize >= 5) {
    context.beginPath();
    for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
      const x = Math.round(state.view.x + column * cellSize) + 0.5;
      context.moveTo(x, state.view.y + bounds.startRow * cellSize);
      context.lineTo(x, state.view.y + bounds.endRow * cellSize);
    }
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      const y = Math.round(state.view.y + row * cellSize) + 0.5;
      context.moveTo(state.view.x + bounds.startColumn * cellSize, y);
      context.lineTo(state.view.x + bounds.endColumn * cellSize, y);
    }
    context.strokeStyle = "rgba(255,255,255,0.13)";
    context.lineWidth = 1;
    context.stroke();
  }

  if (state.hoverCell) {
    const { column, row } = state.hoverCell;
    context.fillStyle = state.tool === "erase"
      ? "rgba(255, 92, 84, 0.25)"
      : "rgba(217, 244, 95, 0.22)";
    context.fillRect(
      state.view.x + column * cellSize,
      state.view.y + row * cellSize,
      cellSize,
      cellSize,
    );
    context.strokeStyle = state.tool === "erase" ? "#ff746d" : "#d9f45f";
    context.lineWidth = 2;
    context.strokeRect(
      state.view.x + column * cellSize + 1,
      state.view.y + row * cellSize + 1,
      Math.max(0, cellSize - 2),
      Math.max(0, cellSize - 2),
    );
  }
  context.restore();

  context.strokeStyle = "rgba(255,255,255,0.42)";
  context.lineWidth = 1;
  context.strokeRect(
    Math.round(state.view.x) + 0.5,
    Math.round(state.view.y) + 0.5,
    Math.round(gridWidth),
    Math.round(gridHeight),
  );
}

function screenToCell(x, y) {
  const cellSize = BASE_CELL_SIZE * state.view.zoom;
  const column = Math.floor((x - state.view.x) / cellSize);
  const row = Math.floor((y - state.view.y) / cellSize);
  if (
    column < 0 ||
    row < 0 ||
    column >= state.level.columns ||
    row >= state.level.rows
  ) return null;
  return { column, row };
}

function placementKey(column, row) {
  return `${column},${row}`;
}

function interactWithCell(x, y, forceErase = false) {
  const cell = screenToCell(x, y);
  if (!cell) return;
  const key = placementKey(cell.column, cell.row);

  if (forceErase || state.tool === "erase") {
    state.level.placements.delete(key);
    drawEditor();
    return;
  }

  const selection = selectedTile();
  if (!selection) {
    showToast("Select a tile from the library first.");
    return;
  }

  state.level.placements.set(key, {
    sheetId: selection.sheet.id,
    tileIndex: selection.tile.index,
  });
  drawEditor();
}

function applyGridSize() {
  const columns = clampGridSize(elements.gridColumns.value, state.level.columns);
  const rows = clampGridSize(elements.gridRows.value, state.level.rows);
  const removed = [...state.level.placements.keys()].filter((key) => {
    const [column, row] = key.split(",").map(Number);
    return column >= columns || row >= rows;
  });

  if (removed.length && !window.confirm(`Resizing removes ${removed.length} tile placement${removed.length === 1 ? "" : "s"} outside the new grid. Continue?`)) {
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
  if (!window.confirm("Clear every tile from the temporary test grid?")) return;
  state.level.placements.clear();
  drawEditor();
}

const pointers = new Map();
const gesture = {
  primaryId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  moved: false,
  wasPinch: false,
  pinch: null,
};

function localPoint(event) {
  const rect = elements.canvasViewport.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginPinch() {
  const points = [...pointers.values()].slice(0, 2);
  if (points.length < 2) return;
  const middleX = (points[0].x + points[1].x) / 2;
  const middleY = (points[0].y + points[1].y) / 2;
  const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  gesture.pinch = {
    distance: Math.max(distance, 1),
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
  const zoom = clamp(
    gesture.pinch.zoom * (distance / gesture.pinch.distance),
    MIN_ZOOM,
    MAX_ZOOM,
  );
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
    gesture.primaryId = event.pointerId;
    gesture.startX = point.x;
    gesture.startY = point.y;
    gesture.lastX = point.x;
    gesture.lastY = point.y;
    gesture.moved = false;
    gesture.wasPinch = false;
    gesture.pinch = null;
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
  const distance = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
  if (distance > 6) gesture.moved = true;

  if (gesture.moved) {
    state.view.x += point.x - gesture.lastX;
    state.view.y += point.y - gesture.lastY;
    elements.canvasViewport.classList.add("map-panning");
    drawEditor();
  }

  gesture.lastX = point.x;
  gesture.lastY = point.y;
}

function finishPointer(event, cancelled = false) {
  const point = localPoint(event);
  const wasOnlyPointer = pointers.size === 1;
  const shouldPlace =
    !cancelled &&
    wasOnlyPointer &&
    event.pointerId === gesture.primaryId &&
    !gesture.moved &&
    !gesture.wasPinch;

  pointers.delete(event.pointerId);
  if (elements.canvasViewport.hasPointerCapture(event.pointerId)) {
    elements.canvasViewport.releasePointerCapture(event.pointerId);
  }

  if (shouldPlace) interactWithCell(point.x, point.y);

  if (pointers.size === 1) {
    const [id, remaining] = pointers.entries().next().value;
    gesture.primaryId = id;
    gesture.startX = remaining.x;
    gesture.startY = remaining.y;
    gesture.lastX = remaining.x;
    gesture.lastY = remaining.y;
    gesture.moved = true;
    gesture.wasPinch = true;
    gesture.pinch = null;
  } else if (!pointers.size) {
    gesture.primaryId = null;
    gesture.pinch = null;
    elements.canvasViewport.classList.remove("map-panning");
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

elements.addTilesetsButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.importTagsButton.addEventListener("click", () => elements.tagFileInput.click());
elements.tagFileInput.addEventListener("change", (event) => {
  if (event.target.files[0]) importTags(event.target.files[0]);
});
elements.exportTagsButton.addEventListener("click", exportTags);

["dragenter", "dragover"].forEach((type) => {
  elements.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((type) => {
  elements.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragging");
  });
});
elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

elements.sheetList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-sheet-id]");
  if (card) setActiveSheet(card.dataset.sheetId);
});
elements.tilePalette.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-tile-index]");
  if (tile) selectTile(Number(tile.dataset.tileIndex));
});
elements.paletteZoom.addEventListener("input", (event) => {
  state.paletteSize = Number(event.target.value);
  renderPalette();
  requestAnimationFrame(drawLibraryCanvases);
});
elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderPalette();
  requestAnimationFrame(drawLibraryCanvases);
});
elements.sheetNameInput.addEventListener("change", (event) => {
  const sheet = activeSheet();
  if (!sheet) return;
  sheet.name = event.target.value.trim() || sheet.name;
  event.target.value = sheet.name;
  renderSheetList();
  renderTagEditor();
  renderEditorState();
  requestAnimationFrame(drawLibraryCanvases);
});
elements.applyTileSizeButton.addEventListener("click", applyTileSize);
elements.activeTileSize.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyTileSize();
});
elements.removeSheetButton.addEventListener("click", removeActiveSheet);

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

elements.paintToolButton.addEventListener("click", () => setTool("paint"));
elements.eraseToolButton.addEventListener("click", () => setTool("erase"));
elements.applyGridSizeButton.addEventListener("click", applyGridSize);
[elements.gridColumns, elements.gridRows].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyGridSize();
  });
});
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
  setZoom(state.view.zoom * Math.exp(-event.deltaY * 0.0015), point.x, point.y);
}, { passive: false });
elements.canvasViewport.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const point = localPoint(event);
  interactWithCell(point.x, point.y, true);
});

if ("ResizeObserver" in globalThis) {
  new ResizeObserver(resizeEditorCanvas).observe(elements.canvasViewport);
} else {
  globalThis.addEventListener("resize", resizeEditorCanvas);
}

render();
requestAnimationFrame(resizeEditorCanvas);
