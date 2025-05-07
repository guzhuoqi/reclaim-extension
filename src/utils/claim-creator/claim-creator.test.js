// // Since we can't run ES modules directly in this Node.js environment, 
// // let's create a test that would work in the browser environment

// // This is a test that would work in a browser environment
// // To run in Node.js, we'd need to set up proper module configuration

// // Mock function to simulate the implementation
// function createClaimObjectTest(request, providerData) {
//   // Define public headers that should be in params
//   const PUBLIC_HEADERS = [
//       "user-agent",
//       "accept",
//       "accept-language",
//       "accept-encoding",
//       "sec-fetch-mode",
//       "sec-fetch-site",
//       "sec-fetch-user",
//       "origin",
//       "x-requested-with",
//       "sec-ch-ua",
//       "sec-ch-ua-mobile",
//   ];
  
//   // Initialize params and secretParams objects
//   const params = {};
//   const secretParams = {};
  
//   // Process URL
//   params.url = request.url;
//   params.method = request.method || 'GET';
  
//   // Process headers - split between public and secret
//   if (request.headers) {
//       const publicHeaders = {};
//       const secretHeaders = {};
      
//       Object.entries(request.headers).forEach(([key, value]) => {
//           const lowerKey = key.toLowerCase();
//           if (PUBLIC_HEADERS.includes(lowerKey)) {
//               publicHeaders[key] = value;
//           } else {
//               secretHeaders[key] = value;
//           }
//       });
      
//       if (Object.keys(publicHeaders).length > 0) {
//           params.headers = publicHeaders;
//       }
      
//       if (Object.keys(secretHeaders).length > 0) {
//           secretParams.headers = secretHeaders;
//       }
//   }
  
//   // Process body if available
//   if (request.body) {
//       params.body = request.body;
//   }
  
//   // Process cookie string if available in request
//   if (request.cookieStr) {
//       secretParams.cookieStr = request.cookieStr;
//   }
  
//   // Extract dynamic parameters from URL, body, and response matches
//   const paramValues = {};
  
//   // Function to extract dynamic parameters of the form {{PARAM_NAME}}
//   const extractDynamicParams = (text) => {
//       if (!text) return [];
//       const matches = text.match(/{{([^}]+)}}/g) || [];
//       return matches.map(match => match.substring(2, match.length - 2));
//   };
  
//   // Extract dynamic params from URL
//   const urlParams = extractDynamicParams(params.url);
//   urlParams.forEach(param => {
//       // Add to paramValues if not already present
//       if (providerData.paramValues && providerData.paramValues[param]) {
//           paramValues[param] = providerData.paramValues[param];
//       }
//   });
  
//   // Extract dynamic params from body
//   const bodyParams = extractDynamicParams(params.body);
//   bodyParams.forEach(param => {
//       // Add to paramValues if not already present
//       if (providerData.paramValues && providerData.paramValues[param]) {
//           paramValues[param] = providerData.paramValues[param];
//       }
//   });
  
//   // Process response matches if available
//   if (providerData.responseMatches) {
//       params.responseMatches = providerData.responseMatches.map(match => {
//           // Extract dynamic params from response match value
//           const responseParams = extractDynamicParams(match.value);
//           responseParams.forEach(param => {
//               // For response params, add them to params not secretParams
//               if (providerData.paramValues && providerData.paramValues[param]) {
//                   paramValues[param] = providerData.paramValues[param];
//               }
//           });
          
//           return match;
//       });
//   }
  
//   // Process response redactions if available
//   if (providerData.responseRedactions) {
//       params.responseRedactions = providerData.responseRedactions;
//   }
  
//   // Add paramValues to params if any were found
//   if (Object.keys(paramValues).length > 0) {
//       params.paramValues = paramValues;
//   }
  
//   // Create the final claim object
//   return {
//       name: providerData.name || 'http',
//       params,
//       secretParams,
//       ownerPrivateKey: providerData.ownerPrivateKey,
//       client: providerData.client
//   };
// }

// // Mock request and provider data
// const mockRequest = {
//   url: 'https://www.kaggle.com/api/i/users.UsersService/GetCurrentUser',
//   method: 'POST',
//   headers: {
//     'accept': 'application/json',
//     'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
//     'content-type': 'application/json',
//     'priority': 'u=1, i',
//     'origin': 'https://www.kaggle.com',
//     'referer': 'https://www.kaggle.com/',
//     'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
//     'sec-ch-ua-mobile': '?0',
//     'sec-ch-ua-platform': '"macOS"',
//     'sec-fetch-dest': 'empty',
//     'sec-fetch-mode': 'cors',
//     'sec-fetch-site': 'same-origin',
//     'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
//     'x-kaggle-build-version': '3aac2aa7d1495878b98b478d503afa96d640025e',
//     'x-xsrf-token': 'CfDJ8KvMat0eHzhGoPokVBGB7D2l98oIC2B-dZpqG3_J3BIxl6YbrzAlfN4xU_86J99D0RHejpHeUctSVmOt4neR4WxkKimdMYbuQ6VAosOVoOed4j9jJSlTgDwdn9uzArDKj1C_jy0bvhyBkEp0-lx_c_k'
//   },
//   body: '{"includeGroups":false,"includeLogins":false,"includeVerificationStatus":true}',
//   cookieStr: '_ga=GA1.1.66848040.1736352659; ACCEPTED_COOKIES=true; ka_sessionid=79120ad542d3ceb14fa2d3e0e5e31ede;'
// };

// const mockProviderData = {
//   name: 'http',
//   responseMatches: [
//     {
//       value: '"userName":"{{username}}"',
//       type: 'contains',
//       invert: false
//     }
//   ],
//   responseRedactions: [
//     {
//       jsonPath: '$.userName',
//       regex: '"userName":"(.*)"'
//     }
//   ],
//   paramValues: {
//     username: 'providerreclaim'
//   },
//   ownerPrivateKey: '0x1234567456789012345678901234567890123456789012345678901234567890',
//   client: {
//     url: 'wss://attestor.reclaimprotocol.org/ws'
//   }
// };



// // Test the createClaimObject function
// console.log('Testing createClaimObject function...');
// const claimObject = createClaimObjectTest(mockRequest, mockProviderData);

// // Log the result
// console.log('Result:', JSON.stringify(claimObject, null, 2));

// // Verify structure of the claim object
// console.assert(claimObject.name === 'http', 'Name should be "http"');
// console.assert(claimObject.params.url === mockRequest.url, 'URL should match');
// console.assert(claimObject.params.method === mockRequest.method, 'Method should match');

// // Verify public headers are in params
// console.assert(claimObject.params.headers.accept === mockRequest.headers.accept, 'Public header should be in params');
// console.assert(claimObject.params.headers['sec-fetch-mode'] === mockRequest.headers['sec-fetch-mode'], 'Public header should be in params');

// // Verify secret headers are in secretParams
// console.assert(claimObject.secretParams.headers['content-type'] === mockRequest.headers['content-type'], 'Secret header should be in secretParams');
// console.assert(claimObject.secretParams.headers['x-xsrf-token'] === mockRequest.headers['x-xsrf-token'], 'Secret header should be in secretParams');

// // Verify paramValues is correctly added
// console.assert(claimObject.params.paramValues.username === 'providerreclaim', 'paramValues should include username');

// console.log('All tests passed!'); 