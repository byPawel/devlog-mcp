/**
 * AI Pattern Matcher for Smart Tagging
 * Phase 1: Regex-based pattern matching implementation
 */

import { TagCategory, TagSuggestion } from '../types/ai-types.js';

interface PatternRule {
  category: TagCategory;
  tag: string;
  patterns: RegExp[];
  confidence: number;
}

export class PatternMatcher {
  private readonly patternRules: PatternRule[] = [
    // Type patterns
    {
      category: 'type',
      tag: 'type:feature',
      patterns: [
        /(?:implement|add|create|build|develop)\s+(?:new\s+)?(?:feature|functionality)/i,
        /new\s+(?:feature|capability|function)/i,
        /feature\s+(?:implementation|development)/i
      ],
      confidence: 0.95
    },
    {
      category: 'type',
      tag: 'type:bugfix',
      patterns: [
        /(?:fix|resolve|patch|correct|repair)\s+(?:bug|issue|problem|error)/i,
        /bug\s*fix/i,
        /fixed\s+(?:an?\s+)?(?:bug|issue|problem)/i
      ],
      confidence: 0.95
    },
    {
      category: 'type',
      tag: 'type:research',
      patterns: [
        /(?:research|investigate|explore|analyze|study)/i,
        /comprehensive\s+(?:research|analysis)/i,
        /exploring\s+(?:options|possibilities)/i
      ],
      confidence: 0.9
    },
    {
      category: 'type',
      tag: 'type:decision',
      patterns: [
        /(?:decide|decision|chose|selected|determined)/i,
        /architectural\s+decision/i,
        /we\s+(?:will|should|must)\s+(?:use|implement|go\s+with)/i
      ],
      confidence: 0.85
    },

    // Priority patterns
    {
      category: 'priority',
      tag: 'priority:high',
      patterns: [
        /(?:urgent|critical|blocker|asap|immediately)/i,
        /high\s*priority/i,
        /must\s+have/i,
        /(?:need|needs)\s+(?:to\s+be\s+)?(?:done|completed)\s+(?:today|now|asap)/i
      ],
      confidence: 0.9
    },
    {
      category: 'priority',
      tag: 'priority:medium',
      patterns: [
        /(?:normal|standard|regular)/i,
        /medium\s*priority/i,
        /should\s+have/i
      ],
      confidence: 0.8
    },
    {
      category: 'priority',
      tag: 'priority:low',
      patterns: [
        /nice\s*to\s*have/i,
        /low\s*priority/i,
        /when\s*possible/i,
        /(?:can|could)\s+wait/i
      ],
      confidence: 0.8
    },

    // Status patterns
    {
      category: 'status',
      tag: 'status:completed',
      patterns: [
        /(?:completed?|done|finished|implemented)/i,
        /successfully\s+(?:implemented|completed|finished)/i,
        /✅\s*(?:done|completed)/i
      ],
      confidence: 0.95
    },
    {
      category: 'status',
      tag: 'status:in_progress',
      patterns: [
        /(?:in\s*progress|working\s+on|currently\s+(?:implementing|developing))/i,
        /(?:started|began)\s+(?:working|implementing)/i,
        /partially\s+(?:complete|implemented)/i
      ],
      confidence: 0.9
    },
    {
      category: 'status',
      tag: 'status:blocked',
      patterns: [
        /blocked\s+by/i,
        /waiting\s+(?:on|for)/i,
        /can't\s+proceed/i,
        /(?:stuck|halted)\s+(?:on|by)/i
      ],
      confidence: 0.95
    },

    // Complexity patterns
    {
      category: 'complexity',
      tag: 'complexity:high',
      patterns: [
        /(?:complex|complicated|difficult|challenging|intricate)/i,
        /requires\s+(?:significant|substantial|considerable)\s+(?:effort|work)/i,
        /multi-?(?:faceted|layered)/i
      ],
      confidence: 0.85
    },
    {
      category: 'complexity',
      tag: 'complexity:medium',
      patterns: [
        /(?:moderate|standard|typical)\s+complexity/i,
        /some\s+complexity/i,
        /moderately\s+(?:complex|challenging)/i
      ],
      confidence: 0.8
    },
    {
      category: 'complexity',
      tag: 'complexity:low',
      patterns: [
        /(?:simple|easy|straightforward|trivial)/i,
        /quick\s+(?:fix|change|update)/i,
        /minor\s+(?:change|update|modification)/i
      ],
      confidence: 0.85
    },

    // Technical scope patterns
    {
      category: 'scope',
      tag: 'ui',
      patterns: [
        /(?:ui|user\s+interface|frontend|front-end)/i,
        /(?:react|vue|angular)\s+component/i,
        /(?:css|styling|layout|design)/i
      ],
      confidence: 0.9
    },
    {
      category: 'scope',
      tag: 'api',
      patterns: [
        /(?:api|endpoint|rest|graphql)/i,
        /(?:backend|back-end)\s+(?:api|service)/i,
        /(?:http|request|response)/i
      ],
      confidence: 0.9
    },
    {
      category: 'scope',
      tag: 'database',
      patterns: [
        /(?:database|db|sql|nosql|mongodb|postgres)/i,
        /(?:schema|migration|query)/i,
        /data\s+(?:model|structure)/i
      ],
      confidence: 0.9
    },

    // Effort patterns
    {
      category: 'effort',
      tag: 'effort:1h',
      patterns: [
        /(?:1|one)\s*hour?/i,
        /quick\s+task/i,
        /(?:15|30|45)\s*min/i
      ],
      confidence: 0.7
    },
    {
      category: 'effort',
      tag: 'effort:4h',
      patterns: [
        /(?:half|0\.5)\s*day/i,
        /(?:3|4|three|four)\s*hours?/i,
        /morning\s+(?:task|work)/i
      ],
      confidence: 0.7
    },
    {
      category: 'effort',
      tag: 'effort:1d',
      patterns: [
        /(?:1|one)\s*day/i,
        /(?:full|whole)\s*day/i,
        /(?:6|7|8)\s*hours?/i
      ],
      confidence: 0.7
    },
    {
      category: 'effort',
      tag: 'effort:1w',
      patterns: [
        /(?:1|one)\s*week/i,
        /(?:5|five)\s*days?/i,
        /week\s*(?:long|of\s+work)/i
      ],
      confidence: 0.7
    }
  ];

  analyzeContent(content: string): TagSuggestion[] {
    const suggestions: TagSuggestion[] = [];
    const foundTags = new Set<string>();

    // Analyze content against all patterns
    for (const rule of this.patternRules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(content)) {
          // Avoid duplicate tags
          if (!foundTags.has(rule.tag)) {
            foundTags.add(rule.tag);
            
            // Extract matching text for reason
            const match = content.match(pattern);
            const matchedText = match ? match[0] : '';
            
            suggestions.push({
              tag: rule.tag,
              category: rule.category,
              confidence: rule.confidence,
              reason: `Detected "${matchedText}" in content`
            });
          }
          break; // Move to next rule after first match
        }
      }
    }

    // Sort by confidence and category priority
    return suggestions.sort((a, b) => {
      // First by confidence
      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence;
      }
      // Then by category priority
      const categoryPriority: Record<TagCategory, number> = {
        type: 1,
        priority: 2,
        status: 3,
        complexity: 4,
        scope: 5,
        effort: 6,
        technical: 7
      };
      return (categoryPriority[a.category] || 99) - (categoryPriority[b.category] || 99);
    });
  }

  // Extract key phrases for additional context
  extractKeyPhrases(content: string): string[] {
    const phrases: string[] = [];
    
    // Technical terms
    const techTerms = content.match(/\b(?:React|TypeScript|Node\.js|API|MCP|Dokoro|Jira|database|frontend|backend)\b/gi);
    if (techTerms) {
      phrases.push(...techTerms);
    }

    // Action phrases
    const actionPhrases = content.match(/(?:implement|create|fix|update|refactor|optimize|design|build)\s+\w+(?:\s+\w+)?/gi);
    if (actionPhrases) {
      phrases.push(...actionPhrases.slice(0, 5)); // Limit to top 5
    }

    return [...new Set(phrases)]; // Remove duplicates
  }

  // Calculate overall tag confidence based on content
  calculateContentConfidence(content: string): number {
    const wordCount = content.split(/\s+/).length;
    const hasCodeBlocks = content.includes('```');
    const hasBulletPoints = content.includes('- ') || content.includes('* ');
    const hasHeadings = content.includes('## ') || content.includes('### ');

    let confidence = 0.5; // Base confidence

    // Adjust based on content quality indicators
    if (wordCount > 100) confidence += 0.1;
    if (wordCount > 300) confidence += 0.1;
    if (hasCodeBlocks) confidence += 0.1;
    if (hasBulletPoints) confidence += 0.05;
    if (hasHeadings) confidence += 0.05;

    return Math.min(confidence, 1.0);
  }
}

// Export for testing
export function createPatternMatcher(): PatternMatcher {
  return new PatternMatcher();
}