/**
 * PM2 进程守护配置 —— smart-blog-agent 前台 (apps/web)
 *
 * 用法（在仓库根目录执行）：
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save && pm2 startup
 *
 * 说明：
 * - 只托管前台 web；admin 后台按部署方案留在本地，不上服务器。
 * - Next.js 16: `next start` 支持 -p/-H，这里固定监听 127.0.0.1:3000，
 *   只对本机 Nginx 开放，不对公网直出。
 * - max_memory_restart 针对 2GB 内存机器设置，超过即自动重启回收。
 */
module.exports = {
  apps: [
    {
      name: "blog-web",
      cwd: "apps/web",
      // 直接调用 next start，避免多包一层 npm/pnpm
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3000",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      kill_timeout: 5000,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
  ],
};
