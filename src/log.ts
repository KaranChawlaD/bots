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

export interface LogLine {
  level: "info" | "warn" | "error" | "debug" | "success";
  scope: string;
  message: string;
  at: string;
}

const sinks = new Set<(line: LogLine) => void>();

/** Mirror every log line somewhere else (the web UI streams them to the page). */
export function addLogSink(sink: (line: LogLine) => void): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

function emit(level: LogLine["level"], scope: string, message: string): void {
  const line: LogLine = { level, scope, message, at: new Date().toISOString() };
  for (const sink of sinks) sink(line);
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
    info: (message) => {
      write(colors.blue, scope, message);
      emit("info", scope, message);
    },
    warn: (message) => {
      write(colors.yellow, scope, message);
      emit("warn", scope, message);
    },
    error: (message) => {
      write(colors.red, scope, message);
      emit("error", scope, message);
    },
    debug: (message) => {
      if (process.env.KIJIJI_DEBUG) write(colors.dim, scope, message);
      emit("debug", scope, message);
    },
  };
}

export function success(message: string): void {
  process.stderr.write(`${colors.green}${message}${colors.reset}\n`);
  emit("success", "done", message);
}
