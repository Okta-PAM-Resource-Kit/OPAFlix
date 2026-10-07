/**
 * Pagination helper utilities
 */

const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 10,
};

/**
 * Calculate pagination metadata
 * @param {number} totalCount - Total number of items
 * @param {number} currentPage - Current page number (1-based)
 * @param {number} pageSize - Items per page
 * @returns {object} Pagination metadata
 */
function calculatePagination(totalCount, currentPage, pageSize) {
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const validPage = Math.max(1, Math.min(currentPage, totalPages));

  return {
    currentPage: validPage,
    pageSize,
    totalPages,
    totalCount,
    hasNext: validPage < totalPages,
    hasPrevious: validPage > 1,
    nextPage: validPage < totalPages ? validPage + 1 : null,
    previousPage: validPage > 1 ? validPage - 1 : null,
    startIndex: (validPage - 1) * pageSize,
    endIndex: Math.min(validPage * pageSize, totalCount),
  };
}

/**
 * Validate and normalize pagination parameters
 * @param {number|string} page - Page number from request
 * @param {number|string} pageSize - Page size from request
 * @param {Object} tenantConfig - Optional tenant config with per-tenant page size
 * @returns {object} Validated { page, pageSize }
 */
function validatePaginationParams(page, pageSize, tenantConfig = null) {
  let validPage = parseInt(page, 10) || 1;
  // Use per-tenant default if available, otherwise global default
  const defaultPageSize = parseInt(tenantConfig?.opaflix?.defaultPageSize, 10) || PAGINATION.DEFAULT_PAGE_SIZE;
  let validPageSize = parseInt(pageSize, 10) || defaultPageSize;

  // Clamp page to minimum of 1
  validPage = Math.max(1, validPage);

  // Clamp page size to valid range
  validPageSize = Math.max(PAGINATION.MIN_PAGE_SIZE, validPageSize);
  validPageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, validPageSize);

  return {
    page: validPage,
    pageSize: validPageSize,
  };
}

/**
 * Slice array for current page
 * @param {Array} items - Full array of items
 * @param {number} page - Page number (1-based)
 * @param {number} pageSize - Items per page
 * @returns {Array} Items for the requested page
 */
function getPageSlice(items, page, pageSize) {
  const startIndex = (page - 1) * pageSize;
  return items.slice(startIndex, startIndex + pageSize);
}

/**
 * Generate page numbers for pagination UI
 * @param {number} currentPage - Current page
 * @param {number} totalPages - Total number of pages
 * @param {number} maxVisible - Maximum number of page links to show
 * @returns {Array} Array of page numbers/ellipsis markers
 */
function getPageNumbers(currentPage, totalPages, maxVisible = 7) {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = [];
  const half = Math.floor(maxVisible / 2);

  // Always show first page
  pages.push(1);

  let start = Math.max(2, currentPage - half);
  let end = Math.min(totalPages - 1, currentPage + half);

  // Adjust if near the beginning
  if (currentPage <= half + 1) {
    end = Math.min(totalPages - 1, maxVisible - 2);
  }

  // Adjust if near the end
  if (currentPage >= totalPages - half) {
    start = Math.max(2, totalPages - maxVisible + 3);
  }

  // Add ellipsis after first page if needed
  if (start > 2) {
    pages.push('...');
  }

  // Add middle pages
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  // Add ellipsis before last page if needed
  if (end < totalPages - 1) {
    pages.push('...');
  }

  // Always show last page
  if (totalPages > 1) {
    pages.push(totalPages);
  }

  return pages;
}

module.exports = {
  PAGINATION,
  calculatePagination,
  validatePaginationParams,
  getPageSlice,
  getPageNumbers,
};
