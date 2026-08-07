{
  "apps": [
    {
      "name": "tmail-api",
      "cwd": "/srv/tmail/api",
      "script": "node_modules/tsx/dist/cli.mjs",
      "args": "src/index.ts",
      "interpreter": "node",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production"
      },
      "env_file": "/srv/tmail/.env",
      "max_memory_restart": "400M",
      "time": true,
      "merge_logs": true,
      "out_file": "/srv/tmail/logs/api-out.log",
      "error_file": "/srv/tmail/logs/api-err.log"
    },
    {
      "name": "tmail-web",
      "cwd": "/srv/tmail/web",
      "script": "npx",
      "args": "serve -s build -l 3173",
      "interpreter": "none",
      "instances": 1,
      "exec_mode": "fork",
      "env": {
        "NODE_ENV": "production"
      },
      "max_memory_restart": "150M",
      "time": true,
      "merge_logs": true,
      "out_file": "/srv/tmail/logs/web-out.log",
      "error_file": "/srv/tmail/logs/web-err.log"
    }
  ]
}
