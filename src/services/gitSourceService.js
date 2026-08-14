/**
 * 🔧 GIT SOURCE SERVICE
 * Handle reading/writing sources with automatic Git commits
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SOURCES_FILE = path.join(process.cwd(), 'data', 'sources.json');
const DATA_DIR = path.join(process.cwd(), 'data');

class GitSourceService {
  /**
   * Read sources from file
   */
  static readSources() {
    try {
      if (!fs.existsSync(SOURCES_FILE)) {
        return this.initSources();
      }
      return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading sources:', err);
      return this.initSources();
    }
  }

  /**
   * Write sources to file
   */
  static writeSources(data) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Create backup
      this.createBackup();

      // Write
      fs.writeFileSync(SOURCES_FILE, JSON.stringify(data, null, 2));
      data.updatedAt = new Date().toISOString();

      return { success: true, message: 'Sources saved successfully' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Create auto-backup
   */
  static createBackup() {
    try {
      if (!fs.existsSync(SOURCES_FILE)) return;

      const backupDir = path.join(DATA_DIR, 'backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `sources-${timestamp}.json`);
      fs.copyFileSync(SOURCES_FILE, backupFile);

      // Keep only 20 latest backups
      const backups = fs
        .readdirSync(backupDir)
        .filter(f => f.startsWith('sources-'))
        .sort()
        .reverse();

      backups.slice(20).forEach(f => {
        fs.unlinkSync(path.join(backupDir, f));
      });
    } catch (err) {
      console.error('Backup error:', err);
    }
  }

  /**
   * Initialize empty sources file
   */
  static initSources() {
    const init = {
      version: '1.0',
      updatedAt: new Date().toISOString(),
      sources: []
    };
    this.writeSources(init);
    return init;
  }

  /**
   * Generate unique source ID
   */
  static generateId(name) {
    const slug = String(name || 'source')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const hash = crypto.randomBytes(5).toString('hex');
    return `${slug || 'source'}-${hash}`;
  }

  /**
   * Add new source
   */
  static addSource(sourceData) {
    try {
      const sources = this.readSources();

      const newSource = {
        id: this.generateId(sourceData.name),
        name: sourceData.name || 'Untitled Source',
        domain: sourceData.domain || '',
        category: sourceData.category || 'main',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        links: (sourceData.urls || [])
          .filter(url => this.isValidUrl(url))
          .map(url => ({
            url,
            status: 'active',
            addedAt: new Date().toISOString()
          })),
        tags: sourceData.tags || [],
        notes: sourceData.notes || ''
      };

      if (newSource.links.length === 0) {
        return { success: false, message: 'No valid URLs provided' };
      }

      sources.sources.push(newSource);
      sources.updatedAt = new Date().toISOString();

      this.writeSources(sources);

      return {
        success: true,
        message: 'Source added successfully',
        source: newSource
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Get source by ID
   */
  static getSource(id) {
    const sources = this.readSources();
    return sources.sources.find(s => s.id === id);
  }

  /**
   * Delete source
   */
  static deleteSource(id) {
    try {
      const sources = this.readSources();
      const index = sources.sources.findIndex(s => s.id === id);

      if (index === -1) {
        return { success: false, message: 'Source not found' };
      }

      sources.sources.splice(index, 1);
      sources.updatedAt = new Date().toISOString();

      this.writeSources(sources);

      return { success: true, message: 'Source deleted' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Update source
   */
  static updateSource(id, updates) {
    try {
      const sources = this.readSources();
      const source = sources.sources.find(s => s.id === id);

      if (!source) {
        return { success: false, message: 'Source not found' };
      }

      // Update allowed fields
      if (updates.name) source.name = updates.name;
      if (updates.domain) source.domain = updates.domain;
      if (updates.category) source.category = updates.category;
      if (updates.notes) source.notes = updates.notes;
      if (updates.tags) source.tags = updates.tags;

      // Add new links
      if (updates.urls && Array.isArray(updates.urls)) {
        const newLinks = updates.urls
          .filter(url => this.isValidUrl(url))
          .filter(
            url => !source.links.some(l => l.url === url)
          )
          .map(url => ({
            url,
            status: 'active',
            addedAt: new Date().toISOString()
          }));

        source.links.push(...newLinks);
      }

      source.updatedAt = new Date().toISOString();
      sources.updatedAt = new Date().toISOString();

      this.writeSources(sources);

      return { success: true, message: 'Source updated', source };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Get all sources
   */
  static getAllSources() {
    const sources = this.readSources();
    return sources.sources;
  }

  /**
   * Validate URL
   */
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get statistics
   */
  static getStats() {
    const sources = this.readSources();
    const sourcesList = sources.sources;

    return {
      totalSources: sourcesList.length,
      totalLinks: sourcesList.reduce((sum, s) => sum + (s.links?.length || 0), 0),
      activeLinks: sourcesList.reduce(
        (sum, s) =>
          sum + (s.links?.filter(l => l.status === 'active').length || 0),
        0
      ),
      byCategory: sourcesList.reduce((acc, s) => {
        const cat = s.category || 'main';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
      lastUpdated: sources.updatedAt,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Export sources as JSON
   */
  static exportSources() {
    return this.readSources();
  }

  /**
   * Import sources from JSON
   */
  static importSources(data) {
    try {
      if (!data.sources || !Array.isArray(data.sources)) {
        return { success: false, message: 'Invalid import format' };
      }

      const current = this.readSources();
      let added = 0;
      let skipped = 0;

      data.sources.forEach(source => {
        // Check if exists
        if (current.sources.some(s => s.id === source.id)) {
          skipped++;
          return;
        }

        // Validate
        if (!source.name || !source.links || source.links.length === 0) {
          skipped++;
          return;
        }

        current.sources.push({
          ...source,
          createdAt: source.createdAt || new Date().toISOString(),
          updatedAt: source.updatedAt || new Date().toISOString()
        });

        added++;
      });

      current.updatedAt = new Date().toISOString();
      this.writeSources(current);

      return {
        success: true,
        message: `Imported ${added} sources, skipped ${skipped}`,
        added,
        skipped
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Search sources
   */
  static searchSources(query) {
    const sources = this.readSources();
    const q = query.toLowerCase();

    return sources.sources.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.domain.toLowerCase().includes(q) ||
      s.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Filter by category
   */
  static getByCategory(category) {
    const sources = this.readSources();
    return sources.sources.filter(s => s.category === category);
  }
}

module.exports = GitSourceService;
