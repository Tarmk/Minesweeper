"use strict";

const BOARD = 12;
const PAD = 6;
const GRID = BOARD + PAD * 2;
const MINES = 22;
const CLICKS_TO_GLITCH = 5;
const GLITCH_TILES = 85;
const GLITCH_STEPS = 11;
const GLITCH_MS = 350;
const GROW_MS = 3500;
const GROW_TILES = 4;
const NEW_MINE_CHANCE = 0.16;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ITEMS = [
  { id: "key", name: "KEY", icon: "\u{1F511}" },
  { id: "fuse", name: "FUSE", icon: "\u26A1" },
  { id: "chip", name: "CHIP", icon: "\u{1F4BE}" },
];

let board = [];
let phase = "sweeper";
let minesPlaced = false;
let mineCount = MINES;
let clicks = 0;
let flags = 0;
let steps = 0;
let player = null;
let exitPos = null;
let itemSpots = [];
let gotItems = new Set();
let jumpReady = false;
let justJumped = false;
let glitchTimer = null;
let growTimer = null;

const boardEl = document.getElementById("board");
const wrapEl = document.getElementById("wrap");
const titleEl = document.getElementById("title");
const hintEl = document.getElementById("objective");
const mineEl = document.getElementById("mine-counter");
const statEl = document.getElementById("status-counter");
const overlayEl = document.getElementById("overlay");
const overlayTextEl = document.getElementById("overlay-text");
const overlayRestartEl = document.getElementById("overlay-restart");

document.getElementById("restart-btn").addEventListener("click", init);
overlayRestartEl.addEventListener("click", init);
document.addEventListener("keydown", onKey);

function inBounds(r, c) {
  return r >= 0 && r < GRID && c >= 0 && c < GRID;
}

function eachCell(fn) {
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) fn(board[r][c], r, c);
  }
}

function stopTimers() {
  clearInterval(glitchTimer);
  clearInterval(growTimer);
  glitchTimer = null;
  growTimer = null;
}

function init() {
  phase = "sweeper";
  minesPlaced = false;
  mineCount = MINES;
  clicks = 0;
  flags = 0;
  steps = 0;
  player = null;
  exitPos = null;
  itemSpots = [];
  gotItems = new Set();
  jumpReady = false;
  justJumped = false;
  stopTimers();

  document.body.classList.remove("escape", "flicker");
  wrapEl.classList.remove("shake");
  overlayEl.classList.add("hidden");
  overlayRestartEl.classList.add("hidden");
  titleEl.textContent = "MINESWEEPER";
  hintEl.textContent = "Left click to reveal. Right click to flag.";

  makeBoard();
  draw();
}

function makeBoard() {
  board = [];
  for (let r = 0; r < GRID; r++) {
    const row = [];
    for (let c = 0; c < GRID; c++) {
      row.push({
        exists: r >= PAD && r < PAD + BOARD && c >= PAD && c < PAD + BOARD,
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
  makeTiles(BOARD, PAD);
}

function makeTiles(size, offset) {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${size}, var(--tile))`;
  boardEl.style.gridTemplateRows = `repeat(${size}, var(--tile))`;
  for (let r = offset; r < offset + size; r++) {
    for (let c = offset; c < offset + size; c++) {
      const el = document.createElement("div");
      el.className = "tile";
      if (!board[r][c].exists) el.classList.add("void");
      el.addEventListener("click", () => onClick(r, c));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        onFlag(r, c);
      });
      boardEl.appendChild(el);
      board[r][c].el = el;
    }
  }
}

function layMines(safeR, safeC) {
  let n = 0;
  while (n < MINES) {
    const r = PAD + Math.floor(Math.random() * BOARD);
    const c = PAD + Math.floor(Math.random() * BOARD);
    if (board[r][c].mine || (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1)) continue;
    board[r][c].mine = true;
    n++;
  }
  countAdjacency();
  minesPlaced = true;
}

function neighbors(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc].exists) out.push(board[nr][nc]);
    }
  }
  return out;
}

function countAdjacency() {
  eachCell((cell, r, c) => {
    if (cell.exists) cell.adjacent = neighbors(r, c).filter((n) => n.mine).length;
  });
}

// growth can leave 0-tiles next to hidden cells — fix that
function fixZeros() {
  let again = true;
  while (again) {
    again = false;
    eachCell((cell, r, c) => {
      if (!cell.exists || !cell.revealed || cell.mine || cell.adjacent !== 0) return;
      for (const n of neighbors(r, c)) {
        if (!n.revealed && !n.flagged && !n.exit && !n.item) {
          n.revealed = true;
          again = true;
        }
      }
    });
  }
}

function onClick(r, c) {
  if (phase !== "sweeper") return;
  const cell = board[r][c];
  if (!cell.exists || cell.revealed || cell.flagged) return;

  if (!minesPlaced) layMines(r, c);

  if (cell.mine) {
    cell.revealed = true;
    cell.el.classList.add("mine-hit");
    gameOver("You hit a mine.");
    return;
  }

  flood(r, c);
  clicks++;
  draw();

  if (clicks >= CLICKS_TO_GLITCH) startGlitch(r, c);
}

function onFlag(r, c) {
  if (phase !== "sweeper" && phase !== "escape") return;
  const cell = board[r][c];
  if (!cell.exists || cell.revealed) return;
  cell.flagged = !cell.flagged;
  flags += cell.flagged ? 1 : -1;
  draw();
}

function flood(r, c) {
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

function startGlitch(spawnR, spawnC) {
  phase = "glitching";
  hintEl.textContent = "...";

  wrapEl.classList.add("shake");
  document.body.classList.add("flicker");
  overlayTextEl.textContent = "SOMETHING IS WRONG";
  overlayTextEl.dataset.text = "SOMETHING IS WRONG";
  overlayEl.classList.remove("hidden");

  makeTiles(GRID, 0);
  draw();

  const chunk = Math.ceil(GLITCH_TILES / GLITCH_STEPS);
  let left = GLITCH_STEPS;
  glitchTimer = setInterval(() => {
    grow(chunk);
    draw();
    if (--left <= 0) {
      clearInterval(glitchTimer);
      glitchTimer = null;
      afterGrow({ moveStuff: false });
      setTimeout(() => enterEscape(spawnR, spawnC), 500);
    }
  }, GLITCH_MS);
}

function grow(count) {
  let added = 0;
  for (let i = 0; i < count; i++) {
    const picks = [];
    eachCell((cell, r, c) => {
      if (cell.exists || !touchesBlob(r, c)) return;
      const n = neighbors(r, c).length;
      picks.push({ r, c, w: n * n });
    });
    if (!picks.length) break;

    let total = 0;
    for (const p of picks) total += p.w;
    let roll = Math.random() * total;
    let pick = picks[0];
    for (const p of picks) {
      roll -= p.w;
      if (roll <= 0) {
        pick = p;
        break;
      }
    }

    const cell = board[pick.r][pick.c];
    cell.exists = true;
    cell.mine = Math.random() < NEW_MINE_CHANCE;
    if (cell.mine) mineCount++;
    cell.el.classList.remove("void");
    cell.el.classList.add("spawn", "fresh");
    setTimeout(() => cell.el.classList.remove("spawn", "fresh"), 700);
    added++;
  }
  return added;
}

function touchesBlob(r, c) {
  return DIRS.some(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    return inBounds(nr, nc) && board[nr][nc].exists;
  });
}

function afterGrow({ moveStuff = true, bumpMines = false } = {}) {
  countAdjacency();
  fixZeros();
  if (moveStuff) {
    moveExitIfNeeded();
    moveItemsIfNeeded();
  }
  if (bumpMines) {
    mineEl.classList.remove("bump");
    void mineEl.offsetWidth;
    mineEl.classList.add("bump");
  }
  draw();
}

function enterEscape(spawnR, spawnC) {
  wrapEl.classList.remove("shake");
  document.body.classList.remove("flicker");
  overlayEl.classList.add("hidden");

  document.body.classList.add("escape");
  phase = "escape";
  player = { r: spawnR, c: spawnC };
  spawnExit();
  spawnItems();

  titleEl.textContent = "GET OUT";
  updateHint();
  growTimer = setInterval(() => {
    if (grow(GROW_TILES) === 0) {
      clearInterval(growTimer);
      growTimer = null;
      return;
    }
    afterGrow({ bumpMines: true });
  }, GROW_MS);
  draw();
}

function updateHint() {
  if (jumpReady) {
    hintEl.textContent = "Jump armed — pick a direction (space to cancel).";
    return;
  }
  if (haveAllItems()) {
    hintEl.textContent = "Door's unlocked. Get to the exit. WASD to move, space+direction to jump.";
    return;
  }
  hintEl.textContent = `Grab ${itemLine()}. WASD to move, space+direction to jump, right-click to flag.`;
}

function haveAllItems() {
  return gotItems.size === ITEMS.length;
}

function itemLine() {
  return ITEMS.map((it) => (gotItems.has(it.id) ? it.icon : it.name)).join(", ");
}

function itemMeta(id) {
  return ITEMS.find((it) => it.id === id);
}

function walkDist() {
  const dist = Array.from({ length: GRID }, () => Array(GRID).fill(-1));
  const q = [[player.r, player.c]];
  dist[player.r][player.c] = 0;
  while (q.length) {
    const [r, c] = q.shift();
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      if (!board[nr][nc].exists || board[nr][nc].mine || dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      q.push([nr, nc]);
    }
  }
  return dist;
}

function bestTile(score, opts = {}) {
  const { hidden = false, edge = false, notNearOpen = false } = opts;
  const dist = walkDist();
  let best = null, bestScore = -1;
  eachCell((cell, r, c) => {
    if (!cell.exists || cell.mine || cell.exit || cell.item) return;
    if (r === player.r && c === player.c) return;
    if (hidden && cell.revealed) return;
    if (edge && !onEdge(r, c)) return;
    if (notNearOpen && neighbors(r, c).some((n) => n.revealed)) return;
    const s = (dist[r][c] !== -1 ? dist[r][c] : 0) + score(r, c);
    if (s > bestScore) {
      bestScore = s;
      best = { r, c };
    }
  });
  return best;
}

function spawnExit() {
  const score = (r, c) => Math.hypot(r - player.r, c - player.c) * 2;
  const spot =
    bestTile(score, { hidden: true, edge: true, notNearOpen: true }) ||
    bestTile(score, { hidden: true, edge: true }) ||
    bestTile(score);
  exitPos = spot;
  board[spot.r][spot.c].exit = true;
}

function spawnItems() {
  itemSpots = [];
  for (const item of ITEMS) {
    const score = (r, c) => {
      let s = Math.hypot(r - player.r, c - player.c) * 1.2;
      s += Math.hypot(r - exitPos.r, c - exitPos.c) * 1.2;
      for (const p of itemSpots) s += Math.hypot(r - p.r, c - p.c) * 1.8;
      return s;
    };
    const spot =
      bestTile(score, { hidden: true, edge: true, notNearOpen: true }) ||
      bestTile(score, { hidden: true, edge: true }) ||
      bestTile(score);
    board[spot.r][spot.c].item = item.id;
    itemSpots.push({ id: item.id, r: spot.r, c: spot.c });
  }
}

function onEdge(r, c) {
  return DIRS.some(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    return !inBounds(nr, nc) || !board[nr][nc].exists;
  });
}

function nearestEdge(pos, opts = {}) {
  const { hidden = false, notNearOpen = false } = opts;
  let best = null, bestD = Infinity, bestPlayer = -1;
  eachCell((cell, r, c) => {
    if (!cell.exists || cell.mine || cell.exit || cell.item || cell.flagged) return;
    if (!onEdge(r, c) || (r === player.r && c === player.c)) return;
    if (hidden && cell.revealed) return;
    if (notNearOpen && neighbors(r, c).some((n) => n.revealed)) return;
    const d = Math.hypot(r - pos.r, c - pos.c);
    const pd = Math.hypot(r - player.r, c - player.c);
    if (d < bestD || (d === bestD && pd > bestPlayer)) {
      bestD = d;
      bestPlayer = pd;
      best = { r, c };
    }
  });
  return best;
}

function shoveExit() {
  if (!exitPos || onEdge(exitPos.r, exitPos.c)) return;
  const spot =
    nearestEdge(exitPos, { hidden: true, notNearOpen: true }) ||
    nearestEdge(exitPos, { hidden: true }) ||
    nearestEdge(exitPos);
  if (!spot) return;

  board[exitPos.r][exitPos.c].exit = false;
  board[spot.r][spot.c].exit = true;
  ping(board[spot.r][spot.c]);
  exitPos = spot;
}

function shoveItems() {
  itemSpots = itemSpots.map((spot) => {
    if (gotItems.has(spot.id) || onEdge(spot.r, spot.c)) return spot;
    const edge =
      nearestEdge(spot, { hidden: true, notNearOpen: true }) ||
      nearestEdge(spot, { hidden: true }) ||
      nearestEdge(spot);
    if (!edge) return spot;

    board[spot.r][spot.c].item = null;
    board[edge.r][edge.c].item = spot.id;
    ping(board[edge.r][edge.c]);
    return { id: spot.id, r: edge.r, c: edge.c };
  });
}

function moveExitIfNeeded() {
  shoveExit();
}

function moveItemsIfNeeded() {
  shoveItems();
}

function ping(cell) {
  cell.el.classList.add("fresh");
  setTimeout(() => cell.el.classList.remove("fresh"), 900);
}

const KEYS = {
  arrowup: [-1, 0], w: [-1, 0],
  arrowdown: [1, 0], s: [1, 0],
  arrowleft: [0, -1], a: [0, -1],
  arrowright: [0, 1], d: [0, 1],
};

function onKey(e) {
  if (phase !== "escape") return;

  if (e.key === " ") {
    e.preventDefault();
    jumpReady = !jumpReady;
    updateHint();
    draw();
    return;
  }

  const dir = KEYS[e.key.toLowerCase()];
  if (!dir) return;
  e.preventDefault();
  move(dir[0], dir[1], jumpReady);
}

function move(dr, dc, jumping) {
  const step = jumping ? 2 : 1;
  const nr = player.r + dr * step;
  const nc = player.c + dc * step;
  if (!inBounds(nr, nc) || !board[nr][nc].exists) return;

  if (board[nr][nc].flagged) {
    hintEl.textContent = "That tile is flagged. Right-click to unflag, or jump over it.";
    return;
  }

  player = { r: nr, c: nc };
  steps++;
  justJumped = jumping;
  jumpReady = false;
  updateHint();

  const cell = board[nr][nc];
  if (cell.mine) {
    cell.revealed = true;
    cell.el.classList.add("mine-hit");
    gameOver(jumping ? "Landed on a mine." : "Stepped on a mine.");
    return;
  }

  cell.revealed = true;
  fixZeros();

  if (cell.item) {
    const meta = itemMeta(cell.item);
    gotItems.add(cell.item);
    itemSpots = itemSpots.filter((s) => s.id !== cell.item);
    cell.item = null;
    hintEl.textContent = `Got ${meta.name}. Still need: ${itemLine()}`;
  }

  if (cell.exit) {
    if (haveAllItems()) {
      youWin();
      return;
    }
    hintEl.textContent = `Door's locked. Need ${itemLine()}.`;
  }
  draw();
}

function youWin() {
  phase = "over";
  stopTimers();
  draw();
  showEnd("YOU ESCAPED", `Out in ${steps} steps.`);
}

function gameOver(msg) {
  phase = "over";
  stopTimers();
  showMines();
  draw();
  showEnd("GAME OVER", msg);
}

function showEnd(title, msg) {
  overlayTextEl.textContent = title;
  overlayTextEl.dataset.text = title;
  hintEl.textContent = msg + " Hit restart to go again.";
  overlayRestartEl.classList.remove("hidden");
  overlayEl.classList.remove("hidden");
}

function showMines() {
  eachCell((cell) => {
    if (cell.exists && cell.mine) cell.revealed = true;
  });
}

function draw() {
  mineEl.textContent = `MINES: ${String(mineCount - flags).padStart(2, "0")}`;
  statEl.textContent = player ? `STEPS: ${steps}` : `SAFE: ${clicks}`;

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const cell = board[r][c];
      const el = cell.el;
      if (!el) continue;

      el.classList.toggle("void", !cell.exists);
      el.classList.toggle("revealed", cell.revealed);
      el.classList.toggle("exit", cell.exit);
      el.classList.toggle("locked", cell.exit && !haveAllItems());
      el.classList.toggle("item", Boolean(cell.item));
      delete el.dataset.item;
      if (cell.item) el.dataset.item = cell.item;
      delete el.dataset.n;
      el.textContent = label(cell);
      if (cell.revealed && !cell.mine && !cell.exit && !cell.item && cell.adjacent > 0) {
        el.dataset.n = cell.adjacent;
      }

      if (player && player.r === r && player.c === c) {
        const guy = document.createElement("div");
        guy.className = "player";
        if (jumpReady) guy.classList.add("armed");
        if (justJumped) guy.classList.add("jumping");
        guy.innerHTML = '<div class="body"></div>';
        el.appendChild(guy);
      }
    }
  }
  justJumped = false;
}

function label(cell) {
  if (cell.exit) return haveAllItems() ? "\u{1F6AA}" : "\u{1F512}";
  if (cell.item) return itemMeta(cell.item).icon;
  if (!cell.revealed) return cell.flagged ? "\u{1F6A9}" : "";
  if (cell.mine) return "\u{1F4A3}";
  return cell.adjacent > 0 ? String(cell.adjacent) : "";
}

init();
