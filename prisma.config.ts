import { config } from "dotenv";
import { resolve } from "path";
import { defineConfig } from "prisma/config";

config({ path: resolve(__dirname, ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // CLI（migrate/db push/introspect）走 DIRECT_URL 会话模式端口，
    // 池化端口不支持迁移所需的会话级语句
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"]!,
  },
});
