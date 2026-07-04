# Twisted Minesweeper — "Don't Step On It"

A browser game made for [Hack Club Twist](https://twist.hackclub.com/).

## The Twist

It starts as a completely normal 12x12 Minesweeper board. Click tiles, read
numbers, flag mines — classic.

But after you reveal 5 safe tiles, the game **glitches**. The screen shakes,
colors flicker, and the board transforms into a top-down escape maze. You are
now *inside* the Minesweeper board as a tiny character.

- Move with **WASD** or **arrow keys**.
- Press **SPACE**, then a direction, to **jump** two tiles — flying right over
  the tile in between, mine or not. But you land blind, so jumps are a gamble.
- Hidden tiles are dark. Mines stay invisible until you step on one.
- The numbers you revealed are your only clues — each one still counts the
  mines around it, just like real Minesweeper.
- Every tile you step on reveals its number, giving you new information.
- The exit door is **corrupted and locked**. First collect three repair parts:
  the key, fuse, and memory chip. They are spread far apart around the blob.
- Then reach the exit door to escape. Step on a mine and it's over.
- The door is always placed far across the map from where you're standing.
- During the glitch the map **outgrows its square**: with every flash, new
  tiles burst into existence around the edges, until the board is a big
  blob-shaped maze — with fresh mines hiding in the new territory.
- And it never stops: every few seconds the map **keeps growing**, new
  glowing tiles bubbling up at the edges with new mines inside. The numbers
  recompute live, so your clues stay honest as the world expands.
- If the growth swallows the exit door or any repair part, **it moves** back
  out to the edge of the blob, so you're always chasing the frontier.

The exit is always placed on the reachable safe tile farthest from you, so
every run is winnable (if you read the numbers carefully).

## Controls

| Phase | Input | Action |
|---|---|---|
| Minesweeper | Left click | Reveal tile |
| Minesweeper | Right click | Flag / unflag |
| Escape | WASD / Arrows | Move one tile |
| Escape | Space, then a direction | Jump over a tile (Space again cancels) |
| Escape | Right click | Flag / unflag a suspected mine |
| Any | Restart button | New game |

Flags placed in escape mode also **block your own steps** — they're guard
rails against a fatal mis-press. Unflag a tile (or jump over it) to pass.

## Running It

No build step, no backend — just open `index.html` in a browser, or serve the
repo with GitHub Pages.

Made with plain HTML, CSS, and JavaScript. No external assets or libraries.
