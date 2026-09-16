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
    {
      // Stakes the vault's idle BNB (scripts/keeper.mjs). Start only once its wallet holds gas money:
      //   pm2 start ecosystem.config.js --only ladder-keeper && pm2 save
      name: 'ladder-keeper',
      cwd: '/var/www/coreoslab/projects/project21 - Legacy Ladder',
      script: 'scripts/keeper.mjs',
      interpreter: NODE,
      env: {
        VAULT_ADDRESS: '0x0C09EC94aDb65314448562B028FC5AfDBa421742',
        KEEPER_ACCOUNT: 'legacy-ladder-keeper',
        KEEPER_PASSWORD_FILE: '/root/.foundry/keystores/legacy-ladder-keeper.password',
        CAST_BIN: '/root/.foundry/bin/cast',
        INTERVAL_SECONDS: '600',
        MAX_GAS_GWEI: '1',
      },
      max_restarts: 10,
      restart_delay: 60000,
    },
    {
      // Watches the contracts, keeper and website; alerts to Telegram (scripts/monitor.mjs). Telegram credentials live
      // in /etc/legacy-ladder/monitor.env, outside the repository.
      name: 'ladder-monitor',
      cwd: '/var/www/coreoslab/projects/project21 - Legacy Ladder',
      script: 'scripts/monitor.mjs',
      interpreter: NODE,
      env: { INTERVAL_SECONDS: '300', DAILY_SUMMARY_UTC_HOUR: '1' },
      max_restarts: 50,
      restart_delay: 60000,
    },
  ],
};
