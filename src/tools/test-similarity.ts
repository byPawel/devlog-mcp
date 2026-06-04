/**
 * Test the Similarity Detection System
 */

import { similarityDetector } from './similarity-detector.js';

const testContent = [
  {
    id: 'query-1',
    content: `
# Implementing bulk task creation feature

Working on adding a new feature for bulk task creation in Jira. This will allow users to create multiple tasks at once using templates and variables.

Key components:
- React UI for bulk input
- Template system with variable substitution
- API integration for batch processing
- Validation and error handling
    `
  },
  {
    id: 'query-2', 
    content: `
# Research on AI-powered tagging

Investigating how to use AI to automatically suggest tags for dokoro entries. Looking at pattern matching and NLP techniques.

Approaches considered:
- Regex-based pattern matching
- TF-IDF for similarity
- Machine learning classification
    `
  }
];

async function runTests() {
  console.log('🧪 Testing Similarity Detection System\n');

  // Test 1: Build Index
  console.log('📚 Building similarity index...');
  const startTime = Date.now();
  await similarityDetector.buildIndex(['dokoro/**/*.md']);
  console.log(`✅ Index built in ${Date.now() - startTime}ms\n`);

  // Test 2: Find similar content
  for (const test of testContent) {
    console.log(`\n🔍 Testing: ${test.id}`);
    console.log('─'.repeat(50));
    
    const results = await similarityDetector.findSimilar(test.content, {
      threshold: 0.2,
      maxResults: 5,
      boostRecent: true
    });

    console.log(`\nFound ${results.length} similar entries:\n`);
    
    results.forEach((result, i) => {
      console.log(`${i + 1}. ${result.file}`);
      console.log(`   Similarity: ${(result.score * 100).toFixed(1)}%`);
      console.log(`   Type: ${result.type}`);
      if (result.metadata.title) {
        console.log(`   Title: ${result.metadata.title}`);
      }
      if (result.metadata.tags && result.metadata.tags.length > 0) {
        console.log(`   Tags: ${result.metadata.tags.join(', ')}`);
      }
      console.log();
    });
  }

  // Test 3: Cluster topics
  console.log('\n📊 Testing Topic Clustering');
  console.log('─'.repeat(50));
  
  const clusters = await similarityDetector.clusterDocuments(0.4);
  
  console.log(`\nFound ${clusters.size} topic clusters:\n`);
  
  let clusterNum = 1;
  for (const [, files] of clusters) {
    if (clusterNum > 5) break;  // Show first 5 clusters
    
    console.log(`Cluster ${clusterNum}: ${files.length} files`);
    console.log(`  Files: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`);
    console.log();
    clusterNum++;
  }

  // Test 4: Check duplicate detection
  console.log('\n🔄 Testing Duplicate Detection');
  console.log('─'.repeat(50));
  
  const duplicateTest = `
# Implemented bulk task creation

Today I finished implementing the bulk task creation feature. Users can now create multiple Jira tasks at once.
  `;
  
  const dupResults = await similarityDetector.findSimilar(duplicateTest, {
    threshold: 0.4,
    maxResults: 3
  });
  
  if (dupResults.length > 0 && dupResults[0].score > 0.7) {
    console.log('⚠️  Potential duplicate detected!');
    console.log(`   Most similar: ${dupResults[0].file} (${(dupResults[0].score * 100).toFixed(1)}%)`);
  } else {
    console.log('✅ No duplicates detected');
  }
}

// Run tests
runTests().catch(console.error);

export { runTests };