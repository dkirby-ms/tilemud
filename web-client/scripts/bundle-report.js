#!/usr/bin/env node
/**
 * Bundle Report Script
 * 
 * Generates a detailed report of bundle sizes and chunk analysis.
 * Used by `npm run build:analyze` to provide insights into bundle composition.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '../dist');

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
 * Get file size with gzip compression
 */
function getFileSizes(filePath) {
  try {
    const content = readFileSync(filePath);
    const gzipped = gzipSync(content);
    
    return {
      raw: content.length,
      gzipped: gzipped.length
    };
  } catch (error) {
    return { raw: 0, gzipped: 0 };
  }
}

/**
 * Analyze bundle files
 */
function analyzeBundles() {
  if (!existsSync(distPath)) {
    console.error('❌ Build output not found. Run `npm run build` first.');
    process.exit(1);
  }

  const manifestPath = join(distPath, '.vite/manifest.json');
  let manifest = {};
  
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch (error) {
      console.warn('⚠️ Could not read Vite manifest');
    }
  }

  const assets = [];
  const jsFiles = [];
  const cssFiles = [];

  // Find all built assets
  try {
    const files = readdirSync(join(distPath, 'assets'), { recursive: true });
    
    for (const file of files) {
      const filePath = join(distPath, 'assets', file);
      const stats = statSync(filePath);
      
      if (stats.isFile()) {
        const sizes = getFileSizes(filePath);
        const asset = {
          name: file,
          ...sizes,
          type: file.endsWith('.js') ? 'js' : file.endsWith('.css') ? 'css' : 'other'
        };
        
        assets.push(asset);
        
        if (asset.type === 'js') jsFiles.push(asset);
        if (asset.type === 'css') cssFiles.push(asset);
      }
    }
  } catch (error) {
    console.error('❌ Error reading build assets:', error.message);
    process.exit(1);
  }

  // Calculate totals
  const totalJS = jsFiles.reduce((sum, file) => sum + file.gzipped, 0);
  const totalCSS = cssFiles.reduce((sum, file) => sum + file.gzipped, 0);
  const totalAssets = totalJS + totalCSS;

  // Generate report
  console.log('\n📦 Bundle Analysis Report\n');
  console.log('=' .repeat(60));
  
  console.log('\n📊 Summary:');
  console.log(`Total JavaScript (gzipped): ${formatBytes(totalJS)}`);
  console.log(`Total CSS (gzipped): ${formatBytes(totalCSS)}`);
  console.log(`Total Assets (gzipped): ${formatBytes(totalAssets)}`);
  
  // Budget check
  const budgetLimit = 200 * 1024; // 200KB in bytes
  const budgetStatus = totalAssets <= budgetLimit ? '✅' : '⚠️';
  const budgetPercent = Math.round((totalAssets / budgetLimit) * 100);
  
  console.log(`\n🎯 Budget Status: ${budgetStatus} ${formatBytes(totalAssets)} / ${formatBytes(budgetLimit)} (${budgetPercent}%)`);
  
  if (totalAssets > budgetLimit) {
    const overBudget = totalAssets - budgetLimit;
    console.log(`   Over budget by: ${formatBytes(overBudget)}`);
  }

  // Detailed breakdown
  if (jsFiles.length > 0) {
    console.log('\n📄 JavaScript Files:');
    jsFiles
      .sort((a, b) => b.gzipped - a.gzipped)
      .forEach(file => {
        console.log(`  ${file.name.padEnd(30)} ${formatBytes(file.raw).padStart(8)} → ${formatBytes(file.gzipped).padStart(8)} (gzipped)`);
      });
  }

  if (cssFiles.length > 0) {
    console.log('\n🎨 CSS Files:');
    cssFiles
      .sort((a, b) => b.gzipped - a.gzipped)
      .forEach(file => {
        console.log(`  ${file.name.padEnd(30)} ${formatBytes(file.raw).padStart(8)} → ${formatBytes(file.gzipped).padStart(8)} (gzipped)`);
      });
  }

  // Analysis file link
  const analysisPath = join(distPath, 'bundle-analysis.html');
  if (existsSync(analysisPath)) {
    console.log(`\n🔍 Detailed analysis: file://${analysisPath}`);
  }

  console.log('\n' + '='.repeat(60));
  
  return {
    totalAssets,
    budgetLimit,
    withinBudget: totalAssets <= budgetLimit,
    files: assets
  };
}

// Run analysis
try {
  const result = analyzeBundles();
  
  if (!result.withinBudget) {
    console.log('\n⚠️ Bundle size exceeds budget. Consider:');
    console.log('   • Code splitting with dynamic imports');
    console.log('   • Removing unused dependencies');
    console.log('   • Optimizing images and assets');
    console.log('   • Tree shaking unused code');
  }
  
  process.exit(0);
} catch (error) {
  console.error('❌ Bundle analysis failed:', error.message);
  process.exit(1);
}