require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const name = process.env.NAME;

// Three processes: the forwarder on the public port and two Java replicas behind it.
// pm2 stop beacon-a is the leader failover test in the README.
const shared = {
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  cwd: __dirname,
  watch: false
};

module.exports = {
  apps: [
    {
      ...shared,
      name,
      script: 'forwarder.js',
      out_file: `../prod-logs/${name}-out.log`,
      error_file: `../prod-logs/${name}-error.log`
    },
    {
      ...shared,
      name: 'beacon-a',
      script: './run.sh',
      args: 'A',
      out_file: `../prod-logs/beacon-a-out.log`,
      error_file: `../prod-logs/beacon-a-error.log`
    },
    {
      ...shared,
      name: 'beacon-b',
      script: './run.sh',
      args: 'B',
      out_file: `../prod-logs/beacon-b-out.log`,
      error_file: `../prod-logs/beacon-b-error.log`
    }
  ]
};
