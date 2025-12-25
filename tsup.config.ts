import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/cckb": "src/bin/cckb.ts",
    "hooks/session-start": "src/hooks/session-start.ts",
    "hooks/user-prompt": "src/hooks/user-prompt.ts",
    "hooks/post-tool-use": "src/hooks/post-tool-use.ts",
    "hooks/stop": "src/hooks/stop.ts",
    "hooks/notification": "src/hooks/notification.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  shims: true,
});
