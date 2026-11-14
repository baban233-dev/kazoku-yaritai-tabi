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
 * 権限承認用（エディタから一度だけ実行する）
 * UrlFetchApp（調べる・アルバム表紙取得）に必要な権限の承認ポップアップを出すための関数。
 */
function authorizeUrlFetch() {
  const res = UrlFetchApp.fetch('https://example.com', { muteHttpExceptions: true });
  Logger.log('status: ' + res.getResponseCode());
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

    // リダイレクトを手でたどり、Location URL から店名・座標の手がかりを集める。
    // （自動でたどると最終ページ＝検索ページがボット遮断され、本文からは何も取れない）
    let name = '';
    let foundLat = null;
    let foundLng = null;
    let current = url;
    const fetchHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9'
    };
    for (let hop = 0; hop < 6; hop++) {
      const res = UrlFetchApp.fetch(current, {
        followRedirects: false,
        muteHttpExceptions: true,
        headers: fetchHeaders
      });
      const code = res.getResponseCode();
      const loc = res.getHeaders()['Location'] || res.getHeaders()['location'] || '';
      if (code >= 300 && code < 400 && loc) {
        const clue = extractClueFromUrl_(loc);
        if (!name && clue.name) name = clue.name;
        if (foundLat === null && clue.lat !== null) { foundLat = clue.lat; foundLng = clue.lng; }
        current = loc;
        if (name) break;
        continue;
      }
      break;
    }

    // 店名が取れたら Geocoder で住所・座標を引く（座標がURLから取れた場合はそれを優先）
    let geo = null;
    if (name && foundLat === null) {
      geo = geocodeAddress_(name, name);
    }

    return {
      success: true,
      name: name || '行き先スポット',
      address: geo && geo.address ? geo.address : '',
      lat: foundLat !== null ? foundLat : (geo ? geo.lat : null),
      lng: foundLng !== null ? foundLng : (geo ? geo.lng : null),
      url: url
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * URL文字列から店名・座標の手がかりを抽出する（リダイレクト先URL用）
 */
function extractClueFromUrl_(u) {
  const out = { name: '', lat: null, lng: null };
  if (!u) return out;
  let s = String(u);
  try { s = decodeURIComponent(s); } catch (e) { /* そのまま使う */ }

  const placeMatch = s.match(/\/maps\/place\/([^\/@?]+)/);
  if (placeMatch) {
    out.name = placeMatch[1].replace(/\+/g, ' ').trim();
  }
  if (!out.name && (s.indexOf('/search') >= 0 || s.indexOf('maps') >= 0)) {
    const qm = s.match(/[?&]q=([^&]+)/) || s.match(/[?&]query=([^&]+)/);
    if (qm) {
      const cand = qm[1].replace(/\+/g, ' ').trim();
      // 共有トークン等のASCIIだけのIDは店名として採用しない
      if (/[^\x00-\x7F]/.test(cand) || cand.indexOf(' ') >= 0) out.name = cand;
    }
  }
  const atMatch = s.match(/@(-?\d{2,3}\.\d+),(-?\d{2,3}\.\d+)/);
  const bangMatch = s.match(/!3d(-?\d{2,3}\.\d+)!4d(-?\d{2,3}\.\d+)/);
  const cm = bangMatch || atMatch;
  if (cm) {
    out.lat = parseFloat(cm[1]);
    out.lng = parseFloat(cm[2]);
  }
  return out;
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
    registeredAt: headers.indexOf('登録日・更新日') >= 0 ? headers.indexOf('登録日・更新日') : (headers.indexOf('登録日時') >= 0 ? headers.indexOf('登録日時') : headers.indexOf('登録日'))
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

  // 列の並びはシートのヘッダー名で引く（位置決めで書くと列構成の違いで壊れるため）
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = {};
  headers.forEach((h, i) => { if (h) col[String(h)] = i; });
  const row = new Array(headers.length).fill('');
  const set = (headerNames, value) => {
    for (const hn of headerNames) {
      if (col[hn] !== undefined) { row[col[hn]] = value; return; }
    }
  };
  set(['id'], id);
  set(['名前', '名称'], formData.name);
  set(['カテゴリ'], formData.category || '場所');
  set(['緯度'], lat === null ? '' : lat);
  set(['経度'], lng === null ? '' : lng);
  set(['住所・最寄り', '場所・住所'], formData.address || '');
  set(['投稿者'], formData.poster || '');
  set(['行きたい度'], formData.desire || 3);
  set(['メモ'], formData.memo || '');
  set(['状態'], '行きたい');
  set(['紹介URL'], formData.url || '');
  set(['登録日・更新日', '登録日時', '登録日'], nowStr);
  set(['更新日'], nowStr);
  sheet.appendRow(row);

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

/**
 * 登録済みスポットの編集（基本情報の更新）
 * 住所が入っていればジオコーディングし直し、成功した場合のみ緯度・経度も更新する。
 */
function updateDestination(id, formData) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: false, error: 'データがありません' };

  const headers = data[0];
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('名前') >= 0 ? headers.indexOf('名前') : headers.indexOf('名称');
  const categoryCol = headers.indexOf('カテゴリ');
  const addressCol = headers.indexOf('住所・最寄り') >= 0 ? headers.indexOf('住所・最寄り') : headers.indexOf('場所・住所');
  const posterCol = headers.indexOf('投稿者');
  const memoCol = headers.indexOf('メモ');
  const urlCol = headers.indexOf('紹介URL');
  const latCol = headers.indexOf('緯度');
  const lngCol = headers.indexOf('経度');

  for (let r = 1; r < data.length; r++) {
    const rowId = idCol >= 0 ? data[r][idCol] : `spot-${r}`;
    if (String(rowId) === String(id) || (data[r][nameCol] && data[r][nameCol] === id)) {
      if (nameCol >= 0 && formData.name) sheet.getRange(r + 1, nameCol + 1).setValue(formData.name);
      if (categoryCol >= 0 && formData.category) sheet.getRange(r + 1, categoryCol + 1).setValue(formData.category);
      if (addressCol >= 0) sheet.getRange(r + 1, addressCol + 1).setValue(formData.address || '');
      if (posterCol >= 0 && formData.poster) sheet.getRange(r + 1, posterCol + 1).setValue(formData.poster);
      if (memoCol >= 0 && formData.memo !== undefined) sheet.getRange(r + 1, memoCol + 1).setValue(formData.memo || '');
      if (urlCol >= 0) sheet.getRange(r + 1, urlCol + 1).setValue(formData.url || '');

      let lat = null, lng = null;
      if (formData.latitude && formData.longitude) {
        // 「調べる」で解決済みの座標があればそれを優先する
        lat = formData.latitude; lng = formData.longitude;
      } else if (formData.address) {
        const geo = geocodeAddress_(formData.address, formData.name || data[r][nameCol]);
        if (geo) { lat = geo.lat; lng = geo.lng; }
      }
      if (lat !== null && lng !== null) {
        if (latCol >= 0) sheet.getRange(r + 1, latCol + 1).setValue(lat);
        if (lngCol >= 0) sheet.getRange(r + 1, lngCol + 1).setValue(lng);
      }
      return { success: true, lat: lat, lng: lng };
    }
  }
  return { success: false, error: '対象が見つかりませんでした' };
}

/**
 * 登録済みスポットの削除（行ごと削除）
 */
function deleteDestination(id) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: false, error: 'データがありません' };

  const headers = data[0];
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('名前') >= 0 ? headers.indexOf('名前') : headers.indexOf('名称');

  for (let r = 1; r < data.length; r++) {
    const rowId = idCol >= 0 ? data[r][idCol] : `spot-${r}`;
    if (String(rowId) === String(id) || (data[r][nameCol] && data[r][nameCol] === id)) {
      sheet.deleteRow(r + 1);
      return { success: true };
    }
  }
  return { success: false, error: '対象が見つかりませんでした' };
}
