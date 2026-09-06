module.exports = {
  apps: [
    {
      name: 'seekon-backend',
      script: 'src/server.js',
      node_args: '--expose-gc',
      cron_restart: '0 0 * * 0', // Restart every Sunday at 12:00 AM
      max_memory_restart: '500M', // Safe auto-restart threshold (raised to 500MB for background remover headroom)
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'seekon-worker',
      script: 'src/workers/imageWorker.js',
      node_args: '--expose-gc',
      cron_restart: '0 0 * * 0', // Restart every Sunday at 12:00 AM
      max_memory_restart: '250M',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
