// Input validation & sanitasi

// Helper: validate string (required, min/max length)
function validateString(value, { required = true, minLength = 1, maxLength = 1000, name = 'field' } = {}) {
  if (required && (!value || value.trim() === '')) {
    return { valid: false, error: `${name} wajib diisi` };
  }
  
  if (value && value.length < minLength) {
    return { valid: false, error: `${name} minimal ${minLength} karakter` };
  }
  
  if (value && value.length > maxLength) {
    return { valid: false, error: `${name} maksimal ${maxLength} karakter` };
  }
  
  return { valid: true };
}

// Helper: validate number
function validateNumber(value, { required = true, min, max, name = 'field' } = {}) {
  if (required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `${name} wajib diisi` };
  }
  
  const num = Number(value);
  if (isNaN(num)) {
    return { valid: false, error: `${name} harus berupa angka` };
  }
  
  if (min !== undefined && num < min) {
    return { valid: false, error: `${name} minimal ${min}` };
  }
  
  if (max !== undefined && num > max) {
    return { valid: false, error: `${name} maksimal ${max}` };
  }
  
  return { valid: true };
}

// Helper: sanitize string (remove dangerous characters)
function sanitizeString(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/[<>]/g, '') // remove < dan >
    .substring(0, 1000); // limit length
}

// Helper: validate regex pattern
function validateRegex(pattern, { name = 'pattern' } = {}) {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `${name} bukan regex valid: ${err.message}` };
  }
}

// Middleware: validate request body
function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      if (rules.type === 'string') {
        const result = validateString(value, { ...rules, name: field });
        if (!result.valid) errors.push(result.error);
      } else if (rules.type === 'number') {
        const result = validateNumber(value, { ...rules, name: field });
        if (!result.valid) errors.push(result.error);
      } else if (rules.type === 'regex') {
        const result = validateRegex(value, { name: field });
        if (!result.valid) errors.push(result.error);
      }
      
      // Sanitize string fields
      if (rules.type === 'string' && value) {
        req.body[field] = sanitizeString(value);
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).send({ error: 'Validasi gagal', details: errors });
    }
    
    next();
  };
}

module.exports = { 
  validateString, 
  validateNumber, 
  validateRegex, 
  sanitizeString, 
  validateBody 
};
