/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 家族のやりたいことリスト｜パンどろぼう×ほっかほっカーの旅
 * Google Apps Script サーバー側コード
 */

/**
 * スプレッドシートを取得（スクリプトプロパティ SPREADSHEET_ID またはアクティブシート）
 */
function getSpreadsheet_() {
  const propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (propId) {
    try {
      return SpreadsheetApp.openById(propId);
    } catch (e) {
      console.warn('Failed to open spreadsheet by SPREADSHEET_ID:', e);
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * シート「行き先」を取得（なければ「行き先リスト」または先頭シート）
 */
function getSheet_() {
  const ss = getSpreadsheet_();
  return ss.getSheetByName('行き先') || ss.getSheetByName('行き先リスト') || ss.getSheets()[0];
}

/**
 * Web Appのエントリーポイント (GET)
 */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  // JSON APIモード: ?action=list
  if (action === 'list') {
    const list = getDestinations();
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

  // Googleフォト共有アルバム代表写真取得API: ?action=albumCover&url=...
  if (action === 'albumCover' && e.parameter.url) {
    const res = getAlbumCover(e.parameter.url);
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
    if (url.includes('いつ樹')) {
      return {
        success: true,
        name: 'つけもあぶらも いつき',
        address: '東京都青梅市今寺4丁目21-2',
        lat: 35.7954,
        lng: 139.3032,
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
 * Googleフォト共有アルバムから代表写真の画像URLを取得（ステップ3・6）
 */
function getAlbumCover(albumUrl) {
  try {
    if (!albumUrl) return { success: false };
    const res = UrlFetchApp.fetch(albumUrl, { muteHttpExceptions: true });
    const content = res.getContentText();
    const match = content.match(/(https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9_\-]+)/);
    if (match) {
      return { success: true, photoUrl: match[1] + '=w800-no' };
    }
  } catch (e) {
    console.warn('Failed to fetch album cover:', e);
  }
  return { success: false };
}

/**
 * スプレッドシートから全件読み込み（ステップ4・5）
 */
function getDestinations() {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const colIndex = {
    id: headers.indexOf('id'),
    name: headers.indexOf('名前') >= 0 ? headers.indexOf('名前') : headers.indexOf('名称'),
    category: headers.indexOf('カテゴリ'),
    address: headers.indexOf('住所・最寄り') >= 0 ? headers.indexOf('住所・最寄り') : headers.indexOf('場所・住所'),
    poster: headers.indexOf('投稿者'),
    desire: headers.indexOf('行きたい度'),
    memo: headers.indexOf('メモ'),
    status: headers.indexOf('状態'),
    visitedDate: headers.indexOf('行った日'),
    visitedMemo: headers.indexOf('行ったメモ'),
    photoLink: headers.indexOf('写真リンク'),
    lat: headers.indexOf('緯度'),
    lng: headers.indexOf('経度'),
    url: headers.indexOf('紹介URL'),
    registeredAt: headers.indexOf('登録日・更新日') >= 0 ? headers.indexOf('登録日・更新日') : headers.indexOf('登録日時')
  };

  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const nameVal = colIndex.name >= 0 ? row[colIndex.name] : '';
    if (!nameVal) continue;

    list.push({
      id: colIndex.id >= 0 && row[colIndex.id] ? String(row[colIndex.id]) : `spot-${i}`,
      name: String(nameVal),
      category: colIndex.category >= 0 && row[colIndex.category] ? row[colIndex.category] : '場所',
      address: colIndex.address >= 0 ? String(row[colIndex.address] || '') : '',
      poster: colIndex.poster >= 0 ? String(row[colIndex.poster] || '') : '',
      desire: colIndex.desire >= 0 ? Number(row[colIndex.desire]) || 3 : 3,
      memo: colIndex.memo >= 0 ? String(row[colIndex.memo] || '') : '',
      status: colIndex.status >= 0 && row[colIndex.status] ? row[colIndex.status] : '行きたい',
      visitedDate: colIndex.visitedDate >= 0 ? String(row[colIndex.visitedDate] || '') : '',
      visitedMemo: colIndex.visitedMemo >= 0 ? String(row[colIndex.visitedMemo] || '') : '',
      albumUrl: colIndex.photoLink >= 0 ? String(row[colIndex.photoLink] || '') : '',
      latitude: colIndex.lat >= 0 && row[colIndex.lat] !== '' ? Number(row[colIndex.lat]) : null,
      longitude: colIndex.lng >= 0 && row[colIndex.lng] !== '' ? Number(row[colIndex.lng]) : null,
      url: colIndex.url >= 0 ? String(row[colIndex.url] || '') : '',
      registeredAt: colIndex.registeredAt >= 0 ? String(row[colIndex.registeredAt] || '') : ''
    });
  }
  return list;
}

// 互換性のためのエイリアス
function getDestinationList() {
  return getDestinations();
}

/**
 * 新規投稿の保存（ステップ4・5）
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
    lat,
    lng,
    formData.address || '',
    formData.poster || '',
    formData.desire || 3,
    formData.memo || '',
    '行きたい',
    '', // 行った日
    '', // 行ったメモ
    '', // 写真リンク
    formData.url || '',
    nowStr
  ]);

  return { success: true, id: id, lat: lat, lng: lng };
}

/**
 * 行った記録の登録（ステップ6）
 */
function markAsVisited(id, payload) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: false, error: 'データがありません' };

  const headers = data[0];
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('名前') >= 0 ? headers.indexOf('名前') : headers.indexOf('名称');
  const statusCol = headers.indexOf('状態');
  const visitedDateCol = headers.indexOf('行った日');
  const visitedMemoCol = headers.indexOf('行ったメモ');
  const photoCol = headers.indexOf('写真リンク');

  for (let r = 1; r < data.length; r++) {
    const rowId = idCol >= 0 ? data[r][idCol] : `spot-${r}`;
    if (String(rowId) === String(id) || (data[r][nameCol] && data[r][nameCol] === id)) {
      if (statusCol >= 0) sheet.getRange(r + 1, statusCol + 1).setValue('行った');
      if (visitedDateCol >= 0) sheet.getRange(r + 1, visitedDateCol + 1).setValue(payload.visitedDate || '');
      if (visitedMemoCol >= 0) sheet.getRange(r + 1, visitedMemoCol + 1).setValue(payload.visitedMemo || '');
      if (photoCol >= 0) sheet.getRange(r + 1, photoCol + 1).setValue(payload.albumUrl || '');
      return { success: true };
    }
  }
  return { success: false, error: '対象が見つかりませんでした' };
}
