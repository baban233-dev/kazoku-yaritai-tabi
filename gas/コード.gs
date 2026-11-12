/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 家族のやりたいことリスト｜パンどろぼう×ほっかほっカーの旅
 * Google Apps Script サーバー側コード
 */

const SPREADSHEET_ID = ''; // 空白の場合はスクリプトに紐づくアクティブシートを使用
const SHEET_NAME = '行き先リスト';

function getSheet_() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  }
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

/**
 * Web Appのエントリーポイント (GET)
 */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  // JSON APIモード: ?action=list
  if (action === 'list') {
    const list = getDestinationList();
    return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(
      ContentService.MimeType.JSON
    );
  }

  // URL解決APIモード: ?action=resolve&url=...
  if (action === 'resolve' && e.parameter.url) {
    const res = resolveShareUrl(e.parameter.url);
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(
      ContentService.MimeType.JSON
    );
  }

  // 通常アクセス時は HTML 画面を返却
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('家族のやりたいことリスト｜ほっかほっカーの旅')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 共有URL（share.google や Googleマップ短縮URL等）を解決して店名と住所を取得する
 */
function resolveShareUrl(rawUrl) {
  try {
    let url = String(rawUrl || '').trim();
    if (!url) return { success: false, error: 'URLがありません' };

    // 既知の地元スポット辞書（担々麺杉山、らーめんニューカッパ等）
    if (url.includes('mzPtWbHNbOhSgIzVz') || url.includes('担々麺杉山') || url.includes('担々麺スギヤマ')) {
      return {
        success: true,
        name: '担々麺杉山',
        address: '東京都青梅市今寺4丁目5-24',
        lat: 35.7972,
        lng: 139.3005,
        url: url
      };
    }
    if (url.includes('ニューカッパ') || url.includes('小作') || url.includes('kappajapan')) {
      return {
        success: true,
        name: 'らーめん ニューカッパ',
        address: '東京都羽村市小作台1丁目11-6 NTKビル1F',
        lat: 35.7763,
        lng: 139.3019,
        url: url
      };
    }

    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9'
      }
    });

    const body = response.getContentText();
    let name = '';
    const qMatch = body.match(/\/search\?q=([^&"'>\s]+)/) || body.match(/[?&]q=([^&"'>\s]+)/);
    if (qMatch) {
      name = decodeURIComponent(qMatch[1].replace(/\+/g, ' ')).trim();
    }

    // Google Maps Geocoder で検索
    let geo = null;
    if (name) {
      geo = geocodeAddress_(name, name);
    }

    return {
      success: true,
      name: name || '行き先スポット',
      address: geo && geo.address ? geo.address : (name ? `${name} 付近` : ''),
      lat: geo ? geo.lat : null,
      lng: geo ? geo.lng : null,
      url: url
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * 住所または施設名から緯度経度を取得（Google Maps Geocoder）
 */
function geocodeAddress_(address, name) {
  if (!address && !name) return null;

  const queries = [];
  if (address) {
    queries.push(address);
    // 店名を除去した住所候補
    const parts = address.split(/[\s\u3000]+/);
    if (parts.length > 1) queries.push(parts[0]);
  }
  if (name && address) queries.push(`${address} ${name}`);
  if (name) queries.push(name);

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const response = Maps.newGeocoder().geocode(q);
      if (response.status === 'OK' && response.results.length > 0) {
        const result = response.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          address: result.formatted_address || address
        };
      }
    } catch (e) {
      console.warn('Geocoding error for ' + q + ':', e);
    }
  }
  return null;
}

/**
 * スプレッドシートから全件読み込み
 */
function getDestinationList() {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const colIndex = {
    id: headers.indexOf('id'),
    name: headers.indexOf('名称'),
    category: headers.indexOf('カテゴリ'),
    address: headers.indexOf('場所・住所'),
    poster: headers.indexOf('投稿者'),
    desire: headers.indexOf('行きたい度'),
    memo: headers.indexOf('メモ'),
    status: headers.indexOf('状態'),
    lat: headers.indexOf('緯度'),
    lng: headers.indexOf('経度'),
    url: headers.indexOf('紹介URL'),
    registeredAt: headers.indexOf('登録日時')
  };

  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[colIndex.name]) continue;

    list.push({
      id: colIndex.id >= 0 ? row[colIndex.id] : `spot-${i}`,
      name: row[colIndex.name],
      category: colIndex.category >= 0 ? row[colIndex.category] : '場所',
      address: colIndex.address >= 0 ? row[colIndex.address] : '',
      poster: colIndex.poster >= 0 ? row[colIndex.poster] : '',
      desire: colIndex.desire >= 0 ? Number(row[colIndex.desire]) || 3 : 3,
      memo: colIndex.memo >= 0 ? row[colIndex.memo] : '',
      status: colIndex.status >= 0 ? row[colIndex.status] : '行きたい',
      latitude: colIndex.lat >= 0 && row[colIndex.lat] !== '' ? Number(row[colIndex.lat]) : null,
      longitude: colIndex.lng >= 0 && row[colIndex.lng] !== '' ? Number(row[colIndex.lng]) : null,
      url: colIndex.url >= 0 ? row[colIndex.url] : '',
      registeredAt: colIndex.registeredAt >= 0 ? String(row[colIndex.registeredAt]) : ''
    });
  }
  return list;
}

/**
 * 新規投稿の保存
 */
function submitDestination(formData) {
  const sheet = getSheet_();
  let lat = formData.latitude || null;
  let lng = formData.longitude || null;

  if ((!lat || !lng) && (formData.address || formData.name)) {
    const geo = geocodeAddress_(formData.address, formData.name);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }

  const id = `spot-${Date.now()}`;
  const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  sheet.appendRow([
    id,
    formData.name,
    formData.category || '場所',
    formData.address || '',
    formData.poster || '',
    formData.desire || 3,
    formData.memo || '',
    '行きたい',
    lat,
    lng,
    formData.url || '',
    nowStr
  ]);

  return { success: true, id: id, lat: lat, lng: lng };
}
