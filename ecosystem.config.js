// Pinned to Node 24 explicitly. The pm2 daemon itself still runs on the system
// Node 18, so this app's runtime is independent of every other app on the box.
// Rollback is one line: point NODE at /usr/bin/node and restart.
const NODE = '/root/.nvm/versions/node/v24.21.0/bin/node';

module.exports = {
  apps: [
    {
      name: 'ladder',
      cwd: '/var/www/coreoslab/projects/project21 - Legacy Ladder',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3021 -H 127.0.0.1',
      interpreter: NODE,
      env: { NODE_ENV: 'production' },
      max_restarts: 10,
    },
  ],
};
