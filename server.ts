import express from 'express';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());

// Known local spots dictionary for common family destinations in Ome / Nishitama
const KNOWN_SPOTS: Record<string, { name: string; address: string; lat: number; lng: number }> = {
  '担々麺杉山': {
    name: '担々麺杉山',
    address: '東京都青梅市今寺4丁目5-24',
    lat: 35.7972,
    lng: 139.3005
  },
  '担々麺スギヤマ': {
    name: '担々麺杉山',
    address: '東京都青梅市今寺4丁目5-24',
    lat: 35.7972,
    lng: 139.3005
  },
  '担々麺 杉山': {
    name: '担々麺杉山',
    address: '東京都青梅市今寺4丁目5-24',
    lat: 35.7972,
    lng: 139.3005
  },
  'らーめん ニューカッパ': {
    name: 'らーめん ニューカッパ',
    address: '東京都羽村市小作台1丁目11-6 NTKビル1F',
    lat: 35.7763,
    lng: 139.3019
  },
  'らーめんニューカッパ': {
    name: 'らーめん ニューカッパ',
    address: '東京都羽村市小作台1丁目11-6 NTKビル1F',
    lat: 35.7763,
    lng: 139.3019
  },
  'ニューカッパ': {
    name: 'らーめん ニューカッパ',
    address: '東京都羽村市小作台1丁目11-6 NTKビル1F',
    lat: 35.7763,
    lng: 139.3019
  },
  'カッパ64': {
    name: 'カッパ64',
    address: '東京都福生市志茂29-1',
    lat: 35.7335,
    lng: 139.3248
  },
  'いつ樹': {
    name: 'つけもあぶらも いつき',
    address: '東京都青梅市今寺4丁目21-2',
    lat: 35.7954,
    lng: 139.3032
  },
  'つけもあぶらも いつき': {
    name: 'つけもあぶらも いつき',
    address: '東京都青梅市今寺4丁目21-2',
    lat: 35.7954,
    lng: 139.3032
  },
  'らーめん 凛々': {
    name: 'らーめん 凛々',
    address: '東京都福生市福生1043-1',
    lat: 35.7424,
    lng: 139.3292
  },
  'すいぞくかん': {
    name: 'すいぞくかん',
    address: '東京都青梅市',
    lat: 35.795,
    lng: 139.26
  },
  'パンケーキの店': {
    name: 'パンケーキの店',
    address: '東京都青梅市青梅駅前',
    lat: 35.78,
    lng: 139.31
  }
};

/**
 * ウェブ上の検索スニペットから店舗の住所を推定・取得する関数
 */
async function searchWebForShopAddress(shopName: string): Promise<{ address: string; lat: number; lng: number } | null> {
  try {
    const searchQueries = [
      `${shopName} 住所`,
      `${shopName} 青梅 羽村 住所`
    ];

    for (const q of searchQueries) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ja,en;q=0.9'
        }
      });
      const text = await res.text();
      const snippets = [...text.matchAll(/class="result__snippet"[^>]*>(.*?)<\/a>/gs)].map((m) =>
        m[1].replace(/<[^>]+>/g, '').trim()
      );

      let foundAddr = '';

      // 1. "住所は東京都..." や "住所 東京都..."
      for (const s of snippets) {
        const clean = s.replace(/[\s\u3000]+/g, '');
        const m = clean.match(
          /住所(?:は|：|:)?((?:東京都|埼玉県|神奈川県|千葉県|北海道|(?:京都|大阪)府|.{2,3}県)[^,、。]{2,10}(?:市|区|町|村)[^,、。]{2,20}(?:[0-9０-９]+丁目|[0-9０-９]+-[0-9０-９]+|[0-9０-９]+番[0-9０-９]*号?)?)/
        );
        if (m) {
          foundAddr = m[1].replace(/[（\(\)）「」].*$/, '').trim();
          break;
        }
      }

      // 2. 都道府県 + 市区町村 + 町名
      if (!foundAddr) {
        for (const s of snippets) {
          const m = s.match(
            /(?:東京都|埼玉県|神奈川県|千葉県)\s*([^\s\(\)\/]{2,8}(?:市|区|町|村)\s*[^\s\(\)\/]{2,15}(?:[0-9０-９]+丁目|[0-9０-９]+-[0-9０-９]+|[0-9０-９]+番)?)/
          );
          if (m) {
            foundAddr = m[0].replace(/[（\(\)）「」].*$/, '').trim();
            break;
          }
        }
      }

      // 3. 市区町村 + 町名 (例: 羽村市小作台...)
      if (!foundAddr) {
        for (const s of snippets) {
          const m = s.match(
            /([^\s\(\)\/]{2,6}(?:市|区|町|村)\s*[^\s\(\)\/]{2,15}(?:[0-9０-９]+丁目|[0-9０-９]+-[0-9０-９]+|[0-9０-９]+番)?)/
          );
          if (m && !m[1].includes('ラーメン') && !m[1].includes('店舗') && !m[1].includes('情報')) {
            foundAddr = m[1].trim();
            break;
          }
        }
      }

      if (foundAddr) {
        // 国土地理院で座標検索
        const cleanGsiQuery = foundAddr
          .replace(/(?:ビル|号室|階|[0-9]+F|NTK).*$/, '')
          .replace(/[\s\u3000]+/g, '')
          .trim();
        const gsiRes = await fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(cleanGsiQuery)}`
        );
        const gsiData = await gsiRes.json();
        if (gsiData && gsiData.length > 0) {
          const coords = gsiData[0].geometry.coordinates;
          return {
            address: foundAddr,
            lat: coords[1],
            lng: coords[0]
          };
        }
      }
    }
  } catch (err) {
    console.warn('searchWebForShopAddress error:', err);
  }
  return null;
}

/**
 * 共有URL（share.google や Googleマップ短縮URL等）を解決して店名・住所・座標を返すAPI
 */
app.post('/api/resolve-url', async (req, res) => {
  try {
    const rawInput = String(req.body.url || '').trim();
    if (!rawInput) {
      return res.status(400).json({ error: 'URLまたは店名が指定されていません' });
    }

    let urlPart = '';
    let textHint = '';

    // URLを含む文字列からURLとテキストヒントを分離
    const urlMatch =
      rawInput.match(/(https?:\/\/[^\s]+)/i) ||
      rawInput.match(/(share\.google\/[^\s]+|maps\.app\.goo\.gl\/[^\s]+|goo\.gl\/maps\/[^\s]+)/i);
    if (urlMatch) {
      urlPart = urlMatch[1];
      textHint = rawInput.replace(urlPart, '').replace(/[\r\n\t]+/g, ' ').trim();
      if (!urlPart.startsWith('http://') && !urlPart.startsWith('https://')) {
        urlPart = 'https://' + urlPart;
      }
    } else if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
      urlPart = rawInput;
    } else {
      textHint = rawInput;
    }

    let resolvedName = textHint;
    let resolvedAddress = '';
    let lat: number | null = null;
    let lng: number | null = null;
    let finalTargetUrl = urlPart;

    if (urlPart) {
      try {
        const response = await fetch(urlPart, {
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'ja,en;q=0.9'
          }
        });

        finalTargetUrl = response.url || urlPart;

        // 1. Google Maps の座標パラメータ (@lat,lng)
        const coordMatch = finalTargetUrl.match(/@([0-9.]+),([0-9.]+)/);
        if (coordMatch) {
          lat = parseFloat(coordMatch[1]);
          lng = parseFloat(coordMatch[2]);
        }

        // 2. Google Maps の place名 (/place/店名/)
        const placeMatch = finalTargetUrl.match(/\/place\/([^/@?]+)/);
        if (placeMatch && !resolvedName) {
          resolvedName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        }

        // 3. Google 検索クエリ (?q=店名)
        if (!resolvedName) {
          try {
            const urlObj = new URL(finalTargetUrl);
            const q = urlObj.searchParams.get('q');
            if (q) resolvedName = q.trim();
          } catch {
            const qMatch = finalTargetUrl.match(/[?&]q=([^&]+)/);
            if (qMatch) {
              resolvedName = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
            }
          }
        }

        // 4. HTMLボディを読み取って /search?q= や タイトルを取得
        const bodyText = await response.text();
        if (!resolvedName) {
          const bodyQMatch =
            bodyText.match(/href="\/search\?q=([^&"'>\s]+)/) || bodyText.match(/[?&]q=([^&"'>\s]+)/);
          if (bodyQMatch) {
            resolvedName = decodeURIComponent(bodyQMatch[1].replace(/\+/g, ' ')).trim();
          }
        }

        if (!resolvedName) {
          const titleMatch = bodyText.match(/<title>(.*?)(?: - Google (?:検索|Maps))?<\/title>/i);
          if (titleMatch && titleMatch[1] && !titleMatch[1].includes('Google')) {
            resolvedName = titleMatch[1].trim();
          }
        }
      } catch (fetchErr) {
        console.warn('URL redirect fetch error:', fetchErr);
      }
    }

    // 既知のスポット辞書にあれば即座に返却（担々麺杉山、らーめんニューカッパなど）
    const lookupKeys = [resolvedName, textHint].filter(Boolean);
    for (const key of lookupKeys) {
      const cleanKey = key.replace(/[\s\u3000]+/g, '');
      for (const [dictKey, item] of Object.entries(KNOWN_SPOTS)) {
        if (cleanKey.includes(dictKey.replace(/[\s\u3000]+/g, '')) || dictKey.includes(cleanKey)) {
          return res.json({
            success: true,
            name: item.name,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            url: finalTargetUrl || urlPart
          });
        }
      }
    }

    // もし店名が判明していて座標や住所がない場合、WEB検索スニペットから店舗住所を探す
    if (resolvedName && (!lat || !lng || !resolvedAddress)) {
      const shopResult = await searchWebForShopAddress(resolvedName);
      if (shopResult) {
        resolvedAddress = shopResult.address;
        lat = shopResult.lat;
        lng = shopResult.lng;
      }
    }

    // 逆ジオコーディング（座標はあるが住所がない場合）
    if (lat && lng && !resolvedAddress) {
      try {
        const revUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
        const revResp = await fetch(revUrl, {
          headers: { 'User-Agent': 'KazokuYaritaiTabi/1.0', 'Accept-Language': 'ja' }
        });
        const revData = await revResp.json();
        if (revData && revData.display_name) {
          resolvedAddress = revData.display_name;
        }
      } catch (e) {
        console.warn('Reverse geocoding error:', e);
      }
    } else if (resolvedAddress && (!lat || !lng)) {
      // 住所が分かっていれば国土地理院で座標検索
      try {
        const gsiUrl = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
          resolvedAddress
        )}`;
        const gsiResp = await fetch(gsiUrl);
        const gsiData = await gsiResp.json();
        if (gsiData && gsiData.length > 0) {
          lng = gsiData[0].geometry?.coordinates?.[0] || null;
          lat = gsiData[0].geometry?.coordinates?.[1] || null;
        }
      } catch (e) {
        console.warn('GSI search error:', e);
      }
    }

    // ★重要: 不明な場合に偽の住所「〜付近」を返さない（「らーめん」だけがNominatimに渡って北千住へ飛ぶのを防ぐ）
    return res.json({
      success: Boolean(resolvedName || resolvedAddress),
      name: resolvedName || '行き先スポット',
      address: resolvedAddress || '',
      lat: lat,
      lng: lng,
      url: finalTargetUrl || urlPart
    });
  } catch (err: any) {
    console.error('URL resolution error:', err);
    return res.status(500).json({ error: err.message || 'URLの解決に失敗しました' });
  }
});

/**
 * Googleフォト共有アルバムURLから代表写真の画像URLを取得するAPI（ステップ3・6）
 */
app.post('/api/album-cover', async (req, res) => {
  try {
    const rawUrl = String(req.body.albumUrl || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'アルバムURLが指定されていません' });
    }

    let targetUrl = rawUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const response = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en;q=0.9'
      }
    });

    const text = await response.text();
    // Googleフォト共有アルバム内の写真URL（lh3.googleusercontent.com/pw/...）を検出
    const match = text.match(/(https:\/\/lh3\.googleusercontent\.com\/pw\/[a-zA-Z0-9_\-]+)/);
    if (match) {
      const photoUrl = match[1] + '=w800-no';
      return res.json({
        success: true,
        photoUrl: photoUrl,
        albumUrl: targetUrl
      });
    }

    return res.json({
      success: false,
      error: 'アルバムから代表画像を取得できませんでした'
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'アルバムの読み込みに失敗しました' });
  }
});

async function start() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started at http://localhost:${PORT}`);
  });
}

start();
