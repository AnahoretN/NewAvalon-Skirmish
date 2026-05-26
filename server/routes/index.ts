/**
 * @file API routes configuration
 */

import { gameRoutes } from './game.js';
import { contentRoutes } from './content.js';
import { healthRoutes } from './health.js';

/**
 * Setup all API routes
 */
export function setupRoutes(app: any) {
  // Note: Static files are served in index.ts, not here

  // Health check routes
  app.use('/api/health', healthRoutes);

  // Game management routes
  app.use('/api/games', gameRoutes);

  // Content routes
  app.use('/api/content', contentRoutes);
}