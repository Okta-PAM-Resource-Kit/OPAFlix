/**
 * Configuration Page JavaScript
 */
(function() {
  'use strict';

  /**
   * Get CSRF token from meta tag
   */
  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  var form = document.getElementById('configForm');
  var alertDiv = document.getElementById('configAlert');
  var alertText = document.getElementById('configAlertText');
  var saveBtn = document.getElementById('saveBtn');
  var saveBtnText = document.getElementById('saveBtnText');
  var saveBtnSpinner = document.getElementById('saveBtnSpinner');
  var cancelBtn = document.getElementById('cancelBtn');

  // AWS authentication method elements
  var authMethodSelect = document.getElementById('awsAuthMethod');
  var accessKeyFields = document.getElementById('accessKeyFields');
  var rolesAnywhereFields = document.getElementById('rolesAnywhereFields');

  // File upload elements
  var certFileUpload = document.getElementById('certFileUpload');
  var keyFileUpload = document.getElementById('keyFileUpload');

  // AWS Regions list (sorted by region code, us-east-1 first as most common default)
  var AWS_REGIONS = [
    'us-east-1',      // US East (N. Virginia)
    'us-east-2',      // US East (Ohio)
    'us-west-1',      // US West (N. California)
    'us-west-2',      // US West (Oregon)
    'af-south-1',     // Africa (Cape Town)
    'ap-east-1',      // Asia Pacific (Hong Kong)
    'ap-south-1',     // Asia Pacific (Mumbai)
    'ap-south-2',     // Asia Pacific (Hyderabad)
    'ap-southeast-1', // Asia Pacific (Singapore)
    'ap-southeast-2', // Asia Pacific (Sydney)
    'ap-southeast-3', // Asia Pacific (Jakarta)
    'ap-southeast-4', // Asia Pacific (Melbourne)
    'ap-southeast-5', // Asia Pacific (Malaysia)
    'ap-northeast-1', // Asia Pacific (Tokyo)
    'ap-northeast-2', // Asia Pacific (Seoul)
    'ap-northeast-3', // Asia Pacific (Osaka)
    'ca-central-1',   // Canada (Central)
    'ca-west-1',      // Canada West (Calgary)
    'eu-central-1',   // Europe (Frankfurt)
    'eu-central-2',   // Europe (Zurich)
    'eu-west-1',      // Europe (Ireland)
    'eu-west-2',      // Europe (London)
    'eu-west-3',      // Europe (Paris)
    'eu-south-1',     // Europe (Milan)
    'eu-south-2',     // Europe (Spain)
    'eu-north-1',     // Europe (Stockholm)
    'il-central-1',   // Israel (Tel Aviv)
    'me-south-1',     // Middle East (Bahrain)
    'me-central-1',   // Middle East (UAE)
    'sa-east-1',      // South America (São Paulo)
  ];

  // Active autocomplete state
  var activeAutocomplete = null;

  // ===========================================
  // Field Validators
  // ===========================================

  /**
   * Validation patterns for AWS ARNs
   */
  var VALIDATION_PATTERNS = {
    // arn:aws:iam::<account-id>:role/<role-name>
    roleArn: /^arn:aws:iam::\d{12}:role\/[\w+=,.@\-\/]+$/,

    // arn:aws:rolesanywhere:<region>:<account-id>:trust-anchor/<uuid>
    trustAnchorArn: /^arn:aws:rolesanywhere:[a-z]{2}-[a-z]+-\d:\d{12}:trust-anchor\/[a-f0-9\-]{36}$/,

    // arn:aws:rolesanywhere:<region>:<account-id>:profile/<uuid>
    profileArn: /^arn:aws:rolesanywhere:[a-z]{2}-[a-z]+-\d:\d{12}:profile\/[a-f0-9\-]{36}$/,

    // PEM certificate
    certificate: /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/,

    // PEM private key (supports PRIVATE KEY and RSA PRIVATE KEY)
    privateKey: /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----\s*$/,
  };

  /**
   * Validation error messages
   */
  var VALIDATION_MESSAGES = {
    roleArn: 'Invalid IAM Role ARN format. Expected: arn:aws:iam::<account-id>:role/<role-name>',
    trustAnchorArn: 'Invalid Trust Anchor ARN format. Expected: arn:aws:rolesanywhere:<region>:<account-id>:trust-anchor/<uuid>',
    profileArn: 'Invalid Profile ARN format. Expected: arn:aws:rolesanywhere:<region>:<account-id>:profile/<uuid>',
    certificate: 'Invalid certificate format. Must be PEM-encoded starting with -----BEGIN CERTIFICATE-----',
    privateKey: 'Invalid private key format. Must be PEM-encoded starting with -----BEGIN PRIVATE KEY-----',
  };

  /**
   * Validate a field value against its pattern
   * @param {string} fieldType - Type of field (roleArn, trustAnchorArn, etc.)
   * @param {string} value - Value to validate
   * @returns {Object} { valid: boolean, message: string }
   */
  function validateField(fieldType, value) {
    // Empty values are valid (optional fields or will be caught by required check)
    if (!value || value.trim() === '') {
      return { valid: true, message: '' };
    }

    var pattern = VALIDATION_PATTERNS[fieldType];
    if (!pattern) {
      return { valid: true, message: '' };
    }

    var isValid = pattern.test(value.trim());
    return {
      valid: isValid,
      message: isValid ? '' : VALIDATION_MESSAGES[fieldType],
    };
  }

  /**
   * Show inline validation error for a field
   * @param {HTMLElement} input - Input element
   * @param {string} message - Error message (empty to clear)
   */
  function showFieldError(input, message) {
    // Find or create error element
    var errorId = input.id + '-error';
    var errorEl = document.getElementById(errorId);

    if (!errorEl && message) {
      errorEl = document.createElement('div');
      errorEl.id = errorId;
      errorEl.className = 'config-field-error';

      // Insert after input or after autocomplete-wrapper/config-input-group
      var wrapper = input.closest('.autocomplete-wrapper') ||
                    input.closest('.config-input-group') ||
                    input.closest('.config-file-upload')?.previousElementSibling;
      if (wrapper) {
        wrapper.parentNode.insertBefore(errorEl, wrapper.nextSibling);
      } else {
        input.parentNode.insertBefore(errorEl, input.nextSibling);
      }
    }

    if (errorEl) {
      if (message) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        input.classList.add('config-input--error');
      } else {
        errorEl.style.display = 'none';
        input.classList.remove('config-input--error');
      }
    }
  }

  /**
   * Clear all field errors
   */
  function clearAllFieldErrors() {
    var errors = document.querySelectorAll('.config-field-error');
    errors.forEach(function(el) {
      el.style.display = 'none';
    });
    var inputs = document.querySelectorAll('.config-input--error');
    inputs.forEach(function(input) {
      input.classList.remove('config-input--error');
    });
  }

  /**
   * Validate all IAM Roles Anywhere fields
   * @returns {boolean} true if all fields are valid
   */
  function validateRolesAnywhereFields() {
    var isValid = true;
    var fieldsToValidate = [
      { id: 'awsRoleArn', type: 'roleArn' },
      { id: 'awsRolesAnywhereTrustAnchorArn', type: 'trustAnchorArn' },
      { id: 'awsRolesAnywhereProfileArn', type: 'profileArn' },
      { id: 'awsRolesAnywhereCertificate', type: 'certificate' },
      { id: 'awsRolesAnywherePrivateKey', type: 'privateKey' },
    ];

    fieldsToValidate.forEach(function(field) {
      var input = document.getElementById(field.id);
      if (input && !input.disabled) {
        var result = validateField(field.type, input.value);
        showFieldError(input, result.message);
        if (!result.valid) {
          isValid = false;
        }
      }
    });

    return isValid;
  }

  /**
   * Initialize field validation listeners
   */
  function initFieldValidation() {
    var fieldsToValidate = [
      { id: 'awsRoleArn', type: 'roleArn' },
      { id: 'awsRolesAnywhereTrustAnchorArn', type: 'trustAnchorArn' },
      { id: 'awsRolesAnywhereProfileArn', type: 'profileArn' },
      { id: 'awsRolesAnywhereCertificate', type: 'certificate' },
      { id: 'awsRolesAnywherePrivateKey', type: 'privateKey' },
    ];

    fieldsToValidate.forEach(function(field) {
      var input = document.getElementById(field.id);
      if (input) {
        // Validate on blur
        input.addEventListener('blur', function() {
          var result = validateField(field.type, input.value);
          showFieldError(input, result.message);
        });

        // Clear error on focus (to allow editing)
        input.addEventListener('focus', function() {
          showFieldError(input, '');
        });
      }
    });
  }

  function showAlert(message, type) {
    if (alertText) {
      alertText.textContent = message;
    }
    if (alertDiv) {
      alertDiv.className = 'config-alert config-alert--' + type;
      alertDiv.style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (type === 'success') {
        setTimeout(hideAlert, 5000);
      }
    }
  }

  function hideAlert() {
    if (alertDiv) {
      alertDiv.style.display = 'none';
    }
  }

  function setLoading(loading) {
    if (saveBtn) saveBtn.disabled = loading;
    if (saveBtnText) saveBtnText.textContent = loading ? 'Saving...' : 'Save Changes';
    if (saveBtnSpinner) saveBtnSpinner.style.display = loading ? 'inline' : 'none';
  }

  function updateAuthMethodVisibility() {
    if (!authMethodSelect || !accessKeyFields || !rolesAnywhereFields) return;

    var method = authMethodSelect.value;

    if (method === 'rolesAnywhere') {
      accessKeyFields.style.display = 'none';
      rolesAnywhereFields.style.display = 'block';
      // Disable access key fields so they're not submitted
      disableFieldsIn(accessKeyFields);
      enableFieldsIn(rolesAnywhereFields);
    } else {
      accessKeyFields.style.display = 'block';
      rolesAnywhereFields.style.display = 'none';
      // Disable roles anywhere fields so they're not submitted
      enableFieldsIn(accessKeyFields);
      disableFieldsIn(rolesAnywhereFields);
    }
  }

  function disableFieldsIn(container) {
    var inputs = container.querySelectorAll('input[name], textarea[name]');
    inputs.forEach(function(input) {
      input.disabled = true;
    });
  }

  function enableFieldsIn(container) {
    var inputs = container.querySelectorAll('input[name], textarea[name]');
    inputs.forEach(function(input) {
      input.disabled = false;
    });
  }

  function collectFormData() {
    var data = {};
    var inputs = form.querySelectorAll('input[name], textarea[name], select[name]');

    inputs.forEach(function(input) {
      // Skip disabled, readonly, and empty fields (except auth method selector)
      if (input.disabled || input.readOnly) return;

      // Always include auth method selector so backend knows which credentials to delete
      if (input.name === 'aws.authMethod') {
        data[input.name] = input.value;
        return;
      }

      if (input.value && input.value.trim() !== '') {
        data[input.name] = input.value.trim();
      }
    });

    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    hideAlert();
    clearAllFieldErrors();

    var data = collectFormData();

    if (Object.keys(data).length === 0) {
      showAlert('No changes to save.', 'error');
      return;
    }

    // Validate IAM Roles Anywhere fields if that auth method is selected
    if (authMethodSelect && authMethodSelect.value === 'rolesAnywhere') {
      if (!validateRolesAnywhereFields()) {
        showAlert('Please fix the validation errors before saving.', 'error');
        return;
      }
    }

    setLoading(true);

    try {
      var response = await fetch('/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(data)
      });

      var result = await response.json();

      if (response.ok && result.success) {
        showAlert('Configuration saved successfully!', 'success');
        setTimeout(function() { window.location.reload(); }, 1500);
      } else {
        showAlert(result.error || 'Failed to save configuration', 'error');
        setLoading(false);
      }
    } catch (error) {
      showAlert('Network error. Please try again.', 'error');
      setLoading(false);
    }
  }

  function handleCancel() {
    window.location.href = '/';
  }

  function handleRevealToggle(event) {
    event.preventDefault();
    event.stopPropagation();

    var btn = event.currentTarget;
    var targetId = btn.getAttribute('data-target');
    var input = document.getElementById(targetId);

    if (input) {
      // Handle textarea (uses CSS class for masking)
      if (input.tagName === 'TEXTAREA') {
        var isHidden = input.classList.contains('config-textarea--secret') && !input.classList.contains('is-revealed');
        if (isHidden) {
          input.classList.add('is-revealed');
          btn.classList.add('is-revealed');
        } else {
          input.classList.remove('is-revealed');
          btn.classList.remove('is-revealed');
        }
      } else {
        // Handle regular input (uses type attribute)
        var isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        if (isPassword) {
          btn.classList.add('is-revealed');
        } else {
          btn.classList.remove('is-revealed');
        }
      }
    }
  }

  function handleSubsectionToggle(event) {
    var btn = event.currentTarget;
    var contentId = btn.getAttribute('data-target') || btn.id.replace('Toggle', 'Content');
    var content = document.getElementById(contentId);

    if (content) {
      var isExpanded = btn.classList.contains('is-expanded');
      if (isExpanded) {
        btn.classList.remove('is-expanded');
        content.style.display = 'none';
      } else {
        btn.classList.add('is-expanded');
        content.style.display = 'block';
      }
    }
  }

  function parseCertificateDetails(pemCert) {
    if (!pemCert || !window.X509) return null;

    try {
      // Create X509 object and read PEM
      var x509 = new X509();
      x509.readCertPEM(pemCert);

      // Extract CN from subject
      var subject = x509.getSubjectString();
      if (!subject) return { error: true };

      var cnMatch = subject.match(/\/CN=([^\/]+)/);
      var cn = cnMatch ? cnMatch[1] : 'Unknown';

      // Get validity dates (format: YYMMDDhhmmssZ or YYYYMMDDhhmmssZ)
      var notBefore = x509.getNotBefore();
      var notAfter = x509.getNotAfter();

      if (!notBefore || !notAfter) return { error: true };

      // Parse dates - handle both 2-digit and 4-digit year formats
      function parseASN1Date(dateStr) {
        if (!dateStr || dateStr.length < 6) return null;

        var year, month, day;
        if (dateStr.length === 13) {
          // YYMMDDhhmmssZ format
          year = '20' + dateStr.substr(0, 2);
          month = dateStr.substr(2, 2);
          day = dateStr.substr(4, 2);
        } else {
          // YYYYMMDDhhmmssZ format
          year = dateStr.substr(0, 4);
          month = dateStr.substr(4, 2);
          day = dateStr.substr(6, 2);
        }
        return new Date(year + '-' + month + '-' + day);
      }

      var validFrom = parseASN1Date(notBefore);
      var validTo = parseASN1Date(notAfter);

      if (!validFrom || !validTo) return { error: true };

      // Calculate days until expiry
      var now = new Date();
      var daysUntilExpiry = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24));

      // Determine status
      var status = 'valid';
      if (now > validTo) {
        status = 'expired';
      } else if (daysUntilExpiry <= 30) {
        status = 'expiring-soon';
      }

      return {
        cn: cn,
        validFrom: validFrom.toISOString().split('T')[0],
        validTo: validTo.toISOString().split('T')[0],
        daysUntilExpiry: daysUntilExpiry,
        status: status
      };
    } catch (error) {
      console.error('Failed to parse certificate:', error);
      return { error: true };
    }
  }

  function updateCertificateInfoDisplay(details) {
    var displayDiv = document.getElementById('certificateInfoDisplay');
    if (!displayDiv) return;

    if (!details) {
      displayDiv.innerHTML = '<span class="config-hint">Enter or upload a valid certificate to see details</span>';
      return;
    }

    // Handle parsing error
    if (details.error) {
      displayDiv.innerHTML = [
        '<div class="config-cert-info config-cert-info--error">',
        '  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">',
        '    <circle cx="12" cy="12" r="10"></circle>',
        '    <line x1="12" y1="8" x2="12" y2="12"></line>',
        '    <line x1="12" y1="16" x2="12.01" y2="16"></line>',
        '  </svg>',
        '  <span style="color: #991b1b; font-weight: 500;">Invalid certificate</span>',
        '</div>'
      ].join('\n');
      return;
    }

    var badgeHtml = '';
    if (details.status === 'expired') {
      badgeHtml = '<span class="config-cert-badge config-cert-badge--expired">Expired</span>';
    } else if (details.status === 'expiring-soon') {
      badgeHtml = '<span class="config-cert-badge config-cert-badge--warning">' + details.daysUntilExpiry + ' days left</span>';
    } else {
      badgeHtml = '<span class="config-cert-badge config-cert-badge--valid">' + details.daysUntilExpiry + ' days left</span>';
    }

    displayDiv.innerHTML = [
      '<div class="config-cert-info config-cert-info--' + details.status + '">',
      '  <span class="config-cert-info__cn">CN: <strong>' + details.cn + '</strong></span>',
      '  <span class="config-cert-info__expiry">',
      '    Expires: ' + details.validTo,
      '    ' + badgeHtml,
      '  </span>',
      '</div>'
    ].join('\n');
  }

  function handleCertificateChange() {
    var textarea = document.getElementById('awsRolesAnywhereCertificate');
    if (!textarea) return;

    var pemContent = textarea.value.trim();
    if (!pemContent) {
      updateCertificateInfoDisplay(null);
      return;
    }

    var details = parseCertificateDetails(pemContent);
    updateCertificateInfoDisplay(details);
  }

  function handleFileUpload(event, targetTextareaId) {
    var file = event.target.files[0];
    if (!file) return;

    var fileInput = event.target;
    var reader = new FileReader();
    reader.onload = function(e) {
      var content = e.target.result;
      var textarea = document.getElementById(targetTextareaId);
      if (textarea) {
        textarea.value = content;

        // If this is the certificate textarea, update the display
        if (targetTextareaId === 'awsRolesAnywhereCertificate') {
          handleCertificateChange();
          // Validate and update error message
          var result = validateField('certificate', content);
          showFieldError(textarea, result.message);
        }

        // If this is the private key textarea, validate it
        if (targetTextareaId === 'awsRolesAnywherePrivateKey') {
          var result = validateField('privateKey', content);
          showFieldError(textarea, result.message);
        }
      }

      // Reset file input so the same file can be uploaded again
      fileInput.value = '';
    };
    reader.onerror = function() {
      showAlert('Failed to read file. Please try again.', 'error');
      // Reset file input on error too
      fileInput.value = '';
    };
    reader.readAsText(file);
  }

  /**
   * Initialize AWS region autocomplete
   */
  function initRegionAutocomplete() {
    var input = document.getElementById('awsRegion');
    var dropdown = document.getElementById('awsRegion-dropdown');

    if (!input || !dropdown) return;

    // Show dropdown on focus
    input.addEventListener('focus', function() {
      showRegionAutocomplete(input, dropdown);
    });

    // Filter on input
    input.addEventListener('input', function() {
      showRegionAutocomplete(input, dropdown);
    });

    // Keyboard navigation
    input.addEventListener('keydown', function(e) {
      handleAutocompleteKeydown(e, input, dropdown);
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.autocomplete-wrapper')) {
        hideAutocomplete(dropdown);
      }
    });
  }

  /**
   * Show region autocomplete dropdown with filtered results
   */
  function showRegionAutocomplete(input, dropdown) {
    var query = input.value.toLowerCase().trim();

    // Filter regions
    var filtered = AWS_REGIONS.filter(function(region) {
      return region.toLowerCase().includes(query);
    });

    // Build dropdown HTML
    var html = '';

    if (query === '' && AWS_REGIONS.length > 10) {
      html += '<div class="autocomplete-hint">Type to filter regions</div>';
    }

    if (filtered.length === 0) {
      html += '<div class="autocomplete-empty">No matching regions</div>';
    } else {
      filtered.forEach(function(region, index) {
        var isSelected = region === input.value;
        html += '<div class="autocomplete-item' + (isSelected ? ' selected' : '') + '" data-value="' + region + '" data-index="' + index + '">' + region + '</div>';
      });
    }

    dropdown.innerHTML = html;
    dropdown.classList.add('active');
    activeAutocomplete = dropdown;

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
  }

  /**
   * Handle keyboard navigation in autocomplete
   */
  function handleAutocompleteKeydown(e, input, dropdown) {
    var items = dropdown.querySelectorAll('.autocomplete-item');

    if (!dropdown.classList.contains('active') || items.length === 0) {
      return;
    }

    var highlightedItem = dropdown.querySelector('.autocomplete-item.highlighted');
    var highlightedIndex = highlightedItem ? parseInt(highlightedItem.dataset.index, 10) : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (highlightedIndex < items.length - 1) {
          if (highlightedItem) highlightedItem.classList.remove('highlighted');
          items[highlightedIndex + 1].classList.add('highlighted');
          items[highlightedIndex + 1].scrollIntoView({ block: 'nearest' });
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (highlightedIndex > 0) {
          if (highlightedItem) highlightedItem.classList.remove('highlighted');
          items[highlightedIndex - 1].classList.add('highlighted');
          items[highlightedIndex - 1].scrollIntoView({ block: 'nearest' });
        }
        break;

      case 'Enter':
        if (highlightedItem) {
          e.preventDefault();
          selectAutocompleteItem(input, dropdown, highlightedItem.dataset.value);
        }
        break;

      case 'Escape':
        hideAutocomplete(dropdown);
        break;

      case 'Tab':
        hideAutocomplete(dropdown);
        break;
    }
  }

  /**
   * Select an item from autocomplete
   */
  function selectAutocompleteItem(input, dropdown, value) {
    input.value = value;
    hideAutocomplete(dropdown);
    input.focus();
  }

  function init() {
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', handleCancel);
    }

    // Auth method selector
    if (authMethodSelect) {
      authMethodSelect.addEventListener('change', updateAuthMethodVisibility);
      // Initialize visibility on load
      updateAuthMethodVisibility();
    }

    // File upload handlers
    if (certFileUpload) {
      certFileUpload.addEventListener('change', function(e) {
        handleFileUpload(e, 'awsRolesAnywhereCertificate');
      });
    }

    if (keyFileUpload) {
      keyFileUpload.addEventListener('change', function(e) {
        handleFileUpload(e, 'awsRolesAnywherePrivateKey');
      });
    }

    // Certificate textarea change handler (parse on input/paste)
    var certTextarea = document.getElementById('awsRolesAnywhereCertificate');
    if (certTextarea) {
      // Debounce the parsing to avoid excessive calls while typing
      var parseTimeout;
      certTextarea.addEventListener('input', function() {
        clearTimeout(parseTimeout);
        parseTimeout = setTimeout(handleCertificateChange, 500);
      });
    }

    // Reveal buttons
    var revealBtns = document.querySelectorAll('.config-reveal-btn');
    revealBtns.forEach(function(btn) {
      btn.addEventListener('click', handleRevealToggle);
    });

    // Subsection toggle buttons
    var toggleBtns = document.querySelectorAll('.config-subsection__toggle');
    toggleBtns.forEach(function(btn) {
      btn.addEventListener('click', handleSubsectionToggle);
    });

    // Initialize AWS region autocomplete
    initRegionAutocomplete();

    // Initialize field validation for IAM Roles Anywhere fields
    initFieldValidation();

    // Clear password/secret fields on load
    [
      'awsSecretAccessKey',
      'opaApiSecret',
      'awsRolesAnywhereCertificate',
      'awsRolesAnywherePrivateKey'
    ].forEach(function(id) {
      var input = document.getElementById(id);
      if (input) input.value = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
