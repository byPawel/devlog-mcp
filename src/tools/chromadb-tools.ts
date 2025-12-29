import { z } from 'zod';
import { ToolDefinition } from './registry.js';
import { CallToolResult } from '../types.js';
import { spawn } from 'child_process';
import path from 'path';
import { Icon, successResponse, errorResponse } from '../utils/format.js';

// Path to the Python ChromaDB indexer
const INDEXER_PATH = path.join(process.cwd(), 'scripts', 'chromadb-smart-index.py');

/**
 * Execute Python ChromaDB script and return results
 */
async function runChromaCommand(args: string[]): Promise<{ success: boolean; results: Array<{ file: string; source: string; type: string; relevance: string; preview: string }>; raw: string }> {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [INDEXER_PATH, ...args]);
    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ChromaDB command failed: ${stderr}`));
      } else {
        // Parse the output to extract search results
        const lines = stdout.split('\n');
        const results = [];
        let inResults = false;
        
        for (const line of lines) {
          if (line.includes('Search results for:')) {
            inResults = true;
            continue;
          }
          if (inResults && line.trim() && !line.includes('===')) {
            // Parse result lines
            if (line.match(/^\d+\./)) {
              const result = {
                file: '',
                source: '',
                type: '',
                relevance: '',
                preview: ''
              };
              
              // Extract file path
              const fileMatch = line.match(/\d+\.\s+(.+)/);
              if (fileMatch) result.file = fileMatch[1];
              
              results.push(result);
            } else if (line.includes('Source:')) {
              const last = results[results.length - 1];
              if (last) last.source = line.replace('Source:', '').trim();
            } else if (line.includes('Type:')) {
              const last = results[results.length - 1];
              if (last) last.type = line.replace('Type:', '').trim();
            } else if (line.includes('Relevance:')) {
              const last = results[results.length - 1];
              if (last) last.relevance = line.replace('Relevance:', '').trim();
            } else if (line.includes('Preview:')) {
              const last = results[results.length - 1];
              if (last) last.preview = line.replace('Preview:', '').trim();
            }
          }
        }
        
        resolve({
          success: true,
          results: results,
          raw: stdout
        });
      }
    });
  });
}

export const chromadbTools: ToolDefinition[] = [
  {
    name: 'search_universal',
    title: 'Universal Search',
    description: 'Search across all indexed content using ChromaDB (devlog, Jira, Perplexity)',
    inputSchema: {
      query: z.string().describe('Search query'),
      source: z.enum(['all', 'devlog', 'jira', 'perplexity']).optional().describe('Filter by source'),
      limit: z.number().default(5).describe('Number of results')
    },
    handler: async (args: { query: string; source?: 'all' | 'devlog' | 'jira' | 'perplexity'; limit?: number }): Promise<CallToolResult> => {
      const { query, source } = args;
      try {
        const commandArgs = ['--search', query];
        if (source && source !== 'all') {
          commandArgs.push('--source', source);
        }
        
        const result = await runChromaCommand(commandArgs);
        
        return {
          content: [{
            type: 'text',
            text: `${Icon.search} **Found ${result.results.length} results** for "${query}":\n\n` +
              result.results.map((r, i: number) =>
                `${Icon.file} **${i + 1}. ${r.file}**\n   ${Icon.tag} Source: ${r.source}\n   ${Icon.info} Type: ${r.type}\n   ${Icon.chart} Relevance: ${r.relevance}\n   ${Icon.arrow} Preview: ${r.preview}`
              ).join('\n\n')
          }]
        };
      } catch (error: unknown) {
        return {
          content: [{
            type: 'text',
            text: `${Icon.error} **Error searching ChromaDB:** ${(error as Error).message}`
          }],
          isError: true
        };
      }
    }
  },
  
  {
    name: 'index_content',
    title: 'Index Content',
    description: 'Index new content into ChromaDB',
    inputSchema: {
      type: z.enum(['perplexity', 'jira']).describe('Type of content to index'),
      query: z.string().describe('Query (for Perplexity) or issue key (for Jira)'),
      content: z.string().describe('Content to index'),
      metadata: z.record(z.unknown()).optional().describe('Additional metadata')
    },
    handler: async (args: { type: 'perplexity' | 'jira'; query: string; content: string; metadata?: Record<string, unknown> }): Promise<CallToolResult> => {
      const { type, query, content } = args;
      try {
        if (type === 'perplexity') {
          const commandArgs = ['--index-perplexity', query, content];
          await runChromaCommand(commandArgs);
          return {
            content: [{
              type: 'text',
              text: `${Icon.success} **Indexed Perplexity search:** "${query}"`
            }]
          };
        } else if (type === 'jira') {
          // Save Jira content to temp file then index
          const tempFile = `/tmp/jira-${Date.now()}.json`;
          const fs = await import('fs/promises');
          await fs.writeFile(tempFile, content);
          
          const commandArgs = ['--index-jira', tempFile];
          await runChromaCommand(commandArgs);
          
          // Clean up temp file
          await fs.unlink(tempFile);
          
          return {
            content: [{
              type: 'text',
              text: `${Icon.success} **Indexed Jira issue:** ${query}`
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: `${Icon.warning} **Unknown content type:** ${type}`
          }],
          isError: true
        };
      } catch (error: unknown) {
        return {
          content: [{
            type: 'text',
            text: `${Icon.error} **Error indexing content:** ${(error as Error).message}`
          }],
          isError: true
        };
      }
    }
  },
  
  {
    name: 'chromadb_reindex',
    title: 'Reindex ChromaDB',
    description: 'Reindex all devlog files (incremental by default)',
    inputSchema: {
      full: z.boolean().default(false).describe('Perform full reindex (delete and recreate)')
    },
    handler: async (args: { full?: boolean }): Promise<CallToolResult> => {
      const { full = false } = args;
      try {
        const commandArgs = full ? ['--full'] : [];
        const result = await runChromaCommand(commandArgs);
        
        // Extract indexing stats from output
        const match = result.raw.match(/Total files: (\d+)\nIndexed: (\d+)\nCollection size: (\d+)/);
        if (match) {
          return {
            content: [{
              type: 'text',
              text: `${Icon.success} **Reindexing complete:**\n${Icon.file} Total files: ${match[1]}\n${Icon.sync} Indexed: ${match[2]}\n${Icon.folder} Collection size: ${match[3]} documents`
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: `${Icon.success} **Reindexing complete**`
          }]
        };
      } catch (error: unknown) {
        return {
          content: [{
            type: 'text',
            text: `${Icon.error} **Error reindexing:** ${(error as Error).message}`
          }],
          isError: true
        };
      }
    }
  }
];