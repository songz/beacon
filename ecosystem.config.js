require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const name = process.env.NAME;

module.exports = {
  apps: [
    {
      name,
      script: './run.sh',
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      cwd: __dirname,
      out_file: `../prod-logs/${name}-out.log`,
      error_file: `../prod-logs/${name}-error.log`,
      watch: false
    }
  ]
};
