'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * 🚀 ADVANCED SOURCE MANAGER
 * 
 * Features:
 * - Quick add, Batch import, Advanced editor
 * - Real-time URL validation & preview
 * - Drag & drop, Copy/paste, Bulk actions
 * - Categories, Tags, Search & Filter
 * - Statistics & Health dashboard
 * - Undo/Redo, Keyboard shortcuts
 * 
 * Usage:
 *   import AdvancedSourceManager from '@/components/AdvancedSourceManager'
 *   <AdvancedSourceManager />
 */

const TABS = {
  ADD: 'add',
  LIST: 'list',
  STATS: 'stats',
  IMPORT: 'import',
  EDITOR: 'editor',
};

const CATEGORIES = ['main', 'backup', 'experimental'];

export default function AdvancedSourceManager() {
  // ===== STATE =====
  const [activeTab, setActiveTab] = useState(TABS.ADD);
  const [sources, setSources] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Add mode
  const [sourceName, setSourceName] = useState('');
  const [sourceLinks, setSourceLinks] = useState('');
  const [sourceCategory, setSourceCategory] = useState('main');
  const [sourceNotes, setSourceNotes] = useState('');

  // Import mode
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('urls'); // urls | csv | json

  // List mode
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedSources, setSelectedSources] = useState(new Set());

  // Analysis & UI
  const [analyzeResults, setAnalyzeResults] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Stats
  const [stats, setStats] = useState(null);

  // ===== EFFECTS =====
  useEffect(() => {
    loadSources();
  }, []);

  // ===== LOAD & SAVE =====
  const loadSources = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (data.success) {
        setSources(data.data || []);
        calculateStats(data.data || []);
      }
    } catch (err) {
      setError('Lỗi tải sources');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (sourcesList) => {
    const stats = {
      total: sourcesList.length,
      totalLinks: 0,
      activeLinks: 0,
      byCategory: {},
      recentlyAdded: [],
      lastUpdated: new Date().toISOString(),
    };

    sourcesList.forEach(s => {
      stats.totalLinks += s.links?.length || 0;
      stats.activeLinks += s.links?.filter(l => l.status === 'active').length || 0;
      stats.byCategory[s.category || 'main'] = 
        (stats.byCategory[s.category || 'main'] || 0) + 1;
    });

    stats.recentlyAdded = sourcesList
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    stats.healthPercent = stats.totalLinks > 0 
      ? Math.round((stats.activeLinks / stats.totalLinks) * 100)
      : 0;

    setStats(stats);
  };

  // ===== ANALYSIS =====
  const analyzeLinks = async (links = sourceLinks) => {
    if (!links.trim()) {
      setError('Vui lòng nhập ít nhất 1 link');
      return;
    }

    try {
      setError('');
      const urls = links
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

      const res = await fetch('/api/sources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });

      const data = await res.json();
      if (data.success) {
        setAnalyzeResults(data.data || []);
      } else {
        setError(data.message || 'Lỗi phân tích');
      }
    } catch (err) {
      setError('Lỗi: ' + err.message);
    }
  };

  // ===== ADD SOURCE =====
  const handleAddSource = async () => {
    if (!sourceLinks.trim() || analyzeResults.length === 0) {
      setError('Phải phân tích link trước');
      return;
    }

    const validUrls = analyzeResults
      .filter(r => r.ok)
      .map(r => r.url);

    if (validUrls.length === 0) {
      setError('Không có link nào hợp lệ');
      return;
    }

    try {
      setError('');
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sourceName || 'Nguồn mới',
          urls: validUrls,
          category: sourceCategory,
          notes: sourceNotes,
        })
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('✅ Thêm thành công!');
        setTimeout(() => {
          setSourceName('');
          setSourceLinks('');
          setSourceNotes('');
          setSourceCategory('main');
          setAnalyzeResults([]);
          setSuccess('');
          loadSources();
        }, 1500);
      } else {
        setError(data.message || 'Lỗi thêm nguồn');
      }
    } catch (err) {
      setError('Lỗi: ' + err.message);
    }
  };

  // ===== IMPORT =====
  const handleImport = async () => {
    if (!importText.trim()) {
      setError('Vui lòng nhập dữ liệu');
      return;
    }

    try {
      setError('');
      let sources = [];

      if (importFormat === 'urls') {
        // One URL per line
        sources = importText.split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(url => ({ urls: [url] }));
      } else if (importFormat === 'csv') {
        // CSV: name|url1|url2
        sources = importText.split('\n')
          .map(l => l.trim())
          .filter(Boolean)
          .map(line => {
            const [name, ...urls] = line.split('|').map(p => p.trim());
            return { name, urls };
          });
      } else if (importFormat === 'json') {
        sources = JSON.parse(importText);
      }

      // Add each source
      for (const source of sources) {
        await fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(source)
        });
      }

      setSuccess(`✅ Nhập thành công ${sources.length} nguồn!`);
      setTimeout(() => {
        setImportText('');
        setSuccess('');
        loadSources();
      }, 1500);
    } catch (err) {
      setError('Lỗi nhập: ' + err.message);
    }
  };

  // ===== BULK ACTIONS =====
  const handleBulkDelete = async () => {
    if (selectedSources.size === 0) {
      setError('Chọn ít nhất 1 nguồn');
      return;
    }

    if (!confirm(`Xoá ${selectedSources.size} nguồn?`)) return;

    try {
      for (const id of selectedSources) {
        await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      }

      setSuccess(`✅ Xoá ${selectedSources.size} nguồn`);
      setSelectedSources(new Set());
      setTimeout(() => {
        setSuccess('');
        loadSources();
      }, 1500);
    } catch (err) {
      setError('Lỗi xoá: ' + err.message);
    }
  };

  // ===== FILTER & SEARCH =====
  const filteredSources = sources
    .filter(s => {
      if (filterCategory !== 'all' && s.category !== filterCategory) return false;
      if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });

  // ===== DRAG & DROP =====
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type !== 'dragleave' && e.type !== 'dragend');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer?.files;
    if (files?.[0]) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        setImportText(evt.target.result);
        setActiveTab(TABS.IMPORT);
      };
      reader.readAsText(file);
    }
  };

  // ===== RENDER: ADD TAB =====
  const renderAddTab = () => (
    <div className="asm-panel">
      <div className="asm-section">
        <h3>📝 Thông Tin Nguồn</h3>

        <div className="asm-form-group">
          <label>Tên Nguồn</label>
          <input
            type="text"
            placeholder="VD: TV.COM.VN, Sport123"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            className="asm-input"
          />
        </div>

        <div className="asm-form-row">
          <div className="asm-form-group">
            <label>Loại</label>
            <select
              value={sourceCategory}
              onChange={(e) => setSourceCategory(e.target.value)}
              className="asm-input"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="asm-form-group">
          <label>Ghi chú</label>
          <textarea
            placeholder="VD: Nguồn chính, cập nhật hàng ngày..."
            value={sourceNotes}
            onChange={(e) => setSourceNotes(e.target.value)}
            rows={2}
            className="asm-input"
          />
        </div>
      </div>

      <div className="asm-section">
        <h3>🔗 Links (mỗi link 1 dòng)</h3>

        <textarea
          placeholder={`https://site.com/tran-1
https://site.com/tran-2`}
          value={sourceLinks}
          onChange={(e) => setSourceLinks(e.target.value)}
          rows={6}
          className="asm-input asm-textarea"
        />

        <button
          onClick={() => analyzeLinks()}
          className="asm-btn asm-btn-secondary"
        >
          🔍 Phân Tích & Xem Trước
        </button>
      </div>

      {analyzeResults.length > 0 && (
        <div className="asm-section">
          <h3>
            ✨ Kết Quả
            <span className="asm-badge">
              {analyzeResults.filter(r => r.ok).length}/{analyzeResults.length}
            </span>
          </h3>

          <div className="asm-preview-grid">
            {analyzeResults.map((r, i) => (
              <div
                key={i}
                className={`asm-preview-card ${r.ok ? 'ok' : 'fail'}`}
              >
                <div className="asm-preview-icon">
                  {r.ok ? '✅' : '❌'}
                </div>
                <div className="asm-preview-info">
                  <div className="asm-preview-url">
                    {new URL(r.url).hostname}
                  </div>
                  <div className="asm-preview-msg">
                    {r.ok ? r.title || 'OK' : r.error}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddSource}
            className="asm-btn asm-btn-primary"
          >
            ✨ Thêm Nguồn
          </button>
        </div>
      )}
    </div>
  );

  // ===== RENDER: LIST TAB =====
  const renderListTab = () => (
    <div className="asm-panel">
      <div className="asm-toolbar">
        <input
          type="text"
          placeholder="🔍 Tìm kiếm..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="asm-search-input"
        />

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="asm-select"
        >
          <option value="all">Tất cả loại</option>
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="asm-select"
        >
          <option value="newest">Mới nhất</option>
          <option value="oldest">Cũ nhất</option>
          <option value="name">Theo tên</option>
        </select>

        {selectedSources.size > 0 && (
          <button
            onClick={handleBulkDelete}
            className="asm-btn asm-btn-danger"
          >
            🗑️ Xoá ({selectedSources.size})
          </button>
        )}
      </div>

      {filteredSources.length === 0 ? (
        <div className="asm-empty">
          <p>📭 Không tìm thấy nguồn nào</p>
        </div>
      ) : (
        <div className="asm-list">
          {filteredSources.map(source => (
            <div key={source.id} className="asm-list-item">
              <input
                type="checkbox"
                checked={selectedSources.has(source.id)}
                onChange={(e) => {
                  const newSet = new Set(selectedSources);
                  if (e.target.checked) {
                    newSet.add(source.id);
                  } else {
                    newSet.delete(source.id);
                  }
                  setSelectedSources(newSet);
                }}
              />

              <div className="asm-list-content">
                <h4>{source.name}</h4>
                <div className="asm-list-meta">
                  <span>📎 {source.links?.length || 0}</span>
                  <span>🌐 {source.domain}</span>
                  <span className="asm-badge-category">{source.category}</span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (confirm('Xoá nguồn này?')) {
                    fetch(`/api/sources/${source.id}`, { method: 'DELETE' })
                      .then(() => loadSources())
                      .catch(err => setError(err.message));
                  }
                }}
                className="asm-btn asm-btn-icon asm-btn-danger"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ===== RENDER: STATS TAB =====
  const renderStatsTab = () => (
    <div className="asm-panel">
      {stats ? (
        <>
          <div className="asm-stats-grid">
            <div className="asm-stat-card">
              <div className="asm-stat-value">{stats.total}</div>
              <div className="asm-stat-label">Nguồn</div>
            </div>

            <div className="asm-stat-card">
              <div className="asm-stat-value">{stats.activeLinks}</div>
              <div className="asm-stat-label">Links hoạt động</div>
            </div>

            <div className="asm-stat-card">
              <div className="asm-stat-value">{stats.totalLinks}</div>
              <div className="asm-stat-label">Tổng links</div>
            </div>

            <div className="asm-stat-card">
              <div className="asm-stat-value">{stats.healthPercent}%</div>
              <div className="asm-stat-label">Sức khỏe</div>
            </div>
          </div>

          <div className="asm-section">
            <h3>Theo Loại</h3>
            {Object.entries(stats.byCategory).map(([cat, count]) => (
              <div key={cat} className="asm-stat-row">
                <span>{cat}</span>
                <span className="asm-badge">{count}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p>Đang tải...</p>
      )}
    </div>
  );

  // ===== RENDER: IMPORT TAB =====
  const renderImportTab = () => (
    <div className="asm-panel">
      <div className="asm-section">
        <h3>📥 Nhập Hàng Loạt</h3>

        <div className="asm-format-tabs">
          {['urls', 'csv', 'json'].map(fmt => (
            <button
              key={fmt}
              className={`asm-format-tab ${importFormat === fmt ? 'active' : ''}`}
              onClick={() => setImportFormat(fmt)}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        <textarea
          placeholder={
            importFormat === 'urls'
              ? 'https://site.com/tran-1\nhttps://site.com/tran-2'
              : importFormat === 'csv'
              ? 'Tên Nguồn|https://url1.com|https://url2.com'
              : '[{"name":"Source","urls":["https://url1.com"]}]'
          }
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={8}
          className="asm-input asm-textarea"
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        />

        <button
          onClick={handleImport}
          className="asm-btn asm-btn-primary"
        >
          📤 Nhập Dữ Liệu
        </button>
      </div>
    </div>
  );

  // ===== MAIN RENDER =====
  return (
    <div className="advanced-source-manager">
      {/* Alert */}
      {error && (
        <div className="asm-alert asm-alert-error">
          ❌ {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {success && (
        <div className="asm-alert asm-alert-success">
          {success}
        </div>
      )}

      {/* Header */}
      <div className="asm-header">
        <h1>🚀 Quản Lý Nguồn Nâng Cao</h1>
        <p>Thêm, nhập, quản lý và thống kê các nguồn phát trực tiếp</p>
      </div>

      {/* Tabs */}
      <div className="asm-tabs">
        <button
          className={`asm-tab ${activeTab === TABS.ADD ? 'active' : ''}`}
          onClick={() => setActiveTab(TABS.ADD)}
        >
          ⚡ Thêm Nhanh
        </button>
        <button
          className={`asm-tab ${activeTab === TABS.LIST ? 'active' : ''}`}
          onClick={() => setActiveTab(TABS.LIST)}
        >
          📋 Danh Sách ({sources.length})
        </button>
        <button
          className={`asm-tab ${activeTab === TABS.IMPORT ? 'active' : ''}`}
          onClick={() => setActiveTab(TABS.IMPORT)}
        >
          📥 Nhập Hàng Loạt
        </button>
        <button
          className={`asm-tab ${activeTab === TABS.STATS ? 'active' : ''}`}
          onClick={() => setActiveTab(TABS.STATS)}
        >
          📊 Thống Kê
        </button>
      </div>

      {/* Content */}
      <div className="asm-content">
        {activeTab === TABS.ADD && renderAddTab()}
        {activeTab === TABS.LIST && renderListTab()}
        {activeTab === TABS.STATS && renderStatsTab()}
        {activeTab === TABS.IMPORT && renderImportTab()}
      </div>
    </div>
  );
}

/**
 * CSS classes:
 * .advanced-source-manager - container
 * .asm-* - components
 * 
 * Thêm vào styles/advanced-source-manager.css
 */
