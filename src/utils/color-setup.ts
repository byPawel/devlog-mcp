/**
 * Color Support Initialization
 *
 * MUST be imported FIRST before any color-related modules (chalk, ink).
 * Forces TrueColor support in non-TTY environments like MCP stdio.
 */

// Force TrueColor (16M colors) in non-TTY environments
process.env.FORCE_COLOR = '3';

// Also set chalk level after it loads
import chalk from 'chalk';
chalk.level = 3;  // 3 = truecolor (16M colors)

// Export empty to make this a module
export {};
