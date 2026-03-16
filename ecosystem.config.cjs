/**
 * PM2 ecosystem file for Cloudana MVP
 *
 * Before first run: npm run build  (serves the built app from dist/)
 * Start:  pm2 start ecosystem.config.cjs
 * Stop:   pm2 stop cloudana-mvp
 * Logs:   pm2 logs cloudana-mvp
 */
module.exports = {
  apps: [
    {
      name: 'cloudana-frontend',
      cwd: __dirname,
      script: 'npx',
      args: ['vite', 'preview', '--port', '7003'],
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      merge_logs: true,
      time: true,
    },
  ],
};
