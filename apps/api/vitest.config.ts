import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    pool: "forks",
    // Runs once per test file, before the file is imported. Contains the
    // cross-worker isolation the suite needs to be reproducible in parallel:
    // loopback-only ephemeral servers and a private uploads directory. See the
    // file for why each one exists — none of them may be dropped without the
    // suite going flaky again. File parallelism stays ON deliberately: turning
    // it off only hid these races and roughly tripled the wall clock.
    setupFiles: ["./tests/helpers/setup.ts"],
  },
});
