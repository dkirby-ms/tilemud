#!/usr/bin/env node
/**
 * Bundle Check Script
 * 
 * CI-friendly script that validates bundle size against budget limits.
 * Exits with error code if budget is exceeded, suitable for CI pipelines.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '../dist');

// Budget limits (in bytes)
const BUDGET_LIMITS = {
  javascript: 150 * 1024, // 150KB for JS
  css: 50 * 1024,         // 50KB for CSS  
  total: 200 * 1024       // 200KB total
};

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Get gzipped file size
 */
function getGzippedSize(filePath) {
  try {
    const content = readFileSync(filePath);
    return gzipSync(content).length;
  } catch (error) {
    return 0;
  }
}

/**
 * Check bundle sizes against budget
 */
function checkBudget() {
  if (!existsSync(distPath)) {
    console.error('❌ Build output not found. Run `npm run build` first.');
    process.exit(1);
  }

  const assetsPath = join(distPath, 'assets');
  if (!existsSync(assetsPath)) {
    console.error('❌ Assets directory not found in build output.');
    process.exit(1);
  }

  let totalJS = 0;
  let totalCSS = 0;
  let violations = [];

  try {
    const files = readdirSync(assetsPath, { recursive: true });
    
    for (const file of files) {
      const filePath = join(assetsPath, file);
      const stats = statSync(filePath);
      
      if (stats.isFile()) {
        const gzippedSize = getGzippedSize(filePath);
        
        if (file.endsWith('.js')) {
          totalJS += gzippedSize;
        } else if (file.endsWith('.css')) {
          totalCSS += gzippedSize;
        }
      }
    }
  } catch (error) {
    console.error('❌ Error reading build assets:', error.message);
    process.exit(1);
  }

  const totalAssets = totalJS + totalCSS;

  // Check individual budgets
  if (totalJS > BUDGET_LIMITS.javascript) {
    violations.push({
      type: 'JavaScript',
      actual: totalJS,
      limit: BUDGET_LIMITS.javascript,
      overage: totalJS - BUDGET_LIMITS.javascript
    });
  }

  if (totalCSS > BUDGET_LIMITS.css) {
    violations.push({
      type: 'CSS', 
      actual: totalCSS,
      limit: BUDGET_LIMITS.css,
      overage: totalCSS - BUDGET_LIMITS.css
    });
  }

  if (totalAssets > BUDGET_LIMITS.total) {
    violations.push({
      type: 'Total Assets',
      actual: totalAssets,
      limit: BUDGET_LIMITS.total,
      overage: totalAssets - BUDGET_LIMITS.total
    });
  }

  // Report results
  console.log('🎯 Bundle Budget Check');
  console.log('=' .repeat(40));
  console.log(`JavaScript: ${formatBytes(totalJS)} / ${formatBytes(BUDGET_LIMITS.javascript)}`);
  console.log(`CSS: ${formatBytes(totalCSS)} / ${formatBytes(BUDGET_LIMITS.css)}`);
  console.log(`Total: ${formatBytes(totalAssets)} / ${formatBytes(BUDGET_LIMITS.total)}`);

  if (violations.length === 0) {
    console.log('\n✅ All budget checks passed!');
    
    // Show how much budget is left
    const jsRemaining = BUDGET_LIMITS.javascript - totalJS;
    const cssRemaining = BUDGET_LIMITS.css - totalCSS;
    const totalRemaining = BUDGET_LIMITS.total - totalAssets;
    
    console.log('📊 Remaining Budget:');
    console.log(`  JavaScript: ${formatBytes(jsRemaining)}`);
    console.log(`  CSS: ${formatBytes(cssRemaining)}`);
    console.log(`  Total: ${formatBytes(totalRemaining)}`);
    
    process.exit(0);
  } else {
    console.log('\n❌ Budget violations detected:');
    
    violations.forEach(violation => {
      const percent = Math.round((violation.actual / violation.limit) * 100);
      console.log(`  ${violation.type}: ${formatBytes(violation.actual)} exceeds ${formatBytes(violation.limit)} by ${formatBytes(violation.overage)} (${percent}%)`);
    });

    console.log('\n💡 Suggestions to reduce bundle size:');
    console.log('   • Use dynamic imports for code splitting');
    console.log('   • Remove unused dependencies');
    console.log('   • Optimize images and compress assets');
    console.log('   • Enable tree shaking');
    console.log('   • Consider switching to lighter alternatives');
    
    process.exit(1);
  }
}

// Run the check
try {
  checkBudget();
} catch (error) {
  console.error('❌ Bundle check failed:', error.message);
  process.exit(1);
}