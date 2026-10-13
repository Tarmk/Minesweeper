// @ts-check
const { test, expect } = require("@playwright/test");

/** Reveal safe cells through the game's own functions until the glitch starts. */
async function playFiveSafeClicks(page) {
  await page.evaluate(() => {
    onClick(PAD + 5, PAD + 5);
    while (phase === "sweeper") {
      let clicked = false;
      for (let r = PAD; r < PAD + BOARD && !clicked; r++) {
        for (let c = PAD; c < PAD + BOARD && !clicked; c++) {
          const cell = board[r][c];
          if (!cell.revealed && !cell.mine && !cell.flagged) {
            onClick(r, c);
            clicked = true;
          }
        }
      }
      if (!clicked) break;
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("index.html");
});

test("starts as an ordinary 12x12 minesweeper", async ({ page }) => {
  await expect(page).toHaveTitle("Don't Step On It");
  await expect(page.locator("#board .tile")).toHaveCount(144);
  await expect(page.locator("#mine-counter")).toHaveText("MINES: 22");
  await expect(page.locator("#title")).toHaveText("MINESWEEPER");
});

test("the first click is always safe and opens an area", async ({ page }) => {
  await page.locator("#board .tile").nth(6 * 12 + 6).click();
  await expect(page.locator("#overlay")).toHaveClass(/hidden/);
  expect(await page.locator("#board .tile.revealed").count()).toBeGreaterThanOrEqual(9);
  await expect(page.locator("#status-counter")).toHaveText("SAFE: 1");
});

test("the board fits the screen without sideways scrolling", async ({ page }) => {
  await page.locator("#board .tile").nth(5 * 12 + 5).click();
  await playFiveSafeClicks(page);
  await expect(page.locator("body")).toHaveClass(/escape/, { timeout: 10_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("after five safe clicks it turns into the escape maze", async ({ page }) => {
  await playFiveSafeClicks(page);
  await expect(page.locator("body")).toHaveClass(/escape/, { timeout: 10_000 });
  await expect(page.locator("#title")).toHaveText("GET OUT");
  await expect(page.locator(".player")).toHaveCount(1);
  await expect(page.locator(".tile.exit")).toHaveCount(1);
  await expect(page.locator(".tile.item")).toHaveCount(3);
});

test("restart goes back to the start", async ({ page }) => {
  await playFiveSafeClicks(page);
  await expect(page.locator("body")).toHaveClass(/escape/, { timeout: 10_000 });
  await page.locator("#restart-btn").click();
  await expect(page.locator("body")).not.toHaveClass(/escape/);
  await expect(page.locator("#board .tile")).toHaveCount(144);
});

test.describe("desktop controls", () => {
  test.skip(({ isMobile }) => isMobile, "mouse and keyboard only");

  test("right click flags and unflags", async ({ page }) => {
    const tile = page.locator("#board .tile").first();
    await tile.click({ button: "right" });
    await expect(tile).toHaveText("🚩");
    await expect(page.locator("#mine-counter")).toHaveText("MINES: 21");
    await tile.click({ button: "right" });
    await expect(tile).toHaveText("");
  });

  test("the player moves with the keyboard", async ({ page }) => {
    await playFiveSafeClicks(page);
    await expect(page.locator("body")).toHaveClass(/escape/, { timeout: 10_000 });
    await expect(page.locator(".touch")).toBeHidden();
    const key = await page.evaluate(() => {
      const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      for (const [name, [dr, dc]] of Object.entries(dirs)) {
        const r = player.r + dr;
        const c = player.c + dc;
        if (inBounds(r, c) && board[r][c].exists && !board[r][c].mine && !board[r][c].flagged) return name;
      }
      return null;
    });
    test.skip(key === null, "boxed in by mines on this seed");
    await page.keyboard.press(/** @type {string} */ (key));
    await expect(page.locator("#status-counter")).toHaveText("STEPS: 1");
  });
});

test.describe("touch controls", () => {
  test.skip(({ isMobile }) => !isMobile, "phones and tablets only");

  test("flag mode lets a tap place a flag", async ({ page }) => {
    await page.locator("#flag-mode").tap();
    await expect(page.locator("#flag-mode")).toHaveText("FLAG MODE: ON");
    const tile = page.locator("#board .tile").first();
    await tile.tap();
    await expect(tile).toHaveText("🚩");
  });

  test("the d-pad appears in the maze and moves the player", async ({ page }) => {
    await expect(page.locator(".dpad")).toBeHidden();
    await playFiveSafeClicks(page);
    await expect(page.locator("body")).toHaveClass(/escape/, { timeout: 10_000 });
    await expect(page.locator(".dpad")).toBeVisible();
    const dir = await page.evaluate(() => {
      const dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
      for (const [name, [dr, dc]] of Object.entries(dirs)) {
        const r = player.r + dr;
        const c = player.c + dc;
        if (inBounds(r, c) && board[r][c].exists && !board[r][c].mine && !board[r][c].flagged) return name;
      }
      return null;
    });
    test.skip(dir === null, "boxed in by mines on this seed");
    await page.locator(`.dpad [data-dir="${dir}"]`).tap();
    await expect(page.locator("#status-counter")).toHaveText("STEPS: 1");
  });
});
