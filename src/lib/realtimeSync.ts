import React from 'react';

/**
 * Real-time Synchronization System
 * Provides zero-latency sync between Party List and Label Print sections
 */

export interface SyncEvent {
  type: 'create' | 'update' | 'delete';
  entityType: 'party_list' | 'label_print' | 'scan_tally';
  entityId: string;
  data?: any;
  timestamp: number;
  source: string;
}

export interface SyncListener {
  id: string;
  callback: (event: SyncEvent) => void;
  entityTypes: string[];
}

class RealtimeSyncManager {
  private listeners: Map<string, SyncListener> = new Map();
  private eventQueue: SyncEvent[] = [];
  private isProcessing = false;
  private retryAttempts = new Map<string, number>();
  private maxRetries = 3;
  private syncDelay = 50; // 50ms for batching

  /**
   * Register a listener for sync events
   */
  subscribe(listener: SyncListener): () => void {
    this.listeners.set(listener.id, listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener.id);
    };
  }

  /**
   * Emit a sync event to all relevant listeners
   */
  emit(event: SyncEvent): void {
    // Add to queue for batch processing
    this.eventQueue.push(event);
    
    // Process queue with minimal delay
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process queued events with batching for performance
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) return;
    
    this.isProcessing = true;
    
    try {
      // Process events in batches
      const batch = this.eventQueue.splice(0, 10); // Process up to 10 events at once
      
      await Promise.all(
        batch.map(event => this.processEvent(event))
      );
      
      // Continue processing if more events are queued
      if (this.eventQueue.length > 0) {
        setTimeout(() => this.processQueue(), this.syncDelay);
      }
    } catch (error) {
      console.error('Error processing sync queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process individual sync event
   */
  private async processEvent(event: SyncEvent): Promise<void> {
    const relevantListeners = Array.from(this.listeners.values()).filter(
      listener => listener.entityTypes.includes(event.entityType)
    );

    // Execute callbacks with error handling
    await Promise.allSettled(
      relevantListeners.map(async listener => {
        try {
          await listener.callback(event);
          // Reset retry count on success
          this.retryAttempts.delete(`${listener.id}-${event.timestamp}`);
        } catch (error) {
          console.error(`Sync error for listener ${listener.id}:`, error);
          await this.handleSyncError(listener, event, error);
        }
      })
    );
  }

  /**
   * Handle sync errors with retry logic
   */
  private async handleSyncError(
    listener: SyncListener, 
    event: SyncEvent, 
    error: any
  ): Promise<void> {
    const retryKey = `${listener.id}-${event.timestamp}`;
    const attempts = this.retryAttempts.get(retryKey) || 0;

    if (attempts < this.maxRetries) {
      this.retryAttempts.set(retryKey, attempts + 1);
      
      // Exponential backoff
      const delay = Math.pow(2, attempts) * 100;
      
      setTimeout(async () => {
        try {
          await listener.callback(event);
          this.retryAttempts.delete(retryKey);
        } catch (retryError) {
          console.error(`Retry ${attempts + 1} failed for listener ${listener.id}:`, retryError);
          await this.handleSyncError(listener, event, retryError);
        }
      }, delay);
    } else {
      console.error(`Max retries exceeded for listener ${listener.id}, event:`, event);
      this.retryAttempts.delete(retryKey);
    }
  }

  /**
   * Force sync all data (fallback mechanism)
   */
  async forceSyncAll(): Promise<void> {
    const event: SyncEvent = {
      type: 'update',
      entityType: 'party_list',
      entityId: 'all',
      timestamp: Date.now(),
      source: 'force-sync'
    };

    this.emit(event);
  }

  /**
   * Get sync statistics
   */
  getStats(): {
    activeListeners: number;
    queuedEvents: number;
    isProcessing: boolean;
    retryCount: number;
  } {
    return {
      activeListeners: this.listeners.size,
      queuedEvents: this.eventQueue.length,
      isProcessing: this.isProcessing,
      retryCount: this.retryAttempts.size
    };
  }
}

// Global sync manager instance
export const syncManager = new RealtimeSyncManager();

/**
 * Hook for React components to use real-time sync
 */
export function useRealtimeSync(
  entityTypes: string[],
  callback: (event: SyncEvent) => void,
  dependencies: any[] = [],
  debugName?: string
): void {
  React.useEffect(() => {
    const listenerId = `listener-${Date.now()}-${Math.random()}`;
    
    if (debugName) {
      console.log(`Setting up sync listener: ${debugName} (${listenerId})`);
    }
    
    const unsubscribe = syncManager.subscribe({
      id: listenerId,
      callback,
      entityTypes
    });

    return unsubscribe;
  }, dependencies);
}

/**
 * Utility to emit sync events from components
 */
export function emitSyncEvent(
  type: SyncEvent['type'],
  entityType: SyncEvent['entityType'],
  entityId: string,
  data?: any,
  source: string = 'component'
): void {
  syncManager.emit({
    type,
    entityType,
    entityId,
    data,
    timestamp: Date.now(),
    source
  });
}

/**
 * Performance monitoring for sync operations
 */
export class SyncPerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  startTiming(operation: string): () => void {
    const startTime = performance.now();
    
    return () => {
      const duration = performance.now() - startTime;
      
      if (!this.metrics.has(operation)) {
        this.metrics.set(operation, []);
      }
      
      const times = this.metrics.get(operation)!;
      times.push(duration);
      
      // Keep only last 100 measurements
      if (times.length > 100) {
        times.shift();
      }
      
      // Log if sync is too slow
      if (duration > 100) {
        console.warn(`Slow sync operation: ${operation} took ${duration.toFixed(2)}ms`);
      }
    };
  }

  getAverageTime(operation: string): number {
    const times = this.metrics.get(operation);
    if (!times || times.length === 0) return 0;
    
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  getMetrics(): Record<string, { average: number; count: number; max: number }> {
    const result: Record<string, { average: number; count: number; max: number }> = {};
    
    for (const [operation, times] of this.metrics.entries()) {
      result[operation] = {
        average: this.getAverageTime(operation),
        count: times.length,
        max: Math.max(...times)
      };
    }
    
    return result;
  }
}

export const performanceMonitor = new SyncPerformanceMonitor();