#!/usr/bin/env node

// Simple structure validation test for the refactored Discord bot
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing Refactored Discord Bot Structure');
console.log('============================================');

const requiredFiles = [
  'src/index.js',
  'src/bot/botManager.js',
  'src/bot/commandLoader.js',
  'src/bot/interactionHandler.js',
  'src/commands/foundry.js',
  'src/commands/user/dashboard.js',
  'src/commands/user/help.js',
  'src/handlers/slashCommandHandler.js',
  'src/handlers/buttonHandler.js',
  'src/services/lambdaService.js',
  'src/services/configService.js',
  'src/utils/permissions.js',
  'src/utils/logging.js',
  'src/ui/dashboardService.js',
];

const requiredDirectories = [
  'src',
  'src/bot',
  'src/commands',
  'src/commands/user',
  'src/commands/admin',
  'src/handlers',
  'src/services',
  'src/utils',
  'src/ui',
];

let allTestsPassed = true;

// Test directory structure
console.log('\n📁 Testing Directory Structure:');
requiredDirectories.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`✅ ${dir}`);
  } else {
    console.log(`❌ ${dir} - Missing!`);
    allTestsPassed = false;
  }
});

// Test required files
console.log('\n📄 Testing Required Files:');
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    const stats = fs.statSync(file);
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    console.log(`✅ ${file} (${lines} lines)`);
  } else {
    console.log(`❌ ${file} - Missing!`);
    allTestsPassed = false;
  }
});

// Test file size improvements
console.log('\n📊 File Size Comparison:');
if (fs.existsSync('index-legacy.js') && fs.existsSync('src/index.js')) {
  const legacyLines = fs.readFileSync('index-legacy.js', 'utf8').split('\n').length;
  const refactoredLines = fs.readFileSync('src/index.js', 'utf8').split('\n').length;
  const reduction = ((legacyLines - refactoredLines) / legacyLines * 100).toFixed(1);
  
  console.log(`📈 Legacy index.js: ${legacyLines} lines`);
  console.log(`📉 Refactored index.js: ${refactoredLines} lines`);
  console.log(`🎯 Reduction: ${reduction}% smaller!`);
}

// Test module imports
console.log('\n🔗 Testing Module Imports:');
try {
  const botManager = require('./src/bot/botManager.js');
  console.log('✅ Bot manager imports correctly');
  
  const lambdaService = require('./src/services/lambdaService.js');
  console.log('✅ Lambda service imports correctly');
  
  const permissions = require('./src/utils/permissions.js');
  console.log('✅ Permissions utility imports correctly');
  
  const dashboardService = require('./src/ui/dashboardService.js');
  console.log('✅ Dashboard service imports correctly');
  
} catch (error) {
  console.log(`❌ Import error: ${error.message}`);
  allTestsPassed = false;
}

// Test package.json scripts
console.log('\n⚙️ Testing Package.json Scripts:');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const expectedScripts = ['start', 'start:legacy', 'dev', 'dev:legacy'];

expectedScripts.forEach(script => {
  if (packageJson.scripts[script]) {
    console.log(`✅ Script "${script}": ${packageJson.scripts[script]}`);
  } else {
    console.log(`❌ Script "${script}" missing!`);
    allTestsPassed = false;
  }
});

// Final result
console.log('\n🎯 Test Results:');
if (allTestsPassed) {
  console.log('✅ All tests passed! The refactored structure is ready.');
  console.log('\n🚀 Quick start:');
  console.log('   1. cp src/.env.example .env');
  console.log('   2. Edit .env with your Discord token');
  console.log('   3. npm install');
  console.log('   4. npm start');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please check the structure.');
  process.exit(1);
}