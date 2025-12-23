import axios, { isAxiosError } from "axios";
import { logger } from "../logger.js";

export function setupAxiosInterceptors(): void {
  axios.interceptors.request.use(
    (config) => {
      config.headers.set(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      );
      config.headers.set(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      );
      config.headers.set("Accept-Language", "en-US,en;q=0.9");
      config.headers.set("Accept-Encoding", "gzip, deflate, br");
      config.headers.set("Referer", "https://polymarket.com/");
      config.headers.set("Origin", "https://polymarket.com");
      return config;
    },
    (error) => {
      return Promise.reject(error);
    },
  );

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;

        if (
          status === 403 &&
          typeof data === "string" &&
          data.includes("Cloudflare")
        ) {
          logger.error("Circuit breaker triggered: Cloudflare block detected");
          throw new Error("CIRCUIT_BREAKER: Cloudflare blocked request");
        }

        if (status === 429) {
          logger.error("Circuit breaker triggered: Rate limit exceeded");
          throw new Error("CIRCUIT_BREAKER: Rate limit exceeded");
        }
      }
      return Promise.reject(error);
    },
  );
}
