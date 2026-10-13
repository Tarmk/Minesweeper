// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "file://" + require("node:path").resolve(__dirname, "..") + "/" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
