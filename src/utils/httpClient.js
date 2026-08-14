const axios = require('axios');

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  if (!error) return false;

  const code = error.code || '';
  if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE' ||
    code === 'ERR_NETWORK'
  ) {
    return true;
  }

  if (error.message && /timeout|network|socket hang up|ECONN/i.test(error.message)) {
    return true;
  }

  // No response = network / DNS / aborted
  if (!error.response) return true;

  const status = error.response.status;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function attachRetry(client, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (!config) return Promise.reject(error);

      config.__retryCount = config.__retryCount || 0;
      const attempt = config.__retryCount + 1;

      if (attempt >= maxAttempts || !isRetryableError(error)) {
        return Promise.reject(error);
      }

      config.__retryCount = attempt;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      const method = (config.method || 'get').toUpperCase();
      const url = config.url || '';
      console.warn(
        `[http] retry ${attempt}/${maxAttempts - 1} ${method} ${url} — ${error.message} (wait ${delay}ms)`
      );

      await sleep(delay);
      return client.request(config);
    }
  );

  return client;
}

/**
 * Axios instance with timeout + automatic retry on timeout/network/5xx.
 * maxAttempts includes the first try (default 3 = 1 try + 2 retries).
 */
function createHttpClient(config = {}, retryOptions = {}) {
  const client = axios.create({
    timeout: DEFAULT_TIMEOUT,
    ...config
  });
  return attachRetry(client, retryOptions);
}

module.exports = {
  createHttpClient,
  attachRetry,
  isRetryableError,
  sleep,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_ATTEMPTS
};
