const QUICK_TAGS = ["terrain", "water", "grass", "stone", "wall", "floor", "decoration", "object", "animated", "collision"];

const state = {
  sheets: [],
  activeId: null,
  selected: new Set(),
  search: "",
  tagFilter: null,
  previewSize: 72,
  pendingProject: null,
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  projectInput: document.querySelector("#projectInput"),
  dropzone: document.querySelector("#dropzone"),
  defaultTileSize: document.querySelector("#defaultTileSize"),
  sheetList: document.querySelector("#sheetList"),
  sheetCount: document.querySelector("#sheetCount"),
  demoButton: document.querySelector("#demoButton"),
  emptyDemoButton: document.querySelector("#emptyDemoButton"),
  emptyImportButton: document.querySelector("#emptyImportButton"),
  emptyState: document.querySelector("#emptyState"),
  tilesView: document.querySelector("#tilesView"),
  sheetNameInput: document.querySelector("#sheetNameInput"),
  sheetMeta: document.querySelector("#sheetMeta"),
  searchInput: document.querySelector("#searchInput"),
  zoomInput: document.querySelector("#zoomInput"),
  tileGrid: document.querySelector("#tileGrid"),
  noResults: document.querySelector("#noResults"),
  selectionBar: document.querySelector("#selectionBar"),
  selectionCount: document.querySelector("#selectionCount"),
  selectVisibleButton: document.querySelector("#selectVisibleButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  filterRow: document.querySelector("#filterRow"),
  exportButton: document.querySelector("#exportButton"),
  importProjectButton: document.querySelector("#importProjectButton"),
  removeSheetButton: document.querySelector("#removeSheetButton"),
  inspectorContent: document.querySelector("#inspectorContent"),
  inspectorEditor: document.querySelector("#inspectorEditor"),
  selectionStack: document.querySelector("#selectionStack"),
  inspectorSelectionCount: document.querySelector("#inspectorSelectionCount"),
  tagInput: document.querySelector("#tagInput"),
  addTagButton: document.querySelector("#addTagButton"),
  appliedTags: document.querySelector("#appliedTags"),
  appliedTagCount: document.querySelector("#appliedTagCount"),
  quickTags: document.querySelector("#quickTags"),
  clearTagsButton: document.querySelector("#clearTagsButton"),
  sheetSettings: document.querySelector("#sheetSettings"),
  activeTileSize: document.querySelector("#activeTileSize"),
  applyTileSizeButton: document.querySelector("#applyTileSizeButton"),
  toastRegion: document.querySelector("#toastRegion"),
};

function uid() {
  return globalThis.crypto?.randomUUID?.() || `sheet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeSheet() {
  return state.sheets.find((sheet) => sheet.id === state.activeId) || null;
}

function clampTileSize(value) {
  return Math.max(1, Math.min(1024, Number.parseInt(value, 10) || 32));
}

function cleanName(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function createTiles(width, height, tileSize, annotations = []) {
  const columns = Math.floor(width / tileSize);
  const rows = Math.floor(height / tileSize);
  const tagMap = new Map(annotations.map((tile) => [`${tile.x},${tile.y}`, Array.isArray(tile.tags) ? tile.tags : []]));
  const tiles = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileSize;
      const y = row * tileSize;
      tiles.push({
        index: tiles.length,
        column,
        row,
        x,
        y,
        tags: [...new Set(tagMap.get(`${x},${y}`) || [])],
      });
    }
  }

  return { columns, rows, tiles };
}

async function imageDimensions(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("This image could not be decoded."));
    image.src = source;
  });
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    elements.fileInput.value = "";
    showToast("Choose one or more image files.");
    return;
  }

  let imported = 0;
  for (const file of files) {
    const source = URL.createObjectURL(file);
    try {
      const { width, height } = await imageDimensions(source);
      const projectMatch = findProjectMatch(file.name, width, height);
      const tileSize = clampTileSize(projectMatch?.tileSize || elements.defaultTileSize.value);
      const grid = createTiles(width, height, tileSize, projectMatch?.tiles);

      state.sheets.push({
        id: uid(),
        name: projectMatch?.name || cleanName(file.name),
        fileName: file.name,
        source,
        width,
        height,
        tileSize,
        ...grid,
      });
      imported += 1;
    } catch (error) {
      URL.revokeObjectURL(source);
      showToast(`${file.name}: ${error.message}`);
    }
  }

  if (imported) {
    state.activeId = state.sheets.at(-imported).id;
    state.selected.clear();
    state.tagFilter = null;
    state.search = "";
    elements.searchInput.value = "";
    render();
    showToast(`${imported} tileset${imported === 1 ? "" : "s"} imported.`);
  }
  elements.fileInput.value = "";
}

function findProjectMatch(fileName, width, height) {
  if (!state.pendingProject?.tilesets) return null;
  return state.pendingProject.tilesets.find((sheet) =>
    sheet.fileName === fileName ||
    (sheet.image?.width === width && sheet.image?.height === height && sheet.name === cleanName(fileName))
  );
}

function setActiveSheet(id) {
  if (state.activeId === id) return;
  state.activeId = id;
  state.selected.clear();
  state.search = "";
  state.tagFilter = null;
  elements.searchInput.value = "";
  render();
}

function visibleTiles() {
  const sheet = activeSheet();
  if (!sheet) return [];
  const query = state.search.trim().toLocaleLowerCase();

  return sheet.tiles.filter((tile) => {
    const matchesFilter = !state.tagFilter || tile.tags.includes(state.tagFilter);
    const matchesQuery = !query ||
      String(tile.index).includes(query.replace(/^#/, "")) ||
      tile.tags.some((tag) => tag.toLocaleLowerCase().includes(query));
    return matchesFilter && matchesQuery;
  });
}

function spriteStyle(sheet, tile, previewSize) {
  const scale = previewSize / sheet.tileSize;
  return [
    `background-image:url("${sheet.source}")`,
    `background-size:${sheet.width * scale}px ${sheet.height * scale}px`,
    `background-position:${-tile.x * scale}px ${-tile.y * scale}px`,
  ].join(";");
}

function render() {
  const sheet = activeSheet();
  const hasSheets = state.sheets.length > 0;
  elements.sheetCount.textContent = state.sheets.length;
  elements.exportButton.disabled = !hasSheets;
  elements.removeSheetButton.disabled = !sheet;
  elements.emptyState.hidden = hasSheets;
  elements.tilesView.hidden = !hasSheets;
  elements.sheetSettings.hidden = !sheet;

  renderSheetList();
  if (sheet) {
    elements.sheetNameInput.value = sheet.name;
    elements.activeTileSize.value = sheet.tileSize;
    elements.sheetMeta.innerHTML = `
      <span>${sheet.width} × ${sheet.height}px</span>
      <span>${sheet.columns} × ${sheet.rows} grid</span>
      <span>${sheet.tiles.length} tiles</span>
    `;
    renderFilters();
    renderGrid();
  }
  renderSelection();
}

function renderSheetList() {
  elements.sheetList.innerHTML = state.sheets.map((sheet) => {
    const annotated = sheet.tiles.filter((tile) => tile.tags.length).length;
    const firstTile = sheet.tiles[0] || { x: 0, y: 0 };
    return `
      <button class="sheet-card ${sheet.id === state.activeId ? "is-active" : ""}" type="button" data-sheet-id="${sheet.id}">
        <span class="sheet-thumb" style="${spriteStyle(sheet, firstTile, 44)}"></span>
        <span class="sheet-info">
          <strong>${escapeHtml(sheet.name)}</strong>
          <span>${sheet.tileSize}px · ${annotated} tagged</span>
        </span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
    `;
  }).join("");
}

function renderFilters() {
  const sheet = activeSheet();
  const counts = new Map();
  sheet.tiles.forEach((tile) => tile.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  elements.filterRow.innerHTML = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => `<button class="filter-chip ${state.tagFilter === tag ? "is-active" : ""}" type="button" data-filter-tag="${escapeAttribute(tag)}">${escapeHtml(tag)} · ${count}</button>`)
    .join("");
}

function renderGrid() {
  const sheet = activeSheet();
  const tiles = visibleTiles();
  elements.tileGrid.style.setProperty("--tile-preview", `${state.previewSize}px`);
  elements.tileGrid.innerHTML = tiles.map((tile) => `
    <button
      class="tile-card ${state.selected.has(tile.index) ? "is-selected" : ""}"
      type="button"
      data-tile-index="${tile.index}"
      aria-pressed="${state.selected.has(tile.index)}"
      aria-label="Tile ${tile.index}, row ${tile.row + 1}, column ${tile.column + 1}${tile.tags.length ? `, tags: ${escapeAttribute(tile.tags.join(", "))}` : ""}"
    >
      <span class="tile-art" style="${spriteStyle(sheet, tile, state.previewSize)}"></span>
      <span class="tile-foot">
        <span class="tile-number">#${String(tile.index).padStart(3, "0")}</span>
        ${tile.tags.length ? `<span class="tile-tag-count" title="${tile.tags.length} tags">${tile.tags.length}</span>` : ""}
      </span>
    </button>
  `).join("");
  elements.noResults.hidden = tiles.length > 0;
}

function renderSelection() {
  const sheet = activeSheet();
  const count = state.selected.size;
  const hasSelection = Boolean(sheet && count);
  elements.selectionBar.hidden = !hasSelection;
  elements.inspectorContent.hidden = hasSelection;
  elements.inspectorEditor.hidden = !hasSelection;

  if (!hasSelection) return;

  const label = `${count} tile${count === 1 ? "" : "s"} selected`;
  elements.selectionCount.textContent = label;
  elements.inspectorSelectionCount.textContent = label;

  const selectedTiles = [...state.selected].slice(0, 3).map((index) => sheet.tiles[index]);
  elements.selectionStack.innerHTML = selectedTiles.map((tile) =>
    `<span class="stack-tile" style="${spriteStyle(sheet, tile, 42)}"></span>`
  ).join("");

  const counts = new Map();
  [...state.selected].forEach((index) => {
    sheet.tiles[index]?.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  const tags = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  elements.appliedTagCount.textContent = tags.length;
  elements.appliedTags.innerHTML = tags.length
    ? tags.map(([tag, tagCount]) => `
        <button class="tag-chip ${tagCount < count ? "is-partial" : ""}" type="button" data-remove-tag="${escapeAttribute(tag)}" title="Remove from selected tiles">
          ${escapeHtml(tag)}${tagCount < count ? ` (${tagCount}/${count})` : ""}<span class="tag-remove" aria-hidden="true">×</span>
        </button>
      `).join("")
    : `<span class="empty-tags">No tags yet.</span>`;

  const usedTags = new Set(tags.map(([tag]) => tag));
  elements.quickTags.innerHTML = QUICK_TAGS
    .filter((tag) => !usedTags.has(tag))
    .map((tag) => `<button class="tag-chip" type="button" data-quick-tag="${tag}">+ ${tag}</button>`)
    .join("");
}

function toggleTile(index) {
  if (state.selected.has(index)) state.selected.delete(index);
  else state.selected.add(index);
  renderGrid();
  renderSelection();
}

function addTags(rawValue) {
  const sheet = activeSheet();
  const tags = [...new Set(rawValue.split(",").map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))];
  if (!sheet || !state.selected.size || !tags.length) return;

  state.selected.forEach((index) => {
    const tile = sheet.tiles[index];
    if (tile) tile.tags = [...new Set([...tile.tags, ...tags])].sort();
  });
  elements.tagInput.value = "";
  renderSheetList();
  renderFilters();
  renderGrid();
  renderSelection();
  showToast(`${tags.length} tag${tags.length === 1 ? "" : "s"} applied.`);
}

function removeTag(tag) {
  const sheet = activeSheet();
  state.selected.forEach((index) => {
    const tile = sheet.tiles[index];
    if (tile) tile.tags = tile.tags.filter((item) => item !== tag);
  });
  renderSheetList();
  renderFilters();
  renderGrid();
  renderSelection();
}

function clearSelectedTags() {
  const sheet = activeSheet();
  state.selected.forEach((index) => {
    if (sheet.tiles[index]) sheet.tiles[index].tags = [];
  });
  renderSheetList();
  renderFilters();
  renderGrid();
  renderSelection();
  showToast("Tags cleared from the selection.");
}

function applyTileSize() {
  const sheet = activeSheet();
  if (!sheet) return;
  const tileSize = clampTileSize(elements.activeTileSize.value);
  if (tileSize === sheet.tileSize) return;

  const hasTags = sheet.tiles.some((tile) => tile.tags.length);
  if (hasTags && !window.confirm("Changing the grid can move tile boundaries. Tags will be preserved only where tile coordinates still match. Continue?")) {
    elements.activeTileSize.value = sheet.tileSize;
    return;
  }

  const annotations = sheet.tiles.filter((tile) => tile.tags.length);
  Object.assign(sheet, { tileSize, ...createTiles(sheet.width, sheet.height, tileSize, annotations) });
  state.selected.clear();
  state.tagFilter = null;
  render();
  showToast(`Grid updated to ${tileSize}px tiles.`);
}

function removeActiveSheet() {
  const sheet = activeSheet();
  if (!sheet || !window.confirm(`Remove “${sheet.name}” from this workspace?`)) return;
  if (sheet.source.startsWith("blob:")) URL.revokeObjectURL(sheet.source);
  const index = state.sheets.findIndex((item) => item.id === sheet.id);
  state.sheets.splice(index, 1);
  state.activeId = state.sheets[Math.min(index, state.sheets.length - 1)]?.id || null;
  state.selected.clear();
  state.tagFilter = null;
  render();
  showToast("Tileset removed.");
}

function exportProject() {
  if (!state.sheets.length) return;
  const payload = {
    format: "tiletag-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    defaultTileSize: clampTileSize(elements.defaultTileSize.value),
    note: "Images are not embedded. Re-import the named source images after loading this JSON to restore annotations.",
    tilesets: state.sheets.map((sheet) => ({
      name: sheet.name,
      fileName: sheet.fileName,
      image: { width: sheet.width, height: sheet.height },
      tileSize: sheet.tileSize,
      columns: sheet.columns,
      rows: sheet.rows,
      tileCount: sheet.tiles.length,
      tiles: sheet.tiles
        .filter((tile) => tile.tags.length)
        .map(({ index, column, row, x, y, tags }) => ({ index, column, row, x, y, tags })),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tiletag-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("Project JSON exported.");
}

async function importProject(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "tiletag-project" || !Array.isArray(payload.tilesets)) throw new Error("Not a Tiletag project file.");
    state.pendingProject = payload;
    elements.defaultTileSize.value = clampTileSize(payload.defaultTileSize);

    let restored = 0;
    state.sheets.forEach((sheet) => {
      const match = payload.tilesets.find((item) => item.fileName === sheet.fileName || item.name === sheet.name);
      if (!match) return;
      const grid = createTiles(sheet.width, sheet.height, clampTileSize(match.tileSize), match.tiles);
      Object.assign(sheet, { name: match.name || sheet.name, tileSize: clampTileSize(match.tileSize), ...grid });
      restored += 1;
    });

    state.selected.clear();
    render();
    if (restored) showToast(`Annotations restored for ${restored} imported tileset${restored === 1 ? "" : "s"}.`);
    else showToast("Project loaded. Now import its source images to restore the tilesets.");
  } catch (error) {
    showToast(error.message || "Could not import this project.");
  } finally {
    elements.projectInput.value = "";
  }
}

function addDemoSheet() {
  const canvas = document.createElement("canvas");
  const size = 32;
  canvas.width = 256;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;

  const colors = ["#79b86b", "#58a0ca", "#a77b57", "#88908b", "#d6bd74", "#4e7b58"];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = column * size;
      const y = row * size;
      const base = colors[(row + Math.floor(column / 2)) % colors.length];
      context.fillStyle = base;
      context.fillRect(x, y, size, size);
      context.fillStyle = "rgba(255,255,255,.16)";
      context.fillRect(x, y, size, 5);
      context.fillStyle = "rgba(10,25,18,.17)";
      for (let pixel = 0; pixel < 7; pixel += 1) {
        const px = x + ((column * 11 + pixel * 7 + row * 3) % 28);
        const py = y + ((row * 13 + pixel * 9 + column) % 28);
        context.fillRect(px, py, 4, 4);
      }
      if ((row + column) % 5 === 0) {
        context.fillStyle = "#e7efba";
        context.fillRect(x + 13, y + 9, 6, 14);
        context.fillRect(x + 9, y + 13, 14, 6);
      }
    }
  }

  const annotations = [
    { x: 0, y: 0, tags: ["grass", "terrain"] },
    { x: 32, y: 0, tags: ["grass", "terrain"] },
    { x: 64, y: 0, tags: ["water", "animated"] },
    { x: 96, y: 32, tags: ["stone", "terrain"] },
    { x: 160, y: 64, tags: ["decoration"] },
  ];
  const grid = createTiles(canvas.width, canvas.height, size, annotations);
  const sheet = {
    id: uid(),
    name: "Forest Starter",
    fileName: "forest-starter-demo.png",
    source: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    tileSize: size,
    ...grid,
  };
  state.sheets.push(sheet);
  state.activeId = sheet.id;
  state.selected.clear();
  state.search = "";
  state.tagFilter = null;
  render();
  showToast("Demo tileset added.");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.emptyImportButton.addEventListener("click", () => elements.fileInput.click());
elements.importProjectButton.addEventListener("click", () => elements.projectInput.click());
elements.projectInput.addEventListener("change", (event) => event.target.files[0] && importProject(event.target.files[0]));
elements.exportButton.addEventListener("click", exportProject);
elements.demoButton.addEventListener("click", addDemoSheet);
elements.emptyDemoButton.addEventListener("click", addDemoSheet);

["dragenter", "dragover"].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
}));
elements.dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

elements.sheetList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-sheet-id]");
  if (card) setActiveSheet(card.dataset.sheetId);
});
elements.tileGrid.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-tile-index]");
  if (tile) toggleTile(Number(tile.dataset.tileIndex));
});
elements.filterRow.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-filter-tag]");
  if (!chip) return;
  state.tagFilter = state.tagFilter === chip.dataset.filterTag ? null : chip.dataset.filterTag;
  renderFilters();
  renderGrid();
});

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderGrid();
});
elements.zoomInput.addEventListener("input", (event) => {
  state.previewSize = Number(event.target.value);
  renderGrid();
});
elements.sheetNameInput.addEventListener("change", (event) => {
  const sheet = activeSheet();
  if (!sheet) return;
  sheet.name = event.target.value.trim() || sheet.name;
  event.target.value = sheet.name;
  renderSheetList();
});
elements.selectVisibleButton.addEventListener("click", () => {
  visibleTiles().forEach((tile) => state.selected.add(tile.index));
  renderGrid();
  renderSelection();
});
elements.clearSelectionButton.addEventListener("click", () => {
  state.selected.clear();
  renderGrid();
  renderSelection();
});

elements.addTagButton.addEventListener("click", () => addTags(elements.tagInput.value));
elements.tagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTags(event.currentTarget.value);
  }
});
elements.appliedTags.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-remove-tag]");
  if (chip) removeTag(chip.dataset.removeTag);
});
elements.quickTags.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-quick-tag]");
  if (chip) addTags(chip.dataset.quickTag);
});
elements.clearTagsButton.addEventListener("click", clearSelectedTags);
elements.applyTileSizeButton.addEventListener("click", applyTileSize);
elements.activeTileSize.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyTileSize();
});
elements.removeSheetButton.addEventListener("click", removeActiveSheet);

render();
