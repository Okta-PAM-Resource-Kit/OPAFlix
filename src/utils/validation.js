const Joi = require('joi');
const { FILE_ID_PATTERN } = require('../config/constants');

// File ID validation schema
const fileIdSchema = Joi.string()
  .pattern(FILE_ID_PATTERN)
  .max(255)
  .required()
  .messages({
    'string.pattern.base': 'Invalid file ID format',
    'string.max': 'File ID too long',
    'any.required': 'File ID is required',
  });

// Pagination schema
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

function validateFileId(fileId) {
  const { error, value } = fileIdSchema.validate(fileId);
  if (error) {
    return { valid: false, error: error.details[0].message };
  }
  return { valid: true, value };
}

function validatePagination(query) {
  const { error, value } = paginationSchema.validate(query);
  if (error) {
    return { valid: false, error: error.details[0].message };
  }
  return { valid: true, value };
}

function sanitizeFilename(filename) {
  if (!filename) return null;

  // Remove path components
  const basename = filename.split('/').pop().split('\\').pop();

  // Validate against pattern
  const { valid } = validateFileId(basename);
  if (!valid) return null;

  return basename;
}

function isPathTraversal(input) {
  if (!input) return false;

  const dangerous = [
    '..',
    '/',
    '\\',
    '%2e%2e',
    '%2f',
    '%5c',
    '..%c0%af',
    '..%c1%9c',
  ];

  const lower = input.toLowerCase();
  return dangerous.some(d => lower.includes(d));
}

module.exports = {
  validateFileId,
  validatePagination,
  sanitizeFilename,
  isPathTraversal,
};
