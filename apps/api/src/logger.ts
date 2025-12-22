import winston from "winston"

const { LOG_LEVEL } = process.env

const winstonLogger = winston.createLogger({
  level: LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.simple()
  ),
  defaultMeta: { service: "polymarket-mvp-api" },
  transports: [new winston.transports.Console()],
  exceptionHandlers: [new winston.transports.Console()],
})

// Wrapper to maintain existing API compatibility
export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    winstonLogger.debug(message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    winstonLogger.info(message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    winstonLogger.warn(message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    winstonLogger.error(message, meta),
}

export default winstonLogger
