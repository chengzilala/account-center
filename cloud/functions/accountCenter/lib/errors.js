'use strict';

/** 带业务错误码的异常：code 给程序判断，message 给用户看 */
class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

function invalid(message) {
  return new AppError('INVALID_PARAM', message, 400);
}

function unauthorized(message = '登录已失效，请重新登录') {
  return new AppError('UNAUTHORIZED', message, 401);
}

function rateLimited(retryAfter, message) {
  const err = new AppError('RATE_LIMITED', message || `请求太频繁，请 ${retryAfter} 秒后再试`, 429);
  err.retryAfter = retryAfter;
  return err;
}

module.exports = { AppError, invalid, unauthorized, rateLimited };
