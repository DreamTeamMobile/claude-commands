#!/usr/bin/env tsx

/**
 * Test script for MCP validation
 */

// Test patterns
const testPatterns = [
  // Valid MCP patterns
  { pattern: 'mcp__playwright', expected: true, description: 'Valid MCP server pattern' },
  { pattern: 'mcp__context7', expected: true, description: 'Valid MCP server pattern' },
  { pattern: 'mcp__playwright__navigate', expected: true, description: 'Valid MCP command pattern' },

  // Invalid MCP patterns
  { pattern: 'mcp__playwright:*', expected: false, description: 'Invalid - MCP with wildcard suffix' },
  { pattern: 'mcp__playwright__*', expected: false, description: 'Invalid - MCP with wildcard' },
  { pattern: 'mcp__*', expected: false, description: 'Invalid - too broad' },
  { pattern: 'mcp__:*', expected: false, description: 'Invalid - too broad with colon' },

  // Non-MCP patterns (should pass)
  { pattern: 'Bash(npm run:*)', expected: true, description: 'Valid Bash pattern' },
  { pattern: 'WebFetch(domain:github.com)', expected: true, description: 'Valid WebFetch pattern' },
];

console.log('🧪 Testing MCP Validation\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Inline validation function (copied from grouping-agent.ts)
function validateMCPGrouping(pattern: string): { valid: boolean; reason?: string } {
  // Only validate MCP patterns
  if (!pattern.startsWith('mcp__')) {
    return { valid: true };
  }

  // Check 1: MCP patterns must not have wildcards
  if (pattern.includes('*')) {
    return {
      valid: false,
      reason: 'MCP patterns cannot use wildcards. Use exact pattern like "mcp__servername"'
    };
  }

  // Check 2: Block mcp__* (too broad)
  if (pattern === 'mcp__*' || pattern === 'mcp__:*') {
    return {
      valid: false,
      reason: 'mcp__* is too broad - must specify server name'
    };
  }

  // Check 3: Validate MCP pattern format
  // Valid formats: mcp__servername OR mcp__servername__commandname
  const mcpServerPattern = /^mcp__[a-zA-Z0-9-_]+$/;
  const mcpCommandPattern = /^mcp__[a-zA-Z0-9-_]+__[a-zA-Z0-9-_]+$/;

  if (!mcpServerPattern.test(pattern) && !mcpCommandPattern.test(pattern)) {
    return {
      valid: false,
      reason: `Invalid MCP pattern format. Expected "mcp__servername" or "mcp__servername__commandname", got "${pattern}"`
    };
  }

  return { valid: true };
}

let passed = 0;
let failed = 0;

for (const test of testPatterns) {
  const result = validateMCPGrouping(test.pattern);
  const success = result.valid === test.expected;

  if (success) {
    console.log(`✅ PASS: ${test.description}`);
    console.log(`   Pattern: "${test.pattern}"`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${test.description}`);
    console.log(`   Pattern: "${test.pattern}"`);
    console.log(`   Expected: ${test.expected ? 'valid' : 'invalid'}`);
    console.log(`   Got: ${result.valid ? 'valid' : 'invalid'}`);
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
    failed++;
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('🎉 All tests passed!\n');
  process.exit(0);
} else {
  console.log('💥 Some tests failed!\n');
  process.exit(1);
}
