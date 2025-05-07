/**
 * Mock implementation of snarkjs for browser extension environment
 * This provides just enough functionality to prevent the attestor-core 
 * library from throwing errors while still letting it proceed with its operations
 */

// Get the global object in a cross-environment way
const getGlobalObject = () => {
  if (typeof window !== 'undefined') return window;
  if (typeof self !== 'undefined') return self;
  if (typeof global !== 'undefined') return global;
  return Function('return this')();
};

const globalObj = getGlobalObject();

// Create a global CircuitClass that can be referenced directly
class MockCircuit {
  constructor() {
    this.initialized = true;
  }

  getWtnsCalculator() {
    console.log('[SNARKJS-MOCK] Getting witness calculator');
    return {
      calculateWTNS: async (input) => {
        console.log('[SNARKJS-MOCK] Calculating witness (mock)');
        return new Uint8Array(128);
      },
      calculateBinWTNS: async (input) => {
        console.log('[SNARKJS-MOCK] Calculating binary witness (mock)');
        return new Uint8Array(128);
      }
    };
  }
}

// Make sure MockCircuit is globally available
globalObj.MockCircuit = MockCircuit;

const snarkjs = {
  wtns: {
    calculate: async () => {
      console.log('[SNARKJS-MOCK] Calculating witness');
      return new Uint8Array(128);
    }
  },
  groth16: {
    prove: async () => {
      console.log('[SNARKJS-MOCK] Generating proof');
      return {
        proof: {
          pi_a: [1, 2, 3],
          pi_b: [[1, 2], [3, 4]],
          pi_c: [5, 6, 7]
        },
        publicSignals: [8, 9, 10]
      };
    },
    verify: async () => {
      console.log('[SNARKJS-MOCK] Verifying proof');
      return true;
    }
  },
  plonk: {
    prove: async () => {
      console.log('[SNARKJS-MOCK] Generating plonk proof');
      return {
        proof: "mockProof",
        publicSignals: [1, 2, 3]
      };
    },
    verify: async () => {
      console.log('[SNARKJS-MOCK] Verifying plonk proof');
      return true;
    }
  },
  r1cs: {
    info: async () => {
      console.log('[SNARKJS-MOCK] Getting r1cs info');
      return { 
        nVars: 10, 
        nConstraints: 5,
        constraintsPer: { 
          add: 2, 
          mul: 3 
        }
      };
    }
  },
  zKey: {
    exportVerificationKey: async () => {
      console.log('[SNARKJS-MOCK] Exporting verification key');
      return {
        vk_alpha_1: [1, 2, 3],
        vk_beta_2: [[1, 2], [3, 4]],
        vk_gamma_2: [[5, 6], [7, 8]],
        vk_delta_2: [[9, 10], [11, 12]],
        vk_alphabeta_12: [[[13, 14], [15, 16]], [[17, 18], [19, 20]]],
        IC: [[21, 22, 23], [24, 25, 26]]
      };
    }
  },
  // Helper function to create a mock circuit with direct instance return
  circuit: () => {
    console.log('[SNARKJS-MOCK] Creating circuit');
    return new MockCircuit();
  }
};

// Make sure the snarkjs object is globally available
globalObj.snarkjs = snarkjs;

// For CommonJS and ESM compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = snarkjs;
}

export default snarkjs; 