const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
};

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function write(color: string, scope: string, message: string): void {
  process.stderr.write(`${colors.dim}${stamp()}${colors.reset} ${color}[${scope}]${colors.reset} ${message}\n`);
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function logger(scope: string): Logger {
  return {
    info: (message) => write(colors.blue, scope, message),
    warn: (message) => write(colors.yellow, scope, message),
    error: (message) => write(colors.red, scope, message),
    debug: (message) => {
      if (process.env.KIJIJI_DEBUG) write(colors.dim, scope, message);
    },
  };
}

export function success(message: string): void {
  process.stderr.write(`${colors.green}${message}${colors.reset}\n`);
}
