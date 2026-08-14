/**
 * Cấu hình tất cả các services (Pháo Hoa, Xoilac, AFF Cup, Custom Sources)
 * 
 * USAGE:
 * import { getActiveServices, getServiceConfig } from '@/src/config/services.config';
 * 
 * const services = getActiveServices();
 * services.forEach(({ name, service, enabled }) => {
 *   console.log(`${name}: ${enabled ? '✅' : '⚠️'}`);
 * });
 */

// Import tất cả services
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacService from '@/src/services/xoilac.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import vsc9Service from '@/src/services/vsc9.service';
import giovangService from '@/src/services/giovang.service';
import customSourceService from '@/src/services/customSource.service';

/**
 * Cấu hình chi tiết cho mỗi service
 */
export const SERVICES_CONFIG = {
  phaohoa: {
    name: 'Pháo Hoa',
    slug: 'phaohoa',
    baseUrl: 'https://phaohoa1.live',
    type: 'api',
    enabled: true,
    description: 'Phát sóng trực tiếp bóng đá từ Pháo Hoa',
    priority: 1,
    icon: 'fa-fire',
    color: '#FF6B6B',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: true,
      commentators: true,
      sports: ['football', 'basketball', 'volleyball', 'tennis', 'badminton', 'esports']
    }
  },

  xoilac: {
    name: 'Xoilac',
    slug: 'xoilac',
    baseUrl: 'https://xoilacxtx.tv',
    type: 'scrape',
    enabled: true,
    description: 'Trực tiếp bóng đá từ Xoilac',
    priority: 2,
    icon: 'fa-tv',
    color: '#4ECDC4',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: true,
      commentators: true,
      sports: ['football', 'basketball', 'volleyball', 'tennis', 'badminton', 'esports']
    }
  },

  'xoilac-affcup': {
    name: 'Xoilac AFF Cup 2026',
    slug: 'xoilac-affcup',
    baseUrl: 'https://xoilacbongda-affcup2026b.live',
    type: 'scrape',
    enabled: true,
    description: 'AFF Cup 2026 - Giải đấu bóng đá Southeast Asia',
    priority: 3,
    icon: 'fa-trophy',
    color: '#FFD93D',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: false,
      commentators: false,
      sports: ['football']
    }
  },

  '90phut': {
    name: '90 Phút TV',
    slug: '90phut',
    baseUrl: 'https://90phutzc.tv',
    type: 'scrape',
    enabled: true,
    description: 'Xem bóng đá trực tiếp 90 phút',
    priority: 4,
    icon: 'fa-clock',
    color: '#56CFE1',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: true,
      commentators: false,
      sports: ['football']
    }
  },

  vsc9: {
    name: 'VuaSanCo (VSC9)',
    slug: 'vsc9',
    baseUrl: 'https://vsc9.vip',
    type: 'scrape',
    // Site chặn bot ở tầng WAF (403 kể cả headless browser) — tắt khỏi danh
    // sách nguồn đang dùng thay vì xoá code/file, phòng khi sau này gỡ chặn.
    enabled: false,
    description: 'Trực tiếp bóng đá từ VuaSanCo',
    priority: 5,
    icon: 'fa-futbol',
    color: '#22C55E',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: true,
      commentators: true,
      sports: ['football']
    }
  },

  giovang: {
    name: 'Giờ Vàng TV',
    slug: 'giovang',
    baseUrl: 'https://giovang.city',
    type: 'api',
    enabled: true,
    description: 'Trực tiếp bóng đá từ Giờ Vàng TV (Giovang)',
    priority: 5,
    icon: 'fa-futbol',
    color: '#F5B301',
    features: {
      liveMatches: true,
      upcomingMatches: true,
      hotMatches: true,
      commentators: true,
      sports: ['football', 'basketball', 'volleyball', 'tennis']
    }
  },

  'custom-sources': {
    name: 'Nguồn Tùy Chỉnh',
    slug: 'custom-sources',
    baseUrl: null,
    type: 'custom',
    enabled: true,
    description: 'Các nguồn phát trực tiếp được thêm tùy chỉnh bởi người dùng',
    priority: 10,
    icon: 'fa-link',
    color: '#95E1D3',
    features: {
      liveMatches: true,
      upcomingMatches: false,
      hotMatches: false,
      commentators: false,
      sports: ['football', 'custom']
    }
  }
};

/**
 * Ánh xạ service objects
 */
export const SERVICES_MAP = {
  phaohoa: phaohoaService,
  xoilac: xoilacService,
  'xoilac-affcup': xoilacAffcupService,
  '90phut': ninetyService,
  vsc9: vsc9Service,
  giovang: giovangService,
  'custom-sources': customSourceService
};

/**
 * Lấy tất cả services đang hoạt động
 * @returns {Array} Danh sách services
 */
export function getActiveServices() {
  return Object.entries(SERVICES_CONFIG)
    .filter(([_, config]) => config.enabled)
    .map(([key, config]) => ({
      key,
      ...config,
      service: SERVICES_MAP[key]
    }))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Lấy service bằng slug
 * @param {string} slug - Slug của service
 * @returns {Object|null} Config của service hoặc null
 */
export function getServiceConfig(slug) {
  return SERVICES_CONFIG[slug] || null;
}

/**
 * Lấy service object bằng slug
 * @param {string} slug - Slug của service
 * @returns {Object|null} Service object hoặc null
 */
export function getServiceBySlug(slug) {
  return SERVICES_MAP[slug] || null;
}

/**
 * Kiểm tra service có hoạt động không
 * @param {string} slug - Slug của service
 * @returns {boolean} True nếu hoạt động
 */
export function isServiceEnabled(slug) {
  const config = SERVICES_CONFIG[slug];
  return config?.enabled || false;
}

/**
 * Lấy thông tin chi tiết của service
 * @param {string} slug - Slug của service
 * @returns {Object} Đầy đủ thông tin service
 */
export function getServiceInfo(slug) {
  const config = SERVICES_CONFIG[slug];
  if (!config) return null;

  return {
    ...config,
    service: SERVICES_MAP[slug],
    url: `/api/${slug}/live`,
    streamUrl: `/api/${slug}/stream`,
    isAvailable: !!SERVICES_MAP[slug]
  };
}

/**
 * Lấy thông tin tất cả services (cho dashboard/admin)
 * @returns {Array} Danh sách đầy đủ thông tin
 */
export function getAllServicesInfo() {
  return Object.keys(SERVICES_CONFIG).map(slug => getServiceInfo(slug));
}

/**
 * Thống kê services
 * @returns {Object} Thống kê
 */
export function getServicesStats() {
  const all = Object.values(SERVICES_CONFIG);
  const enabled = all.filter(s => s.enabled);
  const sports = new Set();
  
  all.forEach(s => {
    if (s.features?.sports) {
      s.features.sports.forEach(sport => sports.add(sport));
    }
  });

  return {
    total: all.length,
    enabled: enabled.length,
    disabled: all.length - enabled.length,
    types: {
      api: all.filter(s => s.type === 'api').length,
      scrape: all.filter(s => s.type === 'scrape').length,
      custom: all.filter(s => s.type === 'custom').length
    },
    sports: Array.from(sports),
    features: {
      liveMatches: enabled.filter(s => s.features?.liveMatches).length,
      upcomingMatches: enabled.filter(s => s.features?.upcomingMatches).length,
      hotMatches: enabled.filter(s => s.features?.hotMatches).length,
      commentators: enabled.filter(s => s.features?.commentators).length
    }
  };
}

/**
 * Export default
 */
export default {
  SERVICES_CONFIG,
  SERVICES_MAP,
  getActiveServices,
  getServiceConfig,
  getServiceBySlug,
  isServiceEnabled,
  getServiceInfo,
  getAllServicesInfo,
  getServicesStats
};
