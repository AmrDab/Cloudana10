import { fileURLToPath } from "node:url";

// Client-side unit tests only (the API has its own config in client/api). Run from the repo root:
//   npm run test:client
export default {
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
};
