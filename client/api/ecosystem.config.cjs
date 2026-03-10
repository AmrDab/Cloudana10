/**
 * PM2 ecosystem file for Cloudana MVP API (@cloudana/client-api)
 *
 * Start:  pm2 start ecosystem.config.cjs
 * Stop:   pm2 stop cloudana-mvp-api
 * Logs:   pm2 logs cloudana-mvp-api
 *
 * Set PORT and other env in .env or in the env block below.
 */
module.exports = {
  apps: [
    {
      name: 'cloudana-api',
      cwd: __dirname,
      script: 'npx',
      args: ['tsx', 'src/index.ts'],
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
