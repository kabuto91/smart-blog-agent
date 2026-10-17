import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // monorepo：把文件追踪根指向仓库根，保证 @smart-blog/core 等 workspace 依赖
  // 被正确打包进 Vercel 的函数产物
  outputFileTracingRoot: path.join(process.cwd(), "..", ".."),
};

export default nextConfig;
