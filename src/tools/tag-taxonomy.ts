/**
 * Tag Taxonomy Definition
 * Central registry of all valid tags and their metadata
 */

import { TagCategory } from '../types/ai-types.js';

export interface TagDefinition {
  tag: string;
  category: TagCategory;
  description: string;
  aliases?: string[];
  parent?: string;
  exclusive?: boolean; // If true, only one tag from this group can be applied
}

export class TagTaxonomy {
  private readonly tags: Map<string, TagDefinition> = new Map();
  private readonly categories: Map<TagCategory, TagDefinition[]> = new Map();

  constructor() {
    this.initializeTaxonomy();
  }

  private initializeTaxonomy(): void {
    const definitions: TagDefinition[] = [
      // Type tags (exclusive)
      {
        tag: 'type:feature',
        category: 'type',
        description: 'New functionality or capability',
        aliases: ['feature', 'new-feature'],
        exclusive: true
      },
      {
        tag: 'type:bugfix',
        category: 'type',
        description: 'Fix for existing issue',
        aliases: ['bug', 'fix', 'bugfix'],
        exclusive: true
      },
      {
        tag: 'type:research',
        category: 'type',
        description: 'Investigation or exploration',
        aliases: ['research', 'investigation'],
        exclusive: true
      },
      {
        tag: 'type:decision',
        category: 'type',
        description: 'Architectural or design decision',
        aliases: ['decision', 'adr'],
        exclusive: true
      },
      {
        tag: 'type:session',
        category: 'type',
        description: 'Work session log',
        aliases: ['session', 'daily'],
        exclusive: true
      },
      {
        tag: 'type:analysis',
        category: 'type',
        description: 'Data analysis or investigation',
        aliases: ['analysis'],
        exclusive: true
      },

      // Priority tags (exclusive)
      {
        tag: 'priority:critical',
        category: 'priority',
        description: 'Must be done immediately',
        aliases: ['critical', 'p0', 'urgent'],
        exclusive: true
      },
      {
        tag: 'priority:high',
        category: 'priority',
        description: 'High priority task',
        aliases: ['high', 'p1', 'important'],
        exclusive: true
      },
      {
        tag: 'priority:medium',
        category: 'priority',
        description: 'Normal priority',
        aliases: ['medium', 'p2', 'normal'],
        exclusive: true
      },
      {
        tag: 'priority:low',
        category: 'priority',
        description: 'Low priority',
        aliases: ['low', 'p3', 'nice-to-have'],
        exclusive: true
      },

      // Status tags (exclusive)
      {
        tag: 'status:planning',
        category: 'status',
        description: 'In planning phase',
        aliases: ['planning', 'planned'],
        exclusive: true
      },
      {
        tag: 'status:active',
        category: 'status',
        description: 'Currently being worked on',
        aliases: ['active', 'in-progress', 'wip'],
        exclusive: true
      },
      {
        tag: 'status:blocked',
        category: 'status',
        description: 'Blocked by dependency',
        aliases: ['blocked', 'waiting'],
        exclusive: true
      },
      {
        tag: 'status:completed',
        category: 'status',
        description: 'Work completed',
        aliases: ['completed', 'done', 'finished'],
        exclusive: true
      },
      {
        tag: 'status:archived',
        category: 'status',
        description: 'Archived for reference',
        aliases: ['archived'],
        exclusive: true
      },

      // Complexity tags (exclusive)
      {
        tag: 'complexity:trivial',
        category: 'complexity',
        description: 'Very simple task',
        aliases: ['trivial', 'xs'],
        exclusive: true
      },
      {
        tag: 'complexity:low',
        category: 'complexity',
        description: 'Simple task',
        aliases: ['simple', 'easy', 's'],
        exclusive: true
      },
      {
        tag: 'complexity:medium',
        category: 'complexity',
        description: 'Moderate complexity',
        aliases: ['medium', 'moderate', 'm'],
        exclusive: true
      },
      {
        tag: 'complexity:high',
        category: 'complexity',
        description: 'Complex task',
        aliases: ['complex', 'hard', 'l'],
        exclusive: true
      },
      {
        tag: 'complexity:epic',
        category: 'complexity',
        description: 'Very complex, multi-part task',
        aliases: ['epic', 'xl'],
        exclusive: true
      },

      // Effort tags (exclusive)
      {
        tag: 'effort:1h',
        category: 'effort',
        description: '1 hour or less',
        aliases: ['1h', '1-hour'],
        exclusive: true
      },
      {
        tag: 'effort:2h',
        category: 'effort',
        description: '2 hours',
        aliases: ['2h', '2-hours'],
        exclusive: true
      },
      {
        tag: 'effort:4h',
        category: 'effort',
        description: 'Half day',
        aliases: ['4h', 'half-day'],
        exclusive: true
      },
      {
        tag: 'effort:1d',
        category: 'effort',
        description: '1 day',
        aliases: ['1d', '1-day', 'day'],
        exclusive: true
      },
      {
        tag: 'effort:2d',
        category: 'effort',
        description: '2 days',
        aliases: ['2d', '2-days'],
        exclusive: true
      },
      {
        tag: 'effort:3d',
        category: 'effort',
        description: '3 days',
        aliases: ['3d', '3-days'],
        exclusive: true
      },
      {
        tag: 'effort:1w',
        category: 'effort',
        description: '1 week',
        aliases: ['1w', '1-week', 'week'],
        exclusive: true
      },
      {
        tag: 'effort:2w+',
        category: 'effort',
        description: 'More than 2 weeks',
        aliases: ['2w+', 'long'],
        exclusive: true
      },

      // Scope tags (non-exclusive)
      {
        tag: 'ui',
        category: 'scope',
        description: 'User interface related',
        aliases: ['frontend', 'ui/ux']
      },
      {
        tag: 'api',
        category: 'scope',
        description: 'API or backend service',
        aliases: ['backend', 'service']
      },
      {
        tag: 'database',
        category: 'scope',
        description: 'Database related',
        aliases: ['db', 'data']
      },
      {
        tag: 'infrastructure',
        category: 'scope',
        description: 'Infrastructure or DevOps',
        aliases: ['infra', 'devops']
      },
      {
        tag: 'documentation',
        category: 'scope',
        description: 'Documentation updates',
        aliases: ['docs']
      },
      {
        tag: 'testing',
        category: 'scope',
        description: 'Testing related',
        aliases: ['test', 'qa']
      },
      {
        tag: 'performance',
        category: 'scope',
        description: 'Performance optimization',
        aliases: ['perf', 'optimization']
      },
      {
        tag: 'security',
        category: 'scope',
        description: 'Security related',
        aliases: ['sec']
      },

      // Technical tags (non-exclusive)
      {
        tag: 'react',
        category: 'technical',
        description: 'React framework'
      },
      {
        tag: 'typescript',
        category: 'technical',
        description: 'TypeScript language'
      },
      {
        tag: 'nodejs',
        category: 'technical',
        description: 'Node.js runtime'
      },
      {
        tag: 'forge',
        category: 'technical',
        description: 'Atlassian Forge platform'
      },
      {
        tag: 'jira',
        category: 'technical',
        description: 'Jira integration'
      },
      {
        tag: 'mcp',
        category: 'technical',
        description: 'Model Context Protocol'
      },
      {
        tag: 'ai',
        category: 'technical',
        description: 'Artificial Intelligence'
      },
      {
        tag: 'dokoro',
        category: 'technical',
        description: 'Dokoro system'
      }
    ];

    // Initialize maps
    definitions.forEach(def => {
      this.tags.set(def.tag, def);
      
      // Also index by aliases
      def.aliases?.forEach(alias => {
        this.tags.set(alias, def);
      });

      // Group by category
      const categoryTags = this.categories.get(def.category) || [];
      categoryTags.push(def);
      this.categories.set(def.category, categoryTags);
    });
  }

  getTag(tag: string): TagDefinition | undefined {
    return this.tags.get(tag.toLowerCase());
  }

  getTagsByCategory(category: TagCategory): TagDefinition[] {
    return this.categories.get(category) || [];
  }

  isValidTag(tag: string): boolean {
    return this.tags.has(tag.toLowerCase());
  }

  normalizeTag(tag: string): string | undefined {
    const def = this.getTag(tag);
    return def?.tag;
  }

  getExclusiveGroup(tag: string): TagDefinition[] | undefined {
    const def = this.getTag(tag);
    if (!def || !def.exclusive) return undefined;
    
    return this.getTagsByCategory(def.category).filter(t => t.exclusive);
  }

  validateTags(tags: string[]): { valid: string[]; invalid: string[]; conflicts: string[][] } {
    const valid: string[] = [];
    const invalid: string[] = [];
    const conflicts: string[][] = [];
    const exclusiveGroups = new Map<TagCategory, string>();

    tags.forEach(tag => {
      const normalized = this.normalizeTag(tag);
      if (!normalized) {
        invalid.push(tag);
        return;
      }

      const def = this.getTag(normalized)!;
      
      // Check for exclusive conflicts
      if (def.exclusive) {
        const existing = exclusiveGroups.get(def.category);
        if (existing && existing !== normalized) {
          conflicts.push([existing, normalized]);
        } else {
          exclusiveGroups.set(def.category, normalized);
          valid.push(normalized);
        }
      } else {
        valid.push(normalized);
      }
    });

    return { valid, invalid, conflicts };
  }

  suggestTags(content: string, existingTags: string[] = []): string[] {
    const suggestions: string[] = [];
    const existing = new Set(existingTags.map(t => this.normalizeTag(t)).filter(Boolean));

    // Check each tag definition for relevance
    this.tags.forEach((def, key) => {
      // Skip if already tagged
      if (existing.has(def.tag)) return;
      
      // Skip aliases
      if (key !== def.tag) return;

      // Simple keyword matching for technical tags
      if (def.category === 'technical' && content.toLowerCase().includes(key)) {
        suggestions.push(def.tag);
      }
    });

    return suggestions;
  }
}

// Singleton instance
export const tagTaxonomy = new TagTaxonomy();