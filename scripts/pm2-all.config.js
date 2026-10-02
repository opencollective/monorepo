module.exports = {
  apps: [
    {
      name: "frontend",
      cwd: "./opencollective-frontend",
      script: "npm",
      args: "run dev",
      log_file: "../priv/logs/frontend.log",
    },
    {
      name: "api",
      cwd: "./opencollective-api",
      script: "npm",
      args: "run dev",
      log_file: "../priv/logs/api.log",
    },
    {
      name: "pdf",
      cwd: "./opencollective-pdf",
      script: "npm",
      args: "run dev",
      log_file: "../priv/logs/pdf.log",
    },
    {
      name: "rest",
      cwd: "./opencollective-rest",
      script: "npm",
      args: "run dev",
      log_file: "../priv/logs/rest.log",
    },
    {
      name: "images",
      cwd: "./opencollective-images",
      script: "npm",
      args: "run dev",
      log_file: "../priv/logs/images.log",
    },
  ],
};
