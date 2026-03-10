/**
 * PM2 ecosystem config for Cloudana Provider Node.
 * First run: pm2 start ecosystem.config.cjs
 * Logs: pm2 logs cloudana-provider-node
 * Stop: pm2 stop cloudana-provider-node
 * Start again after stop: pm2 restart cloudana-provider-node
 */
module.exports = {
  apps: [
    {
      name: "cloudana-provider-node",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        PROVIDER_NODE_PORT: process.env.PROVIDER_NODE_PORT || "4040",
      },
      error_file: "~/.pm2/logs/cloudana-provider-node-error.log",
      out_file: "~/.pm2/logs/cloudana-provider-node-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
