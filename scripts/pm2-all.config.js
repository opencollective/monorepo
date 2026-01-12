module.exports = {
  apps: [
    {
      name: 'frontend',
      cwd: './opencollective-frontend',
      script: 'npm',
      args: 'run dev',
      log_file: '../logs/frontend.log',
      out_file: '../logs/frontend-out.log',
      error_file: '../logs/frontend-error.log',
    },
    {
      name: 'api',
      cwd: './opencollective-api',
      script: 'npm',
      args: 'run dev',
      log_file: '../logs/api.log',
      out_file: '../logs/api-out.log',
      error_file: '../logs/api-error.log',
    },
    {
      name: 'pdf',
      cwd: './opencollective-pdf',
      script: 'npm',
      args: 'run dev',
      log_file: '../logs/pdf.log',
      out_file: '../logs/pdf-out.log',
      error_file: '../logs/pdf-error.log',
    }
  ]
};
