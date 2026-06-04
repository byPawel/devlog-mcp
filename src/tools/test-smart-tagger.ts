/**
 * Test the AI Smart Tagger with sample dokoro entries
 */

import { smartTagger } from './ai-smart-tagger.js';

const testEntries = [
  {
    id: 'test-1',
    content: `
# Implemented new feature for bulk task creation

Today I completed the implementation of the bulk task creation feature. This was a complex task that required significant effort to handle all the edge cases.

## What was done:
- Added React components for the bulk creation UI
- Implemented API endpoints for batch processing
- Fixed several bugs related to validation
- Added comprehensive unit tests

The feature is now ready for deployment. It took about 3 days to complete.

Status: Done
Priority: High (this was blocking the release)
    `
  },
  {
    id: 'test-2',
    content: `
# Research on Jira Templates System

Conducted comprehensive research on how Jira templates work for task creation. This investigation explored both HR and non-HR use cases.

Key findings:
- Native Jira has limited template support
- Add-ons provide advanced features like variables
- Templates can save 50-80% time on repetitive tasks

This is still in the research phase, need to explore implementation options.
    `
  },
  {
    id: 'test-3',
    content: `
# Quick fix for login bug

Fixed a simple bug where users couldn't login with special characters in password. 
The issue was in the validation regex. 

This was a trivial fix that took about 30 minutes.
    `
  },
  {
    id: 'test-4',
    content: `
# Blocked on API permissions

Can't proceed with the teams integration because we're waiting for the API access approval.
This is becoming a critical blocker for the sprint.

Need urgent resolution from the platform team.
    `
  }
];

async function runTests() {
  console.log('🧪 Testing AI Smart Tagger\n');

  for (const entry of testEntries) {
    console.log(`\n📄 Testing: ${entry.id}`);
    console.log('─'.repeat(50));
    
    const result = await smartTagger.analyzeContent(entry.content, {
      threshold: 0.5
    });

    console.log('\n📊 Analysis Results:');
    console.log(`Word Count: ${result.metadata.wordCount}`);
    console.log(`Content Quality: ${(result.metadata.contentQuality * 100).toFixed(1)}%`);
    console.log(`Key Phrases: ${result.metadata.keyPhrases.join(', ')}`);
    
    console.log('\n🏷️  Suggested Tags:');
    result.suggestions.forEach((suggestion: { tag: string; confidence: number; reason: string }) => {
      const confidence = (suggestion.confidence * 100).toFixed(1);
      console.log(`  ${suggestion.tag.padEnd(20)} [${confidence}%] - ${suggestion.reason}`);
    });
  }

  // Test tag improvement
  console.log('\n\n🔄 Testing Tag Improvement');
  console.log('─'.repeat(50));
  
  const currentTags = ['feature', 'ui', 'urgent'];
  const improvements = await smartTagger.improveTags(currentTags, testEntries[0].content);
  
  console.log('\nCurrent tags:', currentTags);
  console.log('\n✅ Tags to add:');
  improvements.add.forEach((s: { tag: string; confidence: number }) => {
    console.log(`  ${s.tag} [${(s.confidence * 100).toFixed(1)}%]`);
  });
  
  console.log('\n❌ Tags to remove:');
  improvements.remove.forEach((tag: string) => {
    console.log(`  ${tag}`);
  });
  
  console.log('\n🔄 Tags to replace:');
  improvements.replace.forEach((r: { old: string; new: { tag: string; confidence: number } }) => {
    console.log(`  ${r.old} → ${r.new.tag} [${(r.new.confidence * 100).toFixed(1)}%]`);
  });

  // Test batch analysis
  console.log('\n\n📦 Testing Batch Analysis');
  console.log('─'.repeat(50));
  
  const batchResults = await smartTagger.batchAnalyze(testEntries.slice(0, 2), {
    threshold: 0.6,
    progressCallback: (progress: number) => {
      console.log(`Progress: ${(progress * 100).toFixed(0)}%`);
    }
  });
  
  console.log('\nBatch results:');
  batchResults.forEach((suggestions: Array<{ tag: string }>, id: string) => {
    console.log(`\n${id}: ${suggestions.map(s => s.tag).join(', ')}`);
  });
}

// Run tests if this file is executed directly
runTests().catch(console.error);

export { runTests };