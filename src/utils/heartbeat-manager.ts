/**
 * Heartbeat manager for automatic pause detection
 * Monitors activity and updates session metadata
 */

import { getCurrentWorkspace } from './workspace.js';
import { extractMetadata, updateMetadata } from './session-metadata.js';
import { updateLockHeartbeat } from './lock-manager.js';

let heartbeatTimer: NodeJS.Timeout | null = null;
let lastActivityTime: Date = new Date();
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INACTIVE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

export function updateLastActivity(): void {
  lastActivityTime = new Date();
}

export async function startHeartbeat(agentId: string): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  
  heartbeatTimer = setInterval(async () => {
    try {
      const workspace = await getCurrentWorkspace();
      if (!workspace.exists) {
        stopHeartbeat();
        return;
      }
      
      const metadata = await extractMetadata(workspace.path);
      if (!metadata) return;
      
      const now = new Date();
      const timeSinceLastActivity = now.getTime() - lastActivityTime.getTime();
      
      // Check if we've been inactive
      if (timeSinceLastActivity > INACTIVE_THRESHOLD) {
        const pauseStart = new Date(lastActivityTime.getTime() + 1000);
        const lastPause = metadata.timing.pauses[metadata.timing.pauses.length - 1];

        // Extend last pause if it's recent auto_inactive (within 10 min), otherwise create new
        if (lastPause?.reason === 'auto_inactive') {
          const lastPauseEnd = new Date(lastPause.end).getTime();
          const gapMinutes = (pauseStart.getTime() - lastPauseEnd) / 60000;

          if (gapMinutes < 10) {
            // Extend existing pause
            const oldDuration = Math.round((lastPauseEnd - new Date(lastPause.start).getTime()) / 60000);
            lastPause.end = now.toISOString();
            const newDuration = Math.round((now.getTime() - new Date(lastPause.start).getTime()) / 60000);
            metadata.timing.pause_minutes += (newDuration - oldDuration);
          } else {
            // Gap too large, create new pause
            metadata.timing.pauses.push({
              start: pauseStart.toISOString(),
              end: now.toISOString(),
              reason: 'auto_inactive'
            });
            metadata.timing.pause_minutes += Math.round((now.getTime() - pauseStart.getTime()) / 60000);
          }
        } else {
          // No previous pause or different reason, create new
          metadata.timing.pauses.push({
            start: pauseStart.toISOString(),
            end: now.toISOString(),
            reason: 'auto_inactive'
          });
          metadata.timing.pause_minutes += Math.round((now.getTime() - pauseStart.getTime()) / 60000);
        }

        // Update last activity to now to prevent duplicate pauses
        lastActivityTime = now;
      } else {
        // Active time - add to active minutes
        const activeMinutes = Math.round(timeSinceLastActivity / 60000);
        metadata.timing.active_minutes += activeMinutes;
      }
      
      // Update heartbeat timestamp
      metadata.session.last_heartbeat = now.toISOString();
      
      // Update lock heartbeat
      await updateLockHeartbeat(agentId);
      
      // Save metadata
      await updateMetadata(workspace.path, metadata);
      
    } catch (error) {
      console.error('Heartbeat error:', error);
    }
  }, HEARTBEAT_INTERVAL);
  
  console.error('💓 Heartbeat started (5 min intervals)');
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.error('💔 Heartbeat stopped');
  }
}

// Export for tool tracker to update
export { updateLastActivity as notifyActivity };