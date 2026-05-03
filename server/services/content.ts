/**
 * @file Content management service for cards, tokens, and decks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory storage for content
let cardDatabase: Record<string, any> = {};
let tokenDatabase: Record<string, any> = {};
let deckFiles: any[] = [];
let countersDatabase: Record<string, any> = {};

/**
 * Initialize content database from JSON file
 */
export async function initializeContent() {
  try {
    // Check if we're in a production build (dist-server)
    const isProduction = __dirname.includes('dist-server');

    // Try multiple possible paths for robustness in different environments
    const possiblePaths = isProduction
      ? [
          // Production: from dist-server/server/services/ to project/shared/content/
          // services -> server (1) -> dist-server (2) -> project root (3) -> shared/content/
          path.join(__dirname, '../../../shared/content/contentDatabase.json'),
          path.join(process.cwd(), 'shared/content/contentDatabase.json'),
        ]
      : [
          // Development: from server/services/ to shared/content/
          path.join(__dirname, '../../shared/content/contentDatabase.json'),
          path.join(process.cwd(), 'shared/content/contentDatabase.json'),
        ];

    let contentPath = null;
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        contentPath = testPath;
        break;
      }
    }

    if (!contentPath) {
      throw new Error(`Content database not found. Tried paths: ${possiblePaths.join(', ')}`);
    }

    const rawData = fs.readFileSync(contentPath, 'utf8');
    const data = JSON.parse(rawData);

    // Process ability text to convert literal \n to actual newlines
    const processAbilityText = (text: string): string => {
      if (typeof text !== 'string') {return text;}
      return text.replace(/\\n/g, '\n');
    };

    // Process card abilities
    const processCardAbilities = (cards: Record<string, any>) => {
      const processed: Record<string, any> = {};
      for (const [id, card] of Object.entries(cards)) {
        processed[id] = {
          ...card,
          abilityText: processAbilityText(card.abilityText),
          flavorText: processAbilityText(card.flavorText),
        };
      }
      return processed;
    };

    // Support both key formats (cards/cardDatabase, tokens/tokenDatabase)
    cardDatabase = processCardAbilities(data.cardDatabase || data.cards || {});
    tokenDatabase = processCardAbilities(data.tokenDatabase || data.tokens || {});
    deckFiles = data.deckFiles || [];
    countersDatabase = data.countersDatabase || data.counters || {};

    logger.info(`Loaded content from ${contentPath}: ${Object.keys(cardDatabase).length} cards, ${Object.keys(tokenDatabase).length} tokens, ${deckFiles.length} deck files`);
  } catch (error) {
    logger.error('Failed to initialize content database', error as Error);
    throw error;
  }
}

/**
 * Get card definition by ID
 */
export function getCardDefinition(cardId: string): any {
  return cardDatabase[cardId] || null;
}

/**
 * Get token definition by ID
 */
export function getTokenDefinition(tokenId: string): any {
  return tokenDatabase[tokenId] || null;
}

/**
 * Get counter definition by ID
 */
export function getCounterDefinition(counterId: string): any {
  return countersDatabase[counterId] || null;
}

/**
 * Get all available deck files
 */
export function getDeckFiles() {
  return deckFiles;
}

/**
 * Update content database (for development/hot reload)
 */
export async function updateContent(newContent: any) {
  try {
    // Process ability text to convert literal \n to actual newlines
    const processAbilityText = (text: string): string => {
      if (typeof text !== 'string') {return text;}
      return text.replace(/\\n/g, '\n');
    };

    // Process card abilities
    const processCardAbilities = (cards: Record<string, any>) => {
      const processed: Record<string, any> = {};
      for (const [id, card] of Object.entries(cards)) {
        processed[id] = {
          ...card,
          abilityText: processAbilityText(card.abilityText),
          flavorText: processAbilityText(card.flavorText),
        };
      }
      return processed;
    };

    cardDatabase = processCardAbilities(newContent.cards || {});
    tokenDatabase = processCardAbilities(newContent.tokens || {});
    deckFiles = newContent.deckFiles || [];
    countersDatabase = newContent.counters || {};

    logger.info('Content database updated');
  } catch (error) {
    logger.error('Failed to update content database', error as Error);
    throw error;
  }
}

/**
 * Get all cards (for API endpoints)
 */
export function getAllCards() {
  return cardDatabase;
}

/**
 * Get all tokens (for API endpoints)
 */
export function getAllTokens() {
  return tokenDatabase;
}

/**
 * Get all counters (for API endpoints)
 */
export function getAllCounters() {
  return countersDatabase;
}

/**
 * Set card database (for deck data updates)
 */
export function setCardDatabase(cards: Record<string, any>) {
  cardDatabase = cards;
}

/**
 * Set token database (for deck data updates)
 */
export function setTokenDatabase(tokens: Record<string, any>) {
  tokenDatabase = tokens;
}

/**
 * Set deck files (for deck data updates)
 */
export function setDeckFiles(decks: any[]) {
  deckFiles = decks;
}

// ============================================================================
// CARD ABILITIES SYSTEM
// ============================================================================

/**
 * Raw ability structure from contentDatabase.json
 */
export interface ContentAbility {
  type: 'deploy' | 'setup' | 'commit' | 'pass' | 'command'
  supportRequired?: boolean
  action?: string
  mode?: string | null
  actionType?: string
  details?: Record<string, any>
  // For command cards: option index (1-based)
  optionIndex?: number
  // For command cards: the text shown in the modal for this option
  optionText?: string
  steps?: Array<{
    action: string
    mode?: string | null
    details: Record<string, any>
  }>
}

/**
 * Get ABILITIES array for a card from contentDatabase
 * Also checks tokenDatabase for tokens (Recon Drone, Walking Turret, etc.)
 * @param baseId - The card's base ID
 * @returns Array of ContentAbility objects or empty array if not found
 */
export function getCardAbilities(baseId: string): ContentAbility[] {
  // First check card database
  const card = cardDatabase[baseId]
  if (card && card.ABILITIES) {
    return card.ABILITIES as ContentAbility[]
  }

  // Also check token database (for tokens like Recon Drone, Walking Turret)
  const token = tokenDatabase[baseId]
  if (token && token.ABILITIES) {
    return token.ABILITIES as ContentAbility[]
  }

  return []
}

/**
 * Get ability types for a card (deploy, setup, commit, pass)
 * @param baseId - The card's base ID
 * @returns Array of ability type strings
 */
export function getCardAbilityTypes(baseId: string): string[] {
  const abilities = getCardAbilities(baseId)
  const types = abilities.map(a => a.type)
  return [...new Set(types)]
}

/**
 * Check if card has a specific ability type
 * @param baseId - The card's base ID
 * @param type - The ability type to check
 * @returns true if card has this ability type
 */
export function hasCardAbilityType(baseId: string, type: 'deploy' | 'setup' | 'commit' | 'pass'): boolean {
  const abilities = getCardAbilities(baseId)
  return abilities.some(a => a.type === type)
}

/**
 * Get abilities of a specific type for a card
 * @param baseId - The card's base ID
 * @param type - The ability type to filter by
 * @returns Array of ContentAbility objects of the specified type
 */
export function getCardAbilitiesByType(
  baseId: string,
  type: 'deploy' | 'setup' | 'commit' | 'pass'
): ContentAbility[] {
  const abilities = getCardAbilities(baseId)
  return abilities.filter(a => a.type === type)
}

/**
 * Get card ability info for ready status system
 * @param baseId - The card's base ID
 * @returns CardAbilityInfo object
 */
export function getCardAbilityInfoFromContent(baseId: string): {
  hasDeployAbility: boolean
  hasSetupAbility: boolean
  hasCommitAbility: boolean
  setupRequiresSupport: boolean
  commitRequiresSupport: boolean
} {
  const abilities = getCardAbilities(baseId)

  const hasDeployAbility = abilities.some(a => a.type === 'deploy')
  const hasSetupAbility = abilities.some(a => a.type === 'setup')
  const hasCommitAbility = abilities.some(a => a.type === 'commit')

  const setupAbility = abilities.find(a => a.type === 'setup')
  const commitAbility = abilities.find(a => a.type === 'commit')

  return {
    hasDeployAbility,
    hasSetupAbility,
    hasCommitAbility,
    setupRequiresSupport: setupAbility?.supportRequired ?? false,
    commitRequiresSupport: commitAbility?.supportRequired ?? false,
  }
}

/**
 * Get token ABILITIES array from tokenDatabase
 * @param tokenId - The token's ID
 * @returns Array of ContentAbility objects or empty array if not found
 */
export function getTokenAbilities(tokenId: string): ContentAbility[] {
  const token = tokenDatabase[tokenId]
  if (!token || !token.ABILITIES) {
    return []
  }
  return token.ABILITIES as ContentAbility[]
}