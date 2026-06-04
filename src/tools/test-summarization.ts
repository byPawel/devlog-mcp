/**
 * Test the Auto-Summarization System
 */

import { summarizer } from './summarizer.js';

const testContent = [
  {
    id: 'test-1',
    title: 'Long Technical Document',
    content: `
# Implementing Advanced AI Features for Dokoro System

Today I made significant progress on implementing the AI-powered features for our Dokoro system. The goal is to create an intelligent system that can automatically tag entries, find similar content, and generate summaries.

## What was accomplished:

First, I implemented the smart tagging system using regex-based pattern matching. This involved creating a comprehensive taxonomy of over 80 tags organized into categories like type, status, priority, and scope. The system uses confidence scoring to rank tag suggestions based on multiple factors including pattern match strength and context relevance.

Next, I built the similarity detection engine using TF-IDF vectorization. This allows the system to find related dokoro entries even when they don't share exact keywords. The cosine similarity algorithm compares document vectors to identify semantic similarities. I also added clustering capabilities to group related entries into topics.

Finally, I started work on the auto-summarization feature. This uses extractive summarization techniques to identify the most important sentences in a document. The scoring algorithm considers factors like sentence position, keyword density, and similarity to the title.

## Technical details:

- Implemented 15 new MCP tools across the three AI features
- Used TypeScript for type safety and better IDE support
- Created modular architecture for easy maintenance
- Added comprehensive test suites for each component
- Optimized performance with pre-built indexes

## Next steps:

Tomorrow I plan to integrate these features into the dashboard and add real-time processing capabilities. I also need to improve the summarization algorithm to handle longer documents better.

The entire implementation took about 6 hours of focused work. All tests are passing and the features are ready for production use.
    `
  },
  {
    id: 'test-2',
    title: 'Short Status Update',
    content: `
# Quick Update on Template System

Made progress on the template system today. Completed the research phase and identified key requirements:

- Need to support variable substitution
- Must handle nested templates
- Should integrate with existing bulk creation UI

Started designing the data model. Will continue implementation tomorrow.
    `
  }
];

async function runTests() {
  console.log('🧪 Testing Auto-Summarization System\n');

  for (const test of testContent) {
    console.log(`\n📄 Testing: ${test.title}`);
    console.log('─'.repeat(50));
    
    // Test different summary styles
    const styles: Array<'paragraph' | 'bullets' | 'structured'> = ['paragraph', 'bullets', 'structured'];
    
    for (const style of styles) {
      console.log(`\n📝 ${style.toUpperCase()} Style (100 words):`);
      
      const summary = await summarizer.summarize(test.content, {
        maxLength: 100,
        style,
        focusOn: ['AI', 'implementation', 'progress']
      });
      
      console.log(summary.text);
      
      if (summary.metadata) {
        console.log(`\n📊 Metrics:`);
        console.log(`- Original: ${test.content.split(/\s+/).length} words`);
        console.log(`- Summary: ${summary.metadata.wordCount} words`);
        console.log(`- Compression: ${(summary.metadata.compressionRatio * 100).toFixed(1)}%`);
      }
      
      if (summary.keyPoints && summary.keyPoints.length > 0) {
        console.log(`\n🔑 Key Points:`);
        summary.keyPoints.forEach((point, i) => {
          console.log(`${i + 1}. ${point}`);
        });
      }
      
      if (summary.keywords && summary.keywords.length > 0) {
        console.log(`\n🏷️  Keywords: ${summary.keywords.join(', ')}`);
      }
      
      console.log('\n' + '─'.repeat(30));
    }
  }

  // Test chunk summarization
  console.log('\n\n📦 Testing Chunk Summarization');
  console.log('─'.repeat(50));
  
  const chunks = await summarizer.summarizeInChunks(testContent[0].content, 100);
  
  console.log(`\nSplit into ${chunks.length} chunks:\n`);
  
  chunks.forEach((chunk, i) => {
    console.log(`Chunk ${i + 1} (Importance: ${chunk.importance.toFixed(2)}):`);
    console.log(chunk.summary.substring(0, 150) + '...\n');
  });
}

// Run tests
runTests().catch(console.error);

export { runTests };