/**
 * Central error handler.
 *
 * A database or library error is an internal detail: it can name tables,
 * columns, file paths and constraint names. None of that belongs in an API
 * response. In production the client gets a generic message and a
 * correlation id; the detail goes to the server log only.
 *
 * In development the message is passed through, because that is where a
 * developer needs to see it.
 */
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  // A short, random id that ties the client's response to the log entry.
  const reference = Math.random().toString(36).slice(2, 10);

  console.error(
    `[Error] ${reference} ${statusCode} ${req.method} ${req.originalUrl} - ${err.message}`
  );
  if (err.stack) console.error(err.stack);

  if (res.headersSent) return next(err);

  if (isServerError && process.env.NODE_ENV === 'production') {
    return res.status(statusCode).json({
      status: 'error',
      statusCode,
      message: 'Internal Server Error',
      reference,
    });
  }

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message: err.message || 'Internal Server Error',
    reference,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
