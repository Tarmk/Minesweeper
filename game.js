/* ============================================================
   TWISTED MINESWEEPER — "Don't step on it"
   Phase 1: classic Minesweeper (click to reveal, right-click flag).
   Phase 2: after 5 safe reveals the board glitches — with every
            flash the map GROWS past its square edges, becoming a
            blob-shaped maze you must physically walk out of.
            And it keeps growing while you run.
   ============================================================ */

"use strict";

// ---------- Config ----------
const START_SIZE = 12;                // the classic square board
const MARGIN = 6;                     // how far the blob can grow past it
const GRID = START_SIZE + MARGIN * 2; // full grid the blob lives in (24)
const START_MINES = 22;
const SAFE_REVEALS_TO_GLITCH = 5;
const GLITCH_GROW_CELLS = 85;         // tiles added during the glitch
const GLITCH_BURSTS = 11;             // flashes it takes to add them
const GLITCH_TICK_MS = 350;           // quick growth bursts without harsh flashing
const ESCAPE_GROW_MS = 3500;          // the map keeps growing while you escape...
const ESCAPE_GROW_BURST = 4;          // ...this many tiles at a time
const NEW_MINE_RATE = 0.16;           // mine chance on each grown tile
const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const REQUIRED_ITEMS = [
  { id: "key", name: "KEY", icon: "\u{1F511}" },
  { id: "fuse", name: "FUSE", icon: "\u26A1" },
  { id: "chip", name: "CHIP", icon: "\u{1F4BE}" },
];

// ---------- State ----------
let board = [];                // GRID x GRID array of cell objects
let gameState = "sweeper";     // sweeper | glitching | escape | over
let minesPlaced = false;
let totalMines = START_MINES;
let safeClicks = 0;            // successful reveal clicks in phase 1
let flagsUsed = 0;
let steps = 0;                 // moves made in escape mode
let player = null;             // {r, c}
let exitPos = null;            // {r, c} — the door drifts as the map grows
let itemPositions = [];        // [{id, r, c}] — items drift until picked up
let collectedItems = new Set();
let jumpArmed = false;         // Space pressed, waiting for a direction
let justJumped = false;        // plays the hop animation on next render
let glitchTimer = null;        // growth bursts during the glitch
let escapeGrowthTimer = null;  // slow growth during escape mode

// ---------- DOM ----------
const boardEl = document.getElementById("board");
const wrapEl = document.getElementById("wrap");
const titleEl = document.getElementById("title");
const objectiveEl = document.getElementById("objective");
const mineCounterEl = document.getElementById("mine-counter");
const statusCounterEl = document.getElementById("status-counter");
const overlayEl = document.getElementById("overlay");
const overlayTextEl = document.getElementById("overlay-text");
const overlayRestartEl = document.getElementById("overlay-restart");

document.getElementById("restart-btn").addEventListener("click", init);
overlayRestartEl.addEventListener("click", init);
document.addEventListener("keydown", onKeyDown);

// ---------- Small helpers ----------

function inBounds(r, c) {
  return r >= 0 && r < GRID && c >= 0 && c < GRID;
}

function forEachCell(fn) {
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      fn(board[r][c], r, c);
    }
  }
}

function stopTimers() {
  clearInterval(glitchTimer);
  clearInterval(escapeGrowthTimer);
  glitchTimer = null;
  escapeGrowthTimer = null;
}

// ============================================================
// Setup
// ============================================================

function init() {
  gameState = "sweeper";
  minesPlaced = false;
  totalMines = START_MINES;
  safeClicks = 0;
  flagsUsed = 0;
  steps = 0;
  player = null;
  exitPos = null;
  itemPositions = [];
  collectedItems = new Set();
  jumpArmed = false;
  justJumped = false;
  stopTimers();

  document.body.classList.remove("escape", "flicker");
  wrapEl.classList.remove("shake");
  overlayEl.classList.add("hidden");
  overlayRestartEl.classList.add("hidden");
  titleEl.textContent = "MINESWEEPER";
  objectiveEl.textContent = "Left click to reveal a tile. Right click to flag a mine.";

  buildBoard();
  render();
}

// The data grid is always GRID x GRID, but only the central
// START_SIZE square "exists" at first — the rest is empty space
// the blob will grow into during the glitch.
function buildBoard() {
  board = [];
  for (let r = 0; r < GRID; r++) {
    const row = [];
    for (let c = 0; c < GRID; c++) {
      row.push({
        exists: r >= MARGIN && r < MARGIN + START_SIZE &&
                c >= MARGIN && c < MARGIN + START_SIZE,
        mine: false,
        adjacent: 0,
        revealed: false,
        flagged: false,
        exit: false,
        item: null,
        el: null,
      });
    }
    board.push(row);
  }
  buildDom(START_SIZE, MARGIN);
}

// Builds the board DOM. Phase 1 shows only the central square;
// when the glitch starts, the full grid is built (voids invisible).
function buildDom(size, offset) {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${size}, var(--tile))`;
  boardEl.style.gridTemplateRows = `repeat(${size}, var(--tile))`;
  for (let r = offset; r < offset + size; r++) {
    for (let c = offset; c < offset + size; c++) {
      const el = document.createElement("div");
      el.className = "tile";
      if (!board[r][c].exists) el.classList.add("void");
      el.addEventListener("click", () => onTileClick(r, c));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        onTileFlag(r, c);
      });
      boardEl.appendChild(el);
      board[r][c].el = el;
    }
  }
}

// Mines are placed on the first click, like modern Minesweeper. The clicked
// tile and its 8 neighbors are kept mine-free so the opening move creates a
// useful starting cluster instead of forcing the player to hunt for one.
function placeMines(safeR, safeC) {
  let placed = 0;
  while (placed < START_MINES) {
    const r = MARGIN + Math.floor(Math.random() * START_SIZE);
    const c = MARGIN + Math.floor(Math.random() * START_SIZE);
    if (board[r][c].mine || Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
    board[r][c].mine = true;
    placed++;
  }
  computeAdjacency();
  minesPlaced = true;
}

function neighborsOf(r, c) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc].exists) result.push(board[nr][nc]);
    }
  }
  return result;
}

function computeAdjacency() {
  forEachCell((cell, r, c) => {
    if (cell.exists) cell.adjacent = neighborsOf(r, c).filter((n) => n.mine).length;
  });
}

// Classic Minesweeper invariant: a revealed empty (0) tile never borders
// a hidden tile — the flood always opens its neighbors. Map growth can
// break that (new hidden tiles appear next to old empty ones), so this
// re-opens neighbors until the board looks right again.
function enforceZeroFlood() {
  let changed = true;
  while (changed) {
    changed = false;
    forEachCell((cell, r, c) => {
      if (!cell.exists || !cell.revealed || cell.mine || cell.adjacent !== 0) return;
      for (const n of neighborsOf(r, c)) {
        if (!n.revealed && !n.flagged && !n.exit && !n.item) {
          n.revealed = true;
          changed = true;
        }
      }
    });
  }
}

// ============================================================
// Phase 1 — classic Minesweeper
// ============================================================

function onTileClick(r, c) {
  if (gameState !== "sweeper") return;
  const cell = board[r][c];
  if (!cell.exists || cell.revealed || cell.flagged) return;

  if (!minesPlaced) placeMines(r, c);

  if (cell.mine) {
    cell.revealed = true;
    cell.el.classList.add("mine-hit");
    lose("You clicked a mine the old-fashioned way.");
    return;
  }

  floodReveal(r, c);
  safeClicks++;
  render();

  if (safeClicks >= SAFE_REVEALS_TO_GLITCH) triggerGlitch(r, c);
}

// Flagging works in both phases: on the classic board and while walking
// around inside it. In escape mode a flagged tile also blocks your own
// steps, so flags double as guard rails.
function onTileFlag(r, c) {
  if (gameState !== "sweeper" && gameState !== "escape") return;
  const cell = board[r][c];
  if (!cell.exists || cell.revealed) return;
  cell.flagged = !cell.flagged;
  flagsUsed += cell.flagged ? 1 : -1;
  render();
}

// Classic flood fill: revealing a 0 opens all its neighbors.
function floodReveal(r, c) {
  const stack = [[r, c]];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    const cell = board[cr][cc];
    if (!cell.exists || cell.revealed || cell.flagged || cell.mine) continue;
    cell.revealed = true;
    if (cell.adjacent === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (inBounds(cr + dr, cc + dc)) stack.push([cr + dr, cc + dc]);
        }
      }
    }
  }
}

// ============================================================
// The transformation — the map outgrows its square, flash by flash
// ============================================================

function triggerGlitch(spawnR, spawnC) {
  gameState = "glitching";
  objectiveEl.textContent = "...";

  wrapEl.classList.add("shake");
  document.body.classList.add("flicker");
  overlayTextEl.textContent = "SOMETHING IS WRONG";
  overlayTextEl.dataset.text = "SOMETHING IS WRONG";
  overlayEl.classList.remove("hidden");

  // swap to the full grid (new space starts invisible), then grow into it
  buildDom(GRID, 0);
  render();

  const perBurst = Math.ceil(GLITCH_GROW_CELLS / GLITCH_BURSTS);
  let burstsLeft = GLITCH_BURSTS;
  glitchTimer = setInterval(() => {
    growCells(perBurst);
    render();
    if (--burstsLeft <= 0) {
      clearInterval(glitchTimer);
      glitchTimer = null;
      settleGrowth({ moveObjectives: false }); // objectives are placed after escape starts
      setTimeout(() => startEscape(spawnR, spawnC), 500);
    }
  }, GLITCH_TICK_MS);
}

// Grows the blob by up to `count` cells and returns how many were added.
// Each new cell must share an edge with the existing mass, and cells
// hugged by more neighbors are heavily preferred — that keeps the blob
// round-ish and organic instead of spiky. New cells roll for a mine and
// pop in with a glow.
function growCells(count) {
  let grown = 0;
  for (let n = 0; n < count; n++) {
    const candidates = [];
    forEachCell((cell, r, c) => {
      if (cell.exists || !hasExistingCardinalNeighbor(r, c)) return;
      const touching = neighborsOf(r, c).length;
      candidates.push({ r, c, w: touching * touching });
    });
    if (!candidates.length) break; // the world is full

    // weighted random pick
    const totalW = candidates.reduce((sum, k) => sum + k.w, 0);
    let roll = Math.random() * totalW;
    let chosen = candidates[0];
    for (const k of candidates) {
      roll -= k.w;
      if (roll <= 0) { chosen = k; break; }
    }

    const cell = board[chosen.r][chosen.c];
    cell.exists = true;
    cell.mine = Math.random() < NEW_MINE_RATE;
    if (cell.mine) totalMines++;
    cell.el.classList.remove("void");
    cell.el.classList.add("spawn", "fresh");
    setTimeout(() => cell.el.classList.remove("spawn", "fresh"), 700);
    grown++;
  }
  return grown;
}

function hasExistingCardinalNeighbor(r, c) {
  return ORTHOGONAL.some(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    return inBounds(nr, nc) && board[nr][nc].exists;
  });
}

function settleGrowth({ moveObjectives = true, bumpCounter = false } = {}) {
  computeAdjacency();
  enforceZeroFlood();
  if (moveObjectives) {
    maybeMoveExit();
    maybeMoveItems();
  }
  if (bumpCounter) bumpMineCounter();
  render();
}

function startEscape(spawnR, spawnC) {
  wrapEl.classList.remove("shake");
  document.body.classList.remove("flicker");
  overlayEl.classList.add("hidden");

  document.body.classList.add("escape");
  gameState = "escape";
  player = { r: spawnR, c: spawnC };
  placeExit();
  placeItems();

  titleEl.textContent = "GET OUT";
  setEscapeObjective();
  startEscapeGrowth();
  render();
}

// The map never stops. Every few seconds a few more tiles bubble up at
// the edges (bringing fresh mines with them), and the numbers recompute
// to stay honest about the new territory.
function startEscapeGrowth() {
  escapeGrowthTimer = setInterval(() => {
    if (growCells(ESCAPE_GROW_BURST) === 0) {
      clearInterval(escapeGrowthTimer);
      escapeGrowthTimer = null;
      return;
    }
    settleGrowth({ bumpCounter: true });
  }, ESCAPE_GROW_MS);
}

function bumpMineCounter() {
  mineCounterEl.classList.remove("bump");
  void mineCounterEl.offsetWidth; // restart the animation
  mineCounterEl.classList.add("bump");
}

function setEscapeObjective() {
  if (jumpArmed) {
    objectiveEl.textContent =
      "JUMP ARMED — pick a direction to leap 2 tiles (SPACE to cancel). " +
      "You clear the tile you fly over... but you land blind.";
    return;
  }
  objectiveEl.textContent = haveAllItems()
    ? "All repair parts collected! Reach the exit before the map swallows it. " +
      "WASD / arrows walk, SPACE + direction jumps, right click flags."
    : `Collect the repair parts (${itemProgress()}) to unlock the exit. ` +
      "WASD / arrows walk, SPACE + direction jumps, right click flags.";
}

function haveAllItems() {
  return collectedItems.size === REQUIRED_ITEMS.length;
}

function itemProgress() {
  return `${collectedItems.size}/${REQUIRED_ITEMS.length}: ` +
    REQUIRED_ITEMS
      .map((item) => collectedItems.has(item.id) ? item.icon : item.name)
      .join(" ");
}

function itemById(id) {
  return REQUIRED_ITEMS.find((item) => item.id === id);
}

// Walking distance from the player to every tile (BFS over mine-free
// existing tiles). -1 = not reachable on foot.
function walkDistances() {
  const dist = Array.from({ length: GRID }, () => Array(GRID).fill(-1));
  const queue = [[player.r, player.c]];
  dist[player.r][player.c] = 0;

  while (queue.length) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of ORTHOGONAL) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      if (!board[nr][nc].exists || board[nr][nc].mine || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      queue.push([nr, nc]);
    }
  }
  return dist;
}

// Finds the safe tile with the best score. Placement can ask for hidden
// frontier tiles so objectives do not spawn inside already-open rooms.
function bestSafeTile(scoreFn, options = {}) {
  const { requireHidden = false, requireFrontier = false, awayFromRevealed = false } = options;
  const walk = walkDistances();
  let best = null;
  let bestScore = -1;
  forEachCell((cell, r, c) => {
    if (!cell.exists || cell.mine || cell.exit || cell.item) return;
    if (r === player.r && c === player.c) return;
    if (requireHidden && cell.revealed) return;
    if (requireFrontier && !onFrontier(r, c)) return;
    if (awayFromRevealed && neighborsOf(r, c).some((n) => n.revealed)) return;
    const score = (walk[r][c] !== -1 ? walk[r][c] : 0) + scoreFn(r, c);
    if (score > bestScore) {
      bestScore = score;
      best = { r, c };
    }
  });
  return best;
}

// The exit door goes on a safe tile that is a long walk away AND far
// across the map from where the player is standing.
function placeExit() {
  const score = (r, c) => Math.hypot(r - player.r, c - player.c) * 2;
  const best =
    bestSafeTile(score, { requireHidden: true, requireFrontier: true, awayFromRevealed: true }) ||
    bestSafeTile(score, { requireHidden: true, requireFrontier: true }) ||
    bestSafeTile(score);
  exitPos = best;
  board[best.r][best.c].exit = true;
}

// Three repair parts are scattered far from the player, the door, and each
// other. The exit stays locked until all are collected.
function placeItems() {
  itemPositions = [];
  for (const item of REQUIRED_ITEMS) {
    const score = (r, c) => {
      const fromPlayer = Math.hypot(r - player.r, c - player.c);
      const fromExit = Math.hypot(r - exitPos.r, c - exitPos.c);
      const fromOtherItems = itemPositions.reduce(
        (sum, p) => sum + Math.hypot(r - p.r, c - p.c),
        0
      );
      return fromPlayer * 1.2 + fromExit * 1.2 + fromOtherItems * 1.8;
    };
    const best =
      bestSafeTile(score, { requireHidden: true, requireFrontier: true, awayFromRevealed: true }) ||
      bestSafeTile(score, { requireHidden: true, requireFrontier: true }) ||
      bestSafeTile(score);
    board[best.r][best.c].item = item.id;
    itemPositions.push({ id: item.id, r: best.r, c: best.c });
  }
}

// A tile is on the frontier if the void (or the world's border) touches it.
function onFrontier(r, c) {
  return ORTHOGONAL.some(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    return !inBounds(nr, nc) || !board[nr][nc].exists;
  });
}

// Finds the nearest frontier tile to `pos` that can hold the door or the
// key (favoring spots away from the player). Null if `pos` is fine.
function nearestFrontierTile(pos) {
  if (onFrontier(pos.r, pos.c)) return null;

  return nearestFrontierCandidate(pos, { requireHidden: true, awayFromRevealed: true }) ||
         nearestFrontierCandidate(pos, { requireHidden: true }) ||
         nearestFrontierCandidate(pos);
}

function nearestFrontierCandidate(pos, options = {}) {
  const { requireHidden = false, awayFromRevealed = false } = options;
  let best = null;
  let bestDist = Infinity;
  let bestPlayerDist = -1;
  forEachCell((cell, r, c) => {
    if (!cell.exists || cell.mine || cell.exit || cell.item || cell.flagged) return;
    if (!onFrontier(r, c) || (r === player.r && c === player.c)) return;
    if (requireHidden && cell.revealed) return;
    if (awayFromRevealed && neighborsOf(r, c).some((n) => n.revealed)) return;
    const dist = Math.hypot(r - pos.r, c - pos.c);
    const playerDist = Math.hypot(r - player.r, c - player.c);
    if (dist < bestDist || (dist === bestDist && playerDist > bestPlayerDist)) {
      bestDist = dist;
      bestPlayerDist = playerDist;
      best = { r, c };
    }
  });
  return best;
}

// When growth swallows the door or key, it slides to the nearest frontier
// tile, leaving an ordinary revealed tile behind.
function maybeMoveFeature(pos, flag) {
  if (!pos) return pos;
  const best = nearestFrontierTile(pos);
  if (!best) return;

  board[pos.r][pos.c][flag] = false;
  const cell = board[best.r][best.c];
  cell[flag] = true;
  flashTile(cell);
  return best;
}

function maybeMoveExit() {
  exitPos = maybeMoveFeature(exitPos, "exit") || exitPos;
}

function maybeMoveItems() {
  itemPositions = itemPositions.map((pos) => maybeMoveItem(pos) || pos);
}

function maybeMoveItem(pos) {
  if (collectedItems.has(pos.id)) return null;
  const best = nearestFrontierTile(pos);
  if (!best) return pos;

  board[pos.r][pos.c].item = null;
  const cell = board[best.r][best.c];
  cell.item = pos.id;
  flashTile(cell);
  return { id: pos.id, r: best.r, c: best.c };
}

function flashTile(cell) {
  cell.el.classList.add("fresh");
  setTimeout(() => cell.el.classList.remove("fresh"), 900);
}

// ============================================================
// Phase 2 — escape mode
// ============================================================

const MOVES = {
  arrowup: [-1, 0], w: [-1, 0],
  arrowdown: [1, 0], s: [1, 0],
  arrowleft: [0, -1], a: [0, -1],
  arrowright: [0, 1], d: [0, 1],
};

function onKeyDown(e) {
  if (gameState !== "escape") return;

  if (e.key === " ") {
    e.preventDefault();
    jumpArmed = !jumpArmed; // arm a jump, or cancel it
    setEscapeObjective();
    render();
    return;
  }

  const move = MOVES[e.key.toLowerCase()];
  if (!move) return;
  e.preventDefault();
  movePlayer(move[0], move[1], jumpArmed);
}

// A walk moves 1 tile. A jump moves 2, flying OVER the tile in between
// (mine, gap, whatever) — but the landing tile is still a gamble.
function movePlayer(dr, dc, isJump) {
  const stride = isJump ? 2 : 1;
  const nr = player.r + dr * stride;
  const nc = player.c + dc * stride;
  if (!inBounds(nr, nc)) return;
  if (!board[nr][nc].exists) return; // can't stand on the void outside the blob

  if (board[nr][nc].flagged) {
    // your own flag guards you — unflag it (right click) to go there
    objectiveEl.textContent =
      "That tile is FLAGGED as dangerous. Right click to unflag it, or jump over it.";
    return;
  }

  player = { r: nr, c: nc };
  steps++;
  justJumped = isJump;
  jumpArmed = false;
  setEscapeObjective();

  const cell = board[nr][nc];
  if (cell.mine) {
    cell.revealed = true;
    cell.el.classList.add("mine-hit");
    lose(isJump
      ? "You jumped straight onto a mine."
      : "You stepped on a mine. The numbers were trying to warn you.");
    return;
  }

  cell.revealed = true; // landing on a tile reveals its number clue
  enforceZeroFlood();   // landing on a 0 opens its neighborhood, like classic

  if (cell.item) {
    const collectedId = cell.item;
    const item = itemById(collectedId);
    collectedItems.add(collectedId);
    itemPositions = itemPositions.filter((pos) => pos.id !== collectedId);
    cell.item = null;
    setEscapeObjective();
    objectiveEl.textContent = `Collected ${item.name}! ${itemProgress()}`;
  }

  if (cell.exit) {
    if (haveAllItems()) {
      win();
      return;
    }
    objectiveEl.textContent = `The door is LOCKED. Collect all 3 repair parts first (${itemProgress()}).`;
  }
  render();
}

// ============================================================
// Endings
// ============================================================

function win() {
  gameState = "over";
  stopTimers();
  render();
  showOverlay("YOU ESCAPED", `You made it out in ${steps} steps.`);
}

function lose(message) {
  gameState = "over";
  stopTimers();
  revealAllMines();
  render();
  showOverlay("GAME OVER", message);
}

function showOverlay(bigText, subText) {
  overlayTextEl.textContent = bigText;
  overlayTextEl.dataset.text = bigText;
  objectiveEl.textContent = subText + " Press RESTART to play again.";
  overlayRestartEl.classList.remove("hidden");
  overlayEl.classList.remove("hidden");
}

function revealAllMines() {
  forEachCell((cell) => {
    if (cell.exists && cell.mine) cell.revealed = true;
  });
}

// ============================================================
// Rendering
// ============================================================

function render() {
  mineCounterEl.textContent = `MINES: ${String(totalMines - flagsUsed).padStart(2, "0")}`;
  statusCounterEl.textContent = player ? `STEPS: ${steps}` : `SAFE: ${safeClicks}`;

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const cell = board[r][c];
      const el = cell.el;
      if (!el) continue; // outside the DOM during phase 1

      el.classList.toggle("void", !cell.exists);
      el.classList.toggle("revealed", cell.revealed);
      el.classList.toggle("exit", cell.exit);
      el.classList.toggle("locked", cell.exit && !haveAllItems());
      el.classList.toggle("item", Boolean(cell.item));
      delete el.dataset.item;
      if (cell.item) el.dataset.item = cell.item;
      delete el.dataset.n;
      el.textContent = tileLabel(cell);
      if (cell.revealed && !cell.mine && !cell.exit && !cell.item && cell.adjacent > 0) {
        el.dataset.n = cell.adjacent;
      }

      // draw the player character on top of its tile
      if (player && player.r === r && player.c === c) {
        const p = document.createElement("div");
        p.className = "player";
        if (jumpArmed) p.classList.add("armed");
        if (justJumped) p.classList.add("jumping");
        p.innerHTML = '<div class="body"></div>';
        el.appendChild(p);
      }
    }
  }
  justJumped = false; // hop animation plays once per jump
}

function tileLabel(cell) {
  if (cell.exit) return haveAllItems() ? "\u{1F6AA}" : "\u{1F512}"; // door / padlock
  if (cell.item) return itemById(cell.item).icon;
  if (!cell.revealed) return cell.flagged ? "\u{1F6A9}" : ""; // flag
  if (cell.mine) return "\u{1F4A3}"; // bomb
  return cell.adjacent > 0 ? String(cell.adjacent) : "";
}

init();
