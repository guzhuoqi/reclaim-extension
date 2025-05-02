// utils/proof-generator.js

import * as snarkjs from 'snarkjs';

export class ProofGenerator {
  constructor() {
    this.wasmFile = null;
    this.zkeyFile = null;
    
    // Load necessary circuit files
    this.loadCircuits();
  }
  
  async loadCircuits() {
    try {
      // Load the WebAssembly and zkey files for the circuits
      // These would typically be fetched from your server or included in the extension package
      const wasmResponse = await fetch(chrome.runtime.getURL('lib/circuits/circuit.wasm'));
      const zkeyResponse = await fetch(chrome.runtime.getURL('lib/circuits/circuit.zkey'));
      
      this.wasmFile = await wasmResponse.arrayBuffer();
      this.zkeyFile = await zkeyResponse.arrayBuffer();
      
      console.log('Circuit files loaded successfully');
    } catch (error) {
      console.error('Error loading circuit files:', error);
    }
  }
  
  async generateProof(requestData) {
    try {
      if (!this.wasmFile || !this.zkeyFile) {
        await this.loadCircuits();
      }
      
      // Prepare the input for the circuit
      const input = this.prepareInput(requestData);
      
      // Generate the proof using snarkjs
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input, 
        this.wasmFile,
        this.zkeyFile
      );
      
      // Format the proof for verification
      const formattedProof = this.formatProof(proof, publicSignals, requestData);
      
      return formattedProof;
    } catch (error) {
      console.error('Error generating ZK proof:', error);
      throw error;
    }
  }
  
  prepareInput(requestData) {
    // Extract and format the necessary fields from requestData
    // The exact structure depends on your circuit's expected input format
    const input = {
      data: [],
      timestamp: Math.floor(requestData.timestamp / 1000)
    };
    
    // Convert extracted fields to the format expected by the circuit
    for (const [key, value] of Object.entries(requestData.extractedFields)) {
      if (typeof value === 'string') {
        // Convert string to array of field elements (depends on circuit)
        const bytes = new TextEncoder().encode(value);
        input.data.push(Array.from(bytes));
      } else if (typeof value === 'number') {
        input.data.push(value);
      }
    }
    
    return input;
  }
  
  formatProof(proof, publicSignals, requestData) {
    // Format the proof to match the structure expected by the Reclaim SDK
    return {
      proof: {
        a: proof.a,
        b: proof.b,
        c: proof.c
      },
      publicSignals,
      metadata: {
        source: requestData.url,
        timestamp: requestData.timestamp,
        fields: requestData.extractedFields
      }
    };
  }
}