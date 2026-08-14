'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * ✨ COMPONENT THÊM NGUỒN CẢI TIẾN
 * 
 * Features:
 * - 2 modes: Quick (nhanh) + Advanced (chi tiết)
 * - Live preview của links khi đang nhập
 * - Drag & drop files
 * - Bulk import từ file
 * - Quản lý danh sách nguồn
 * 
 * Usage:
 *   import SourceManager from '@/components/SourceManager'
 *   <SourceManager />
 */

export default function SourceManager() {
  const [mode, setMode] = useState('quick'); // quick | advanced | list
  const [sources, setSources] = useState([]);
  
  // Form state - Quick mode
  const [sourceName, setSourceName] = useState('');
  const [sourceLinks, setSourceLinks] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  
  // UI state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [analyzeResults, setAnalyzeResults] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dragActive, setDragActive] = useState(false);

  // Load sources khi component mount
  useEffect(() => {
    fetchSources();
  }, []);

  const fetchSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (data.success) {
        setSources(data.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải sources:', err);
    }
  };

  const analyzeLinks = async (links = sourceLinks) => {
    if (!links.trim()) {
      setError('Vui lòng nhập ít nhất 1 link');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setSuccess('');
    setAnalyzeResults([]);

    try {
      const urls = links
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

      if (urls.length === 0) {
        setError('Không tìm thấy link nào');
        setIsAnalyzing(false);
        return;
      }

      // Gọi API phân tích
      const res = await fetch('/api/sources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });

      const data = await res.json();
      if (data.success) {
        setAnalyzeResults(data.data || []);
      } else {
        setError(data.message || 'Lỗi phân tích links');
      }
    } catch (err) {
      setError('Lỗi khi phân tích: ' + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddSource = async () => {
    if (!sourceLinks.trim()) {
      setError('Vui lòng nhập link');
      return;
    }

    if (!analyzeResults.some(r => r.ok)) {
      setError('Phải có ít nhất 1 link hợp lệ. Hãy phân tích lại.');
      return;
    }

    setIsAdding(true);
    setError('');

    try {
      const urls = sourceLinks
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sourceName || 'Nguồn mới',
          urls
        })
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('✅ Thêm nguồn thành công! Sẽ commit lên GitHub tự động.');
        
        // Reset form
        setTimeout(() => {
          setSourceName('');
          setSourceLinks('');
          setAnalyzeResults([]);
          setSuccess('');
          fetchSources();
        }, 1500);
      } else {
        setError(data.message || 'Lỗi thêm nguồn');
      }
    } catch (err) {
      setError('Lỗi: ' + err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xác nhận xoá nguồn này?\nHành động này không thể hoàn tác.')) {
      return;
    }

    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        setSuccess('Xoá thành công');
        fetchSources();
        setTimeout(() => setSuccess(''), 2000);
      } else {
        setError('Lỗi xoá nguồn');
      }
    } catch (err) {
      setError('Lỗi: ' + err.message);
    }
  };

  // Xử lý file upload
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setSourceLinks(text);
    analyzeLinks(text);
  };

  // Drag & drop
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer?.files;
    if (files?.[0]) {
      handleFileChange({ target: { files } });
    }
  };

  // ========== MODE 1: QUICK (Thêm nhanh) ==========
  if (mode === 'quick') {
    return (
      <div className="source-manager source-manager--quick">
        <div className="sm-card">
          <div className="sm-header">
            <div>
              <h2 className="sm-title">⚡ Thêm Nguồn Nhanh</h2>
              <p className="sm-subtitle">Dán link, phân tích, thêm – chỉ 3 bước!</p>
            </div>
            <div className="sm-tabs">
              <button
                className="sm-tab sm-tab--active"
                onClick={() => setMode('quick')}
              >
                ⚡ Nhanh
              </button>
              <button
                className="sm-tab"
                onClick={() => setMode('list')}
              >
                📋 Danh sách ({sources.length})
              </button>
            </div>
          </div>

          {/* Alerts */}
          {error && (
            <div className="sm-alert sm-alert--error">
              <span>❌</span> {error}
              <button
                className="sm-alert-close"
                onClick={() => setError('')}
              >
                ×
              </button>
            </div>
          )}

          {success && (
            <div className="sm-alert sm-alert--success">
              <span>✅</span> {success}
            </div>
          )}

          {/* Name input */}
          <div className="sm-form-group">
            <label className="sm-label">
              Tên Nguồn
              <span className="sm-optional"> (tùy chọn)</span>
            </label>
            <input
              type="text"
              placeholder="VD: TV.COM.VN, Sport123..."
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              className="sm-input"
            />
            <p className="sm-hint">
              Để trống → tự lấy tên từ domain
            </p>
          </div>

          {/* Links textarea */}
          <div className="sm-form-group">
            <label className="sm-label">
              Links (mỗi link 1 dòng)
            </label>
            <textarea
              placeholder={`https://site.com/tran-1
https://site.com/tran-2
https://site.com/tran-3`}
              value={sourceLinks}
              onChange={(e) => setSourceLinks(e.target.value)}
              rows={5}
              className="sm-textarea"
            />
            <p className="sm-hint">
              Hoặc <label htmlFor="file-upload" className="sm-link">chọn file text</label>
            </p>
            <input
              id="file-upload"
              type="file"
              accept=".txt"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          {/* Drag & drop area */}
          {!sourceLinks.trim() && (
            <div
              className={`sm-dropzone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <p>📂 Kéo file vào đây</p>
              <p className="sm-dropzone-hint">hoặc click chọn file</p>
              <input
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="sm-dropzone-input"
              />
            </div>
          )}

          {/* Preview */}
          {analyzeResults.length > 0 && (
            <div className="sm-section">
              <h3 className="sm-section-title">
                🔍 Kết quả phân tích
                <span className="sm-badge">
                  {analyzeResults.filter(r => r.ok).length}/{analyzeResults.length}
                </span>
              </h3>

              <div className="sm-preview">
                {analyzeResults.map((r, i) => (
                  <div
                    key={i}
                    className={`sm-preview-item ${r.ok ? 'ok' : 'fail'}`}
                    title={r.url}
                  >
                    <div className="sm-preview-icon">
                      {r.ok ? '✅' : '❌'}
                    </div>
                    <div className="sm-preview-content">
                      <div className="sm-preview-url">
                        {new URL(r.url).hostname}
                      </div>
                      <div className="sm-preview-msg">
                        {r.ok ? (
                          <>
                            Tìm thấy: <strong>{r.title || 'Live stream'}</strong>
                          </>
                        ) : (
                          r.error
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="sm-actions">
            <button
              onClick={() => analyzeLinks()}
              disabled={isAnalyzing || !sourceLinks.trim()}
              className="sm-btn sm-btn-secondary"
            >
              {isAnalyzing ? (
                <>
                  <i className="fa fa-spinner fa-spin" /> Đang phân tích...
                </>
              ) : (
                <>
                  <i className="fa fa-search" /> Xem Trước
                </>
              )}
            </button>

            {analyzeResults.some(r => r.ok) && (
              <button
                onClick={handleAddSource}
                disabled={isAdding}
                className="sm-btn sm-btn-primary"
              >
                {isAdding ? (
                  <>
                    <i className="fa fa-spinner fa-spin" /> Đang thêm...
                  </>
                ) : (
                  <>
                    <i className="fa fa-plus" /> Thêm Nguồn
                  </>
                )}
              </button>
            )}
          </div>

          {/* Info box */}
          <div className="sm-info">
            <p>
              <strong>💡 Mẹo:</strong> Hệ thống sẽ phân tích HTML của trang để tìm link .m3u8/.flv,
              sau đó tự động commit vào GitHub.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ========== MODE 2: LIST (Danh sách nguồn) ==========
  if (mode === 'list') {
    return (
      <div className="source-manager source-manager--list">
        <div className="sm-card">
          <div className="sm-header">
            <div>
              <h2 className="sm-title">📋 Danh Sách Nguồn</h2>
              <p className="sm-subtitle">Quản lý và xoá các nguồn đã thêm</p>
            </div>
            <div className="sm-tabs">
              <button
                className="sm-tab"
                onClick={() => setMode('quick')}
              >
                ⚡ Nhanh
              </button>
              <button
                className="sm-tab sm-tab--active"
                onClick={() => setMode('list')}
              >
                📋 Danh sách ({sources.length})
              </button>
            </div>
          </div>

          {error && (
            <div className="sm-alert sm-alert--error">
              <span>❌</span> {error}
            </div>
          )}

          {success && (
            <div className="sm-alert sm-alert--success">
              <span>✅</span> {success}
            </div>
          )}

          {sources.length === 0 ? (
            <div className="sm-empty">
              <p>📭 Chưa có nguồn nào</p>
              <button
                onClick={() => setMode('quick')}
                className="sm-btn sm-btn-primary"
              >
                ➕ Thêm Nguồn Đầu Tiên
              </button>
            </div>
          ) : (
            <>
              <div className="sm-list">
                {sources.map((source) => (
                  <div key={source.id} className="sm-list-item">
                    <div className="sm-list-content">
                      <h3 className="sm-list-name">{source.name}</h3>
                      <div className="sm-list-meta">
                        <span className="sm-meta-item">
                          <i className="fa fa-link" /> {source.links?.length || 0} links
                        </span>
                        <span className="sm-meta-item">
                          <i className="fa fa-globe" /> {source.domain}
                        </span>
                        <span className="sm-meta-item">
                          <i className="fa fa-calendar" />
                          {' '}
                          {new Date(source.createdAt).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(source.id)}
                      className="sm-btn sm-btn-danger sm-btn-icon"
                      title="Xoá"
                    >
                      <i className="fa fa-trash" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setMode('quick')}
                className="sm-btn sm-btn-primary"
              >
                ➕ Thêm Nguồn Mới
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
}

/**
 * ========================================
 * CSS sử dụng các class: .source-manager, .sm-*
 * Thêm vào styles/globals.css
 * ========================================
 */
