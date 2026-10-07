/**
 * Shared JavaScript for SSH and RDP session list pages
 * All event handlers are attached via addEventListener to comply with CSP
 */

/**
 * Get CSRF token from meta tag
 */
function getCsrfToken() {
  var meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') : '';
}

// Current sort state (initialized from page data)
var currentSortField = 'timestamp';
var currentSortOrder = 'desc';
var sessionType = 'ssh'; // 'ssh' or 'rdp'

// Filter options cache
var filterOptionsCache = null;
var filterOptionsCacheTimestamp = 0;
var FILTER_OPTIONS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Refresh polling state
var refreshPollInterval = null;

/**
 * Initialize the session list page
 * @param {object} options - Configuration options
 */
function initSessionList(options) {
  currentSortField = options.sortField || 'timestamp';
  currentSortOrder = options.sortOrder || 'desc';
  sessionType = options.sessionType || 'ssh';
  var isRefreshing = options.isRefreshing || false;

  initSortableHeaders();
  initColumnResize();
  initSearchInput();
  initSortControls();
  initAdvancedSearch();
  initPagination();
  initAdvancedSearchFromUrl();
  initFilterDropdowns();
  initRefreshStatus(isRefreshing);
}

// ===== Navigation Functions =====

/**
 * Navigate to a page
 */
function goToPage(page) {
  var url = new URL(window.location.href);
  url.searchParams.set('page', page);
  window.location.href = url.toString();
}

/**
 * Navigate with sort parameters
 */
function navigateWithSort(field, order) {
  var url = new URL(window.location.href);
  url.searchParams.set('sort', field);
  url.searchParams.set('order', order);
  url.searchParams.set('page', '1');
  window.location.href = url.toString();
}

// ===== Sort Functions =====

/**
 * Apply sort from dropdown controls
 */
function applySort() {
  var sortFieldEl = document.getElementById('sortField');
  var sortOrderEl = document.getElementById('sortOrder');
  if (sortFieldEl && sortOrderEl) {
    navigateWithSort(sortFieldEl.value, sortOrderEl.value);
  }
}

/**
 * Initialize sort dropdown controls
 */
function initSortControls() {
  var sortFieldEl = document.getElementById('sortField');
  var sortOrderEl = document.getElementById('sortOrder');

  if (sortFieldEl) {
    sortFieldEl.addEventListener('change', applySort);
  }
  if (sortOrderEl) {
    sortOrderEl.addEventListener('change', applySort);
  }
}

/**
 * Initialize clickable table headers for sorting
 */
function initSortableHeaders() {
  document.querySelectorAll('.sessions-table th.sortable').forEach(function(th) {
    th.addEventListener('click', function(e) {
      // Don't sort if clicking on the resizer
      if (e.target.classList.contains('column-resizer')) return;

      var field = this.dataset.sort;
      var newOrder = 'desc';
      if (currentSortField === field) {
        newOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
      }
      navigateWithSort(field, newOrder);
    });
  });
}

// ===== Column Resize =====

/**
 * Initialize column resizing
 */
function initColumnResize() {
  var table = document.getElementById('sessionsTable');
  if (!table) return;

  var cols = table.querySelectorAll('thead th');
  cols.forEach(function(col, index) {
    if (index === cols.length - 1) return; // Skip last column (Action)

    var resizer = document.createElement('div');
    resizer.className = 'column-resizer';
    col.appendChild(resizer);
    col.style.position = 'relative';

    var startX, startWidth;

    resizer.addEventListener('mousedown', function(e) {
      startX = e.pageX;
      startWidth = col.offsetWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      resizer.classList.add('resizing');
      e.preventDefault();
      e.stopPropagation();
    });

    function onMouseMove(e) {
      var width = startWidth + (e.pageX - startX);
      if (width > 50) {
        col.style.width = width + 'px';
        col.style.minWidth = width + 'px';
      }
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resizer.classList.remove('resizing');
    }
  });
}

// ===== Search Input =====

/**
 * Initialize search input
 */
function initSearchInput() {
  var searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        this.form.submit();
      }
    });
  }
}

// ===== Pagination =====

/**
 * Initialize pagination controls
 */
function initPagination() {
  // Pagination navigation links
  document.querySelectorAll('.pagination-nav').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var page = this.dataset.page;
      if (page) {
        goToPage(page);
      }
    });
  });

  // Page jump
  var pageJumpBtn = document.getElementById('pageJumpBtn');
  var pageJumpInput = document.getElementById('pageJump');

  if (pageJumpBtn && pageJumpInput) {
    pageJumpBtn.addEventListener('click', function() {
      jumpToPage();
    });

    pageJumpInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        jumpToPage();
      }
    });
  }
}

/**
 * Jump to specific page
 */
function jumpToPage() {
  var input = document.getElementById('pageJump');
  if (!input) return;

  var page = parseInt(input.value, 10);
  var maxPage = parseInt(input.dataset.max, 10) || 1;

  if (page >= 1 && page <= maxPage) {
    goToPage(page);
  }
}

// ===== Advanced Search Functions =====

/**
 * Initialize advanced search modal and controls
 */
function initAdvancedSearch() {
  // Open modal button
  var advancedSearchBtn = document.getElementById('advancedSearchBtn');
  if (advancedSearchBtn) {
    advancedSearchBtn.addEventListener('click', openAdvancedSearch);
  }

  // Close modal button
  var modalCloseBtn = document.getElementById('modalCloseBtn');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeAdvancedSearch);
  }

  // Clear filters button (in filter bar)
  var clearFiltersBtn = document.getElementById('clearFiltersBtn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', clearAllFilters);
  }

  // Clear filters button (in empty state)
  var clearFiltersEmptyBtn = document.getElementById('clearFiltersEmptyBtn');
  if (clearFiltersEmptyBtn) {
    clearFiltersEmptyBtn.addEventListener('click', clearAllFilters);
  }

  // Refresh sessions button
  var refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
  if (refreshSessionsBtn) {
    refreshSessionsBtn.addEventListener('click', refreshSessions);
  }

  // Reset button in modal
  var resetFiltersBtn = document.getElementById('resetFiltersBtn');
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', resetAdvancedSearch);
  }

  // Apply filters button
  var applyFiltersBtn = document.getElementById('applyFiltersBtn');
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', applyAdvancedSearch);
  }

  // Date preset buttons
  var presetButtons = document.getElementById('datePresetButtons');
  if (presetButtons) {
    presetButtons.addEventListener('click', function(e) {
      var btn = e.target.closest('button[data-preset]');
      if (btn) {
        setDatePreset(btn.dataset.preset);
      }
    });
  }

  // Close modal on overlay click
  var modal = document.getElementById('advancedSearchModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeAdvancedSearch();
      }
    });
  }

  // Close modal on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeAdvancedSearch();
    }
  });
}

/**
 * Open advanced search modal
 */
function openAdvancedSearch() {
  var modal = document.getElementById('advancedSearchModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Focus session type select
    var typeSelect = document.getElementById('adv-type');
    if (typeSelect) typeSelect.focus();
  }
}

/**
 * Close advanced search modal
 */
function closeAdvancedSearch() {
  var modal = document.getElementById('advancedSearchModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

/**
 * Initialize advanced search form from URL parameters
 */
function initAdvancedSearchFromUrl() {
  var params = new URLSearchParams(window.location.search);

  setInputValue('adv-type', params.get('type'));
  setInputValue('adv-server', params.get('server'));
  setInputValue('adv-username', params.get('username'));
  setInputValue('adv-project', params.get('project'));
  setInputValue('adv-dateFrom', params.get('dateFrom'));
  setInputValue('adv-dateTo', params.get('dateTo'));

  // Update filter badge count
  updateFilterBadge();
}

/**
 * Set input value if element exists
 */
function setInputValue(id, value) {
  var el = document.getElementById(id);
  if (el && value) {
    el.value = value;
  }
}

/**
 * Apply advanced search filters
 */
function applyAdvancedSearch() {
  var url = new URL(window.location.origin + '/sessions/list');

  // Get all filter values
  var typeFilter = document.getElementById('adv-type');
  var server = document.getElementById('adv-server');
  var username = document.getElementById('adv-username');
  var project = document.getElementById('adv-project');
  var dateFrom = document.getElementById('adv-dateFrom');
  var dateTo = document.getElementById('adv-dateTo');

  // Get sort params from current URL
  var currentUrl = new URL(window.location.href);
  var sortField = currentUrl.searchParams.get('sort');
  var sortOrder = currentUrl.searchParams.get('order');

  // Set filters
  if (typeFilter && typeFilter.value) url.searchParams.set('type', typeFilter.value);
  if (server && server.value.trim()) url.searchParams.set('server', server.value.trim());
  if (username && username.value.trim()) url.searchParams.set('username', username.value.trim());
  if (project && project.value.trim()) url.searchParams.set('project', project.value.trim());
  if (dateFrom && dateFrom.value) url.searchParams.set('dateFrom', dateFrom.value);
  if (dateTo && dateTo.value) url.searchParams.set('dateTo', dateTo.value);

  // Restore sort params
  if (sortField) url.searchParams.set('sort', sortField);
  if (sortOrder) url.searchParams.set('order', sortOrder);

  // Reset to page 1
  url.searchParams.set('page', '1');

  window.location.href = url.toString();
}

/**
 * Reset advanced search form
 */
function resetAdvancedSearch() {
  var fields = ['adv-type', 'adv-server', 'adv-username', 'adv-project', 'adv-dateFrom', 'adv-dateTo'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/**
 * Clear all filters and redirect
 */
function clearAllFilters() {
  var url = new URL(window.location.href);
  var sortField = url.searchParams.get('sort');
  var sortOrder = url.searchParams.get('order');

  url.search = '';

  if (sortField) url.searchParams.set('sort', sortField);
  if (sortOrder) url.searchParams.set('order', sortOrder);

  window.location.href = url.toString();
}

/**
 * Get tenant and team parameters for API calls
 * Uses ?tenant=URL&team=NAME format
 */
function getTeamParam() {
  var url = new URL(window.location.href);
  var tenant = url.searchParams.get('tenant') || '';
  var team = url.searchParams.get('team') || '';
  var params = [];
  if (tenant) params.push('tenant=' + encodeURIComponent(tenant));
  if (team) params.push('team=' + encodeURIComponent(team));
  return params.length ? '?' + params.join('&') : '';
}

/**
 * Initialize refresh status - check on page load
 * @param {boolean} isRefreshing - If true, a background refresh was just triggered
 */
function initRefreshStatus(isRefreshing) {
  // If server triggered a refresh, start polling immediately
  if (isRefreshing) {
    startRefreshPolling();
  }
  checkRefreshStatus();
}

/**
 * Check refresh status from API
 */
function checkRefreshStatus() {
  fetch('/api/refresh/status' + getTeamParam(), {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json',
    },
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      updateLastUpdatedIndicator(data);

      // If refresh is in progress, start polling
      if (data.isBuilding) {
        startRefreshPolling();
      }
    })
    .catch(function(error) {
      console.warn('Failed to check refresh status:', error.message);
    });
}

/**
 * Update the last updated indicator UI
 */
function updateLastUpdatedIndicator(data) {
  var indicator = document.getElementById('lastUpdatedIndicator');
  var text = document.getElementById('lastUpdatedText');
  var btn = document.getElementById('refreshSessionsBtn');
  var btnText = document.getElementById('refreshBtnText');

  if (!indicator || !text) return;

  indicator.style.display = 'inline-flex';

  if (data.isBuilding) {
    // Show building state
    var dot = indicator.querySelector('.last-updated-dot');
    if (dot) {
      dot.className = 'last-updated-dot building';
    }
    var phase = data.progress?.phase || 'refreshing';
    var current = data.progress?.current || 0;
    text.textContent = phase === 'starting' ? 'Starting refresh...' :
                       phase === 'fetching ssh' ? 'Fetching SSH sessions (' + current + ')...' :
                       phase === 'fetching rdp' ? 'Fetching RDP sessions (' + current + ')...' :
                       phase === 'finalizing' ? 'Finalizing...' :
                       'Refreshing...';

    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
    }
    if (btnText) {
      btnText.textContent = 'Refreshing...';
    }
  } else if (data.lastError) {
    // Show error state
    var dot = indicator.querySelector('.last-updated-dot');
    if (dot) {
      dot.className = 'last-updated-dot error';
    }
    // Show error message (truncated if too long)
    var errorMsg = data.lastError.length > 60 ? data.lastError.substring(0, 60) + '...' : data.lastError;
    text.textContent = 'Error: ' + errorMsg;
    text.title = data.lastError; // Full error on hover

    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    if (btnText) {
      btnText.textContent = 'Retry';
    }
  } else {
    // Show last updated state
    var dot = indicator.querySelector('.last-updated-dot');
    if (dot) {
      dot.className = 'last-updated-dot ' + (data.isStale ? 'stale' : 'fresh');
    }
    text.textContent = data.lastUpdatedAgo ? 'Updated ' + data.lastUpdatedAgo : 'Never updated';
    text.title = ''; // Clear any previous error tooltip

    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
    if (btnText) {
      btnText.textContent = 'Refresh';
    }
  }
}

/**
 * Start polling for refresh status
 */
function startRefreshPolling() {
  if (refreshPollInterval) return; // Already polling

  refreshPollInterval = setInterval(function() {
    fetch('/api/refresh/status' + getTeamParam(), {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
      },
    })
      .then(function(response) {
        return response.json();
      })
      .then(function(data) {
        updateLastUpdatedIndicator(data);

        // If refresh complete, stop polling and reload
        if (!data.isBuilding) {
          stopRefreshPolling();
          // Reload page to show new data
          window.location.reload();
        }
      })
      .catch(function(error) {
        console.warn('Failed to poll refresh status:', error.message);
      });
  }, 1000); // Poll every second
}

/**
 * Stop polling for refresh status
 */
function stopRefreshPolling() {
  if (refreshPollInterval) {
    clearInterval(refreshPollInterval);
    refreshPollInterval = null;
  }
}

/**
 * Refresh sessions cache (non-blocking)
 */
function refreshSessions() {
  var btn = document.getElementById('refreshSessionsBtn');
  var btnText = document.getElementById('refreshBtnText');

  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }
  if (btnText) {
    btnText.textContent = 'Starting...';
  }

  fetch('/api/refresh/sessions' + getTeamParam(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    },
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(data) {
      if (data.success) {
        // Start polling for status
        startRefreshPolling();
        // Initial status check
        checkRefreshStatus();
      } else {
        alert('Failed to start refresh: ' + (data.error || 'Unknown error'));
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('loading');
        }
        if (btnText) {
          btnText.textContent = 'Refresh';
        }
      }
    })
    .catch(function(error) {
      alert('Failed to start refresh: ' + error.message);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
      if (btnText) {
        btnText.textContent = 'Refresh';
      }
    });
}

/**
 * Set date preset
 */
function setDatePreset(preset) {
  var dateFrom = document.getElementById('adv-dateFrom');
  var dateTo = document.getElementById('adv-dateTo');

  if (!dateFrom || !dateTo) return;

  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  var fromValue = '';
  var toValue = '';

  switch (preset) {
    case 'today':
      fromValue = formatDateTimeLocal(today);
      toValue = formatDateTimeLocal(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1));
      break;
    case 'yesterday':
      var yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      fromValue = formatDateTimeLocal(yesterday);
      toValue = formatDateTimeLocal(new Date(today.getTime() - 1));
      break;
    case 'week':
      var weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      fromValue = formatDateTimeLocal(weekAgo);
      toValue = formatDateTimeLocal(now);
      break;
    case 'month':
      var monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      fromValue = formatDateTimeLocal(monthAgo);
      toValue = formatDateTimeLocal(now);
      break;
    case 'year':
      var yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
      fromValue = formatDateTimeLocal(yearAgo);
      toValue = formatDateTimeLocal(now);
      break;
    case 'clear':
      fromValue = '';
      toValue = '';
      break;
  }

  // Set values using setAttribute to ensure DOM updates
  dateFrom.value = fromValue;
  dateTo.value = toValue;

  // Dispatch input events to trigger any listeners
  dateFrom.dispatchEvent(new Event('input', { bubbles: true }));
  dateTo.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Format date for datetime-local input
 */
function formatDateTimeLocal(date) {
  var year = date.getFullYear();
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  var hours = String(date.getHours()).padStart(2, '0');
  var minutes = String(date.getMinutes()).padStart(2, '0');

  return year + '-' + month + '-' + day + 'T' + hours + ':' + minutes;
}

/**
 * Count active filters and update badge
 */
function updateFilterBadge() {
  var params = new URLSearchParams(window.location.search);
  var count = 0;

  ['server', 'username', 'project', 'dateFrom', 'dateTo', 'q'].forEach(function(key) {
    if (params.get(key)) count++;
  });

  var badge = document.getElementById('filterBadge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Show/hide clear filters button
  var clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// ===== Autocomplete Functions =====

// Store filter options data
var filterOptionsData = null;
var activeAutocomplete = null;
var highlightedIndex = -1;

/**
 * Initialize autocomplete inputs with data from OPA API
 */
function initFilterDropdowns() {
  loadFilterOptions();
  initAutocompleteInputs();
}

/**
 * Load filter options from API with caching
 */
function loadFilterOptions() {
  var now = Date.now();

  // Check session storage cache first
  var cached = sessionStorage.getItem('filterOptions');
  var cachedTimestamp = parseInt(sessionStorage.getItem('filterOptionsTimestamp') || '0', 10);

  if (cached && cachedTimestamp && (now - cachedTimestamp) < FILTER_OPTIONS_CACHE_TTL) {
    try {
      filterOptionsData = JSON.parse(cached);
      refreshActiveAutocomplete();
      return;
    } catch (e) {
      // Invalid cache, proceed to fetch
    }
  }

  // Mark as loading
  filterOptionsData = { loading: true };

  // Fetch filter options from session data
  fetch('/api/filter-options', {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json',
    },
  })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('Failed to fetch filter options');
      }
      return response.json();
    })
    .then(function(options) {
      // Cache in session storage
      sessionStorage.setItem('filterOptions', JSON.stringify(options));
      sessionStorage.setItem('filterOptionsTimestamp', String(Date.now()));
      filterOptionsData = options;
      // Refresh any active autocomplete dropdown
      refreshActiveAutocomplete();
    })
    .catch(function(error) {
      console.warn('Failed to load filter options:', error.message);
      filterOptionsData = { enabled: false };
      refreshActiveAutocomplete();
    });
}

/**
 * Refresh the currently active autocomplete dropdown (if any)
 */
function refreshActiveAutocomplete() {
  var focusedInput = document.activeElement;
  if (focusedInput && focusedInput.classList.contains('autocomplete-input')) {
    var dropdownId = focusedInput.id + '-dropdown';
    var dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      showAutocomplete(focusedInput, dropdown);
    }
  }
}

/**
 * Initialize all autocomplete inputs
 */
function initAutocompleteInputs() {
  var inputs = document.querySelectorAll('.autocomplete-input');

  inputs.forEach(function(input) {
    var dropdownId = input.id + '-dropdown';
    var dropdown = document.getElementById(dropdownId);

    if (!dropdown) return;

    // Focus event - show dropdown
    input.addEventListener('focus', function() {
      showAutocomplete(input, dropdown);
    });

    // Input event - filter results
    input.addEventListener('input', function() {
      showAutocomplete(input, dropdown);
    });

    // Blur event - hide dropdown (with delay for click)
    input.addEventListener('blur', function() {
      setTimeout(function() {
        hideAutocomplete(dropdown);
      }, 200);
    });

    // Keyboard navigation
    input.addEventListener('keydown', function(e) {
      handleAutocompleteKeydown(e, input, dropdown);
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.autocomplete-wrapper')) {
      document.querySelectorAll('.autocomplete-dropdown').forEach(function(d) {
        hideAutocomplete(d);
      });
    }
  });
}

/**
 * Show autocomplete dropdown with filtered results
 */
function showAutocomplete(input, dropdown) {
  var dataKey = input.dataset.autocomplete;
  var query = input.value.toLowerCase().trim();

  // Check if data is still loading
  if (filterOptionsData && filterOptionsData.loading) {
    dropdown.innerHTML = '<div class="autocomplete-empty">Loading...</div>';
    dropdown.classList.add('active');
    activeAutocomplete = dropdown;
    return;
  }

  var options = getOptionsForField(dataKey);

  if (!options || options.length === 0) {
    dropdown.innerHTML = '<div class="autocomplete-empty">No options available</div>';
    dropdown.classList.add('active');
    activeAutocomplete = dropdown;
    return;
  }

  // Filter options
  var filtered;
  if (query === '') {
    // Show first 20 when empty
    filtered = options.slice(0, 20);
  } else {
    // Filter by query
    filtered = options.filter(function(opt) {
      return opt.toLowerCase().includes(query);
    }).slice(0, 20);
  }

  // Build dropdown content
  var html = '';

  if (query === '' && options.length > 20) {
    html += '<div class="autocomplete-hint">Showing first 20 of ' + options.length + ' - type to filter</div>';
  }

  if (filtered.length === 0) {
    html += '<div class="autocomplete-empty">No matches found</div>';
  } else {
    filtered.forEach(function(opt, index) {
      var isSelected = opt === input.value;
      html += '<div class="autocomplete-item' + (isSelected ? ' selected' : '') + '" data-value="' + escapeHtml(opt) + '" data-index="' + index + '">' + escapeHtml(opt) + '</div>';
    });
  }

  dropdown.innerHTML = html;
  dropdown.classList.add('active');
  activeAutocomplete = dropdown;
  highlightedIndex = -1;

  // Add click handlers to items
  dropdown.querySelectorAll('.autocomplete-item').forEach(function(item) {
    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      selectAutocompleteItem(input, dropdown, item.dataset.value);
    });
  });
}

/**
 * Hide autocomplete dropdown
 */
function hideAutocomplete(dropdown) {
  dropdown.classList.remove('active');
  if (activeAutocomplete === dropdown) {
    activeAutocomplete = null;
  }
  highlightedIndex = -1;
}

/**
 * Handle keyboard navigation in autocomplete
 */
function handleAutocompleteKeydown(e, input, dropdown) {
  var items = dropdown.querySelectorAll('.autocomplete-item');

  if (!dropdown.classList.contains('active') || items.length === 0) {
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
      break;

    case 'ArrowUp':
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(items);
      break;

    case 'Enter':
      e.preventDefault();
      if (highlightedIndex >= 0 && items[highlightedIndex]) {
        selectAutocompleteItem(input, dropdown, items[highlightedIndex].dataset.value);
      }
      break;

    case 'Escape':
      hideAutocomplete(dropdown);
      break;
  }
}

/**
 * Update highlighted item in dropdown
 */
function updateHighlight(items) {
  items.forEach(function(item, index) {
    if (index === highlightedIndex) {
      item.classList.add('highlighted');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('highlighted');
    }
  });
}

/**
 * Select an item from autocomplete
 */
function selectAutocompleteItem(input, dropdown, value) {
  input.value = value;
  hideAutocomplete(dropdown);
  input.focus();
}

/**
 * Get options array for a specific field
 */
function getOptionsForField(fieldKey) {
  if (!filterOptionsData || !filterOptionsData.enabled) {
    return [];
  }

  return filterOptionsData[fieldKey] || [];
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Clear filter options cache
 */
function clearFilterOptionsCache() {
  sessionStorage.removeItem('filterOptions');
  sessionStorage.removeItem('filterOptionsTimestamp');
  filterOptionsData = null;
}
