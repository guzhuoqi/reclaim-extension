// Escape special regex characters in string
function escapeSpecialCharacters(input) {
  return input.replace(/[[\]()*+?.,\\^$|#]/g, '\\$&');
}

// Extract template variables from a string
function getTemplateVariables(template) {
  const paramRegex = /{{(\w+)}}/g;
  const variables = [];
  let match;

  while ((match = paramRegex.exec(template)) !== null) {
    variables.push(match[1]);
  }

  return variables;
}

// Convert template to regex, substituting known parameters
export function convertTemplateToRegex(template, parameters = {}) {
  // Escape special regex characters
  let escapedTemplate = escapeSpecialCharacters(template);

  // Find all template variables
  const allVars = getTemplateVariables(template);
  const unsubstitutedVars = [];

  // Replace template variables with actual values or regex patterns
  for (const param of allVars) {
    if (parameters[param]) {
      // Substitute known parameter
      escapedTemplate = escapedTemplate.replace(`{{${param}}}`, parameters[param]);
    } else {
      // Track unsubstituted variables
      unsubstitutedVars.push(param);
      // Use appropriate regex pattern based on variable name
      const replacement = param.endsWith('GRD') ? '(.*)' : '(.*?)';
      escapedTemplate = escapedTemplate.replace(`{{${param}}}`, replacement);
    }
  }

  return {
    pattern: escapedTemplate,
    allVars,
    unsubstitutedVars
  };
}

// Function to check if a request matches filtering criteria
function matchesRequestCriteria(request, filterCriteria, parameters = {}) {
  // Check URL match

  // For exact match
  if (filterCriteria.url === request.url) {
    return true;
  }

  // For regex match
  if (filterCriteria.urlType === 'REGEX') {
    const urlRegex = new RegExp(convertTemplateToRegex(filterCriteria.url, parameters).pattern);
    if (!urlRegex.test(request.url)) {
      return false;
    }
  }

  // For template match
  if (filterCriteria.urlType === 'TEMPLATE') {
    const urlTemplate = new RegExp(convertTemplateToRegex(filterCriteria.url, parameters).pattern);
    if (!urlTemplate.test(request.url)) {
      return false;
    }
  }

  // Check method match
  if (request.method !== filterCriteria.method) {
    return false;
  }

  // Check body match if enabled
  if (filterCriteria.bodySniff && filterCriteria.bodySniff.enabled) {
    const bodyTemplate = filterCriteria.bodySniff.template;
    const requestBody = typeof request.body === 'string' ?
      request.body : JSON.stringify(request.body);

    // For exact match
    if (bodyTemplate === requestBody) {
      return true;
    }

    // For template match
    const bodyRegex = new RegExp(convertTemplateToRegex(bodyTemplate, parameters).pattern);
    if (!bodyRegex.test(requestBody)) {
      return false;
    }
  }

  // If we get here, all criteria matched
  return true;
}

// Function to check if response matches criteria
function matchesResponseCriteria(responseText, matchCriteria, parameters = {}) {
  if (!matchCriteria || matchCriteria.length === 0) {
    return true;
  }

  for (const match of matchCriteria) {
    const { pattern } = convertTemplateToRegex(match.value, parameters);
    const regex = new RegExp(pattern);
    const matches = regex.test(responseText);

    // Check if match expectation is met
    const matchExpectation = match.invert ? !matches : matches;
    if (!matchExpectation) {
      return false;
    }
  }

  return true;
}

// Main filtering function
export const filterRequest = (request, filterCriteria, parameters = {}) => {
  try {
    // First check if request matches criteria
    if (!matchesRequestCriteria(request, filterCriteria, parameters)) {
      return false;
    }

    // // Then check if response matches (if we have response data)
    // if (request.responseText && filterCriteria.responseMatches) {
    //   return matchesResponseCriteria(request.responseText, filterCriteria.responseMatches, parameters);
    // }

    return true;
  } catch (error) {
    console.error('Error filtering request:', error);
    return false;
  }
};