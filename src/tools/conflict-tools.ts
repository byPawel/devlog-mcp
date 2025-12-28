import { z } from 'zod';
import { ToolDefinition } from './registry.js';
import { searchDevlogs } from '../utils/search.js';
import { CallToolResult } from '../types.js';
import { Icon, successResponse, warningResponse } from '../utils/format.js';

export const conflictTools: ToolDefinition[] = [
  {
    name: 'devlog_detect_conflicts',
    title: 'Detect Conflicts',
    description: 'Find potential conflicts with existing features',
    inputSchema: {
      feature: z.string().describe('Feature name or description to check for conflicts'),
    },
    handler: async ({ feature }): Promise<CallToolResult> => {
      // Search for similar features
      const results = await searchDevlogs(feature);
      
      const conflicts = results.filter(r => {
        const content = r.fullContent?.toLowerCase() || '';
        const featureLower = feature.toLowerCase();
        
        // Check for exact matches or similar implementations
        return content.includes(featureLower) || 
               content.includes('implement') && content.includes(featureLower.split(' ')[0]);
      });
      
      if (conflicts.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: successResponse('No Conflicts', `Safe to implement: "${feature}"`),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: warningResponse(`${conflicts.length} Potential Conflicts`,
              `Feature: "${feature}"\n\n` +
              conflicts.map(c => `- ${c.file}\n  ${c.excerpt}`).join('\n\n')),
          },
        ],
      };
    }
  },
  
  {
    name: 'devlog_check_duplicate',
    title: 'Check Duplicate',
    description: 'Check if feature has already been implemented',
    inputSchema: {
      description: z.string().describe('Feature description to check for duplicates'),
    },
    handler: async ({ description }): Promise<CallToolResult> => {
      // Search for similar descriptions in features
      const results = await searchDevlogs(description, 'features');
      
      const duplicates = results.filter(r => {
        const content = r.fullContent?.toLowerCase() || '';
        
        // Check for implementations with similar descriptions
        return content.includes('implemented') || content.includes('completed');
      });
      
      if (duplicates.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: successResponse('No Duplicates', `Safe to implement: "${description}"`),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: warningResponse(`${duplicates.length} Similar Implementations`,
              duplicates.map(d => `- ${d.file}\n  ${d.excerpt}`).join('\n\n')),
          },
        ],
      };
    }
  },
  
  {
    name: 'devlog_regression_history',
    title: 'Regression History',
    description: 'Track what broke before - prevent repeating failures',
    inputSchema: {
      component: z.string().describe('Component or feature name to check regression history'),
    },
    handler: async ({ component }): Promise<CallToolResult> => {
      // Search for regression patterns
      const results = await searchDevlogs(component);
      
      const regressions = results.filter(r => {
        const content = r.fullContent?.toLowerCase() || '';
        return content.includes('broke') || 
               content.includes('regression') || 
               content.includes('failed') ||
               content.includes('bug') ||
               content.includes('issue');
      });
      
      if (regressions.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: successResponse('No Regressions', `Clean history for: "${component}"`),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: warningResponse(`Regression History for "${component}"`,
              regressions.map(r => {
                const content = r.fullContent || '';
                const lines = content.split('\n');
                const relevantLines = lines.filter(l =>
                  l.toLowerCase().includes('broke') ||
                  l.toLowerCase().includes('regression') ||
                  l.toLowerCase().includes('failed') ||
                  l.toLowerCase().includes('bug') ||
                  l.toLowerCase().includes('issue')
                );

                return `- ${r.file} (${r.lastModified.toISOString()})\n  ${relevantLines.join('\n  ') || r.excerpt}`;
              }).join('\n\n')),
          },
        ],
      };
    }
  }
];