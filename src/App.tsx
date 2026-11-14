/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Plus, X, Move, Check, ExternalLink, Link2, Search, MapPin, AlertCircle, Camera, Calendar, Sparkles } from 'lucide-react';

interface DestinationItem {
  id: string;
  name: string;
  category: '場所' | '店' | 'やりたいこと';
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  url?: string;
  poster: string;
  desire: number;
  memo?: string;
  status: '行きたい' | '行った';
  visitedDate?: string;
  visitedMemo?: string;
  albumUrl?: string;
  photoUrl?: string;
  registeredAt?: string;
}

const INITIAL_SPOTS: DestinationItem[] = [
  {
    id: 'spot-newkappa',
    name: 'らーめん ニューカッパ',
    category: '店',
    latitude: 35.7763,
    longitude: 139.3019,
    address: '東京都羽村市小作台1丁目11-6 NTKビル1F',
    url: 'https://kappajapan.com/',
    poster: '👨 かずや',
    desire: 5,
    memo: '青梅線小作駅すぐ！名物トマトラーメン＆チーズご飯のシメが最高',
    status: '行きたい',
    registeredAt: '2026-11-12'
  },
  {
    id: 'spot-sugiyama',
    name: '担々麺杉山',
    category: '店',
    latitude: 35.7972,
    longitude: 139.3005,
    address: '東京都青梅市今寺4丁目5-24',
    url: 'https://share.google/mzPtWbHNbOhSgIzVz',
    poster: '👨 かずや',
    desire: 5,
    memo: 'エビ出汁の効いた名物担々麺！ロースカツトッピングが最高',
    status: '行きたい',
    registeredAt: '2026-11-11'
  },
  {
    id: 'spot-1',
    name: 'すいぞくかん',
    category: '場所',
    latitude: 35.795,
    longitude: 139.26,
    address: '青梅市',
    poster: '👦 れん',
    desire: 4,
    memo: 'イルカショーやペンギンが見たい！',
    status: '行きたい',
    registeredAt: '2026-11-08'
  },
  {
    id: 'spot-2',
    name: 'パンケーキの店',
    category: '店',
    latitude: 35.78,
    longitude: 139.31,
    address: '青梅駅前',
    poster: '👧 あやみ',
    desire: 5,
    memo: 'ふわふわの焼きたてスフレパンケーキ🥞',
    status: '行きたい',
    registeredAt: '2026-11-09'
  },
  {
    id: 'spot-3',
    name: 'ゆうえんち（あきる野）',
    category: '場所',
    latitude: 35.82,
    longitude: 139.28,
    address: '東京都あきる野市',
    poster: '👦 けんた',
    desire: 4,
    memo: 'みんなで観覧車に乗ったよ！',
    status: '行った',
    visitedDate: '2026-11-10',
    visitedMemo: '青空の下で乗った大観覧車が最高でした！みんなでソフトクリームも食べたよ🍦',
    albumUrl: 'https://photos.app.goo.gl/sample-album',
    photoUrl: 'https://images.unsplash.com/photo-1513889961551-628c1e5e2ee9?auto=format&fit=crop&w=800&q=80',
    registeredAt: '2026-11-05'
  }
];

/**
 * 住所クエリとして妥当か（「らーめん」などの単語単体で北千住や見知らぬ場所へ飛ぶのを防ぐ）
 */
function isValidJapaneseAddressQuery(query: string): boolean {
  if (!query) return false;
  const q = query.trim();

  // 住所ではない一般的な単語をブラックリスト
  const blacklist = [
    'らーめん', 'ラーメン', 'つけ麺', 'うどん', 'そば', 'カフェ', '店', '居酒屋',
    '公園', '付近', '行きたい', '場所', 'やりたいこと', 'すいぞくかん', '水族館', 'ゆうえんち', '遊園地'
  ];
  if (blacklist.includes(q)) return false;
  if (q.endsWith('付近') && !/(?:都|道|府|県|市|区|町|村)/.test(q)) return false;

  // 都道府県・市区町村・丁目・番地などの行政地名を含む必要がある
  return /(?:東京都|埼玉県|神奈川県|千葉県|北海道|(?:京都|大阪)府|.{2,3}県|市|区|町|村|丁目|-|[0-9０-９]+番|[0-9０-９]+号)/.test(
    q
  );
}

/**
 * 日本の住所を段階的に正規化・分割して精密に緯度経度を検索する関数
 */
async function resolveJapaneseCoordinates(
  rawAddress: string,
  name: string
): Promise<{ lat: number; lng: number } | null> {
  const clean = (s: string) => s.replace(/[\u3000\s]+/g, ' ').trim();
  const raw = clean(rawAddress);

  const candidates: string[] = [];

  if (raw && isValidJapaneseAddressQuery(raw)) {
    // 1. 入力そのまま
    candidates.push(raw);

    // 2. スペースで区切られた店名や建物名を除去した住所部分（住所として妥当な場合のみ）
    const parts = raw.split(' ');
    if (parts.length > 1 && isValidJapaneseAddressQuery(parts[0])) {
      candidates.push(parts[0]);
    }

    // 3. 番地・号を除去して「丁目」までにする（OpenStreetMap/国土地理院で確実にヒットする）
    const addrMain = parts[0];
    const chomeMatch = addrMain.match(
      /^(.*?[0-9０-９]+(?:丁目|-))(?:[0-9０-９]+(?:-[0-9０-９]+|番[0-9０-９]*号?)?)?/
    );
    if (chomeMatch && isValidJapaneseAddressQuery(chomeMatch[1])) {
      let chome = chomeMatch[1].replace(/-$/, '');
      if (!chome.endsWith('丁目')) chome += '丁目';
      candidates.push(chome);
    }

    // 4. 町名まで
    const townMatch = addrMain.match(/^(.*?(?:市|区|町|村)[^0-9０-９]+)/);
    if (townMatch && isValidJapaneseAddressQuery(townMatch[1])) {
      candidates.push(townMatch[1]);
    }
  }

  // 5. 市区町村 ＋ 名称
  if (name && raw) {
    const cityMatch = raw.match(/^(.*?(?:市|区|町|村))/);
    if (cityMatch) {
      candidates.push(`${cityMatch[1]} ${name}`);
    }
  }

  // 重複を除去し、妥当な住所クエリのみを残す
  const uniqueQueries = Array.from(new Set(candidates)).filter(isValidJapaneseAddressQuery);

  // 国土地理院（日本国内の高精度ジオコーディング）を優先試行
  for (const q of uniqueQueries) {
    try {
      const gsiUrl = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
        q
      )}`;
      const resp = await fetch(gsiUrl);
      const data = await resp.json();
      if (data && data.length > 0 && data[0].geometry?.coordinates) {
        const [lng, lat] = data[0].geometry.coordinates;
        if (!isNaN(lat) && !isNaN(lng)) {
          return { lat, lng };
        }
      }
    } catch {
      // 次の候補を試行
    }
  }

  // OpenStreetMap Nominatim にフォールバック（東京・多摩・西多摩エリアのviewbox制約）
  for (const q of uniqueQueries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        q
      )}&format=json&limit=1&viewbox=138.8,35.4,139.6,36.1`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'KazokuYaritaiTabi/1.0', Accept: 'application/json' }
      });
      const data = await resp.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          return { lat, lng };
        }
      }
    } catch {
      // 次の候補を試行
    }
  }

  return null;
}

export default function App() {
  const [destinations, setDestinations] = useState<DestinationItem[]>(INITIAL_SPOTS);
  const [filter, setFilter] = useState<'all' | 'want' | 'visited'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DestinationItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ピンのドラッグ調整モード
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  // 行った記録モーダルのState (Step 6)
  const [visitedModalItem, setVisitedModalItem] = useState<DestinationItem | null>(null);
  const [visitedDate, setVisitedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [visitedMemo, setVisitedMemo] = useState<string>('');
  const [visitedAlbumUrl, setVisitedAlbumUrl] = useState<string>('');
  const [visitedPhotoUrl, setVisitedPhotoUrl] = useState<string>('');
  const [isLoadingAlbum, setIsLoadingAlbum] = useState<boolean>(false);

  // Form State
  const [formPoster, setFormPoster] = useState('👨 かずや');
  const [formCategory, setFormCategory] = useState<'場所' | '店' | 'やりたいこと'>('店');
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [autoResolvedAddress, setAutoResolvedAddress] = useState<string | null>(null);
  const [resolvedCoords, setResolvedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);
  const [formAddress, setFormAddress] = useState('');
  const [formDesire, setFormDesire] = useState(3);
  const [formMemo, setFormMemo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());

  // Leaflet map setup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([35.78, 139.30], 13); // 青梅〜羽村周辺を中心

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Clear old markers
    markersMapRef.current.forEach((marker) => map.removeLayer(marker));
    markersMapRef.current.clear();

    const breadIcon = L.icon({
      iconUrl: '/pin-bread.svg',
      iconSize: [38, 44],
      iconAnchor: [19, 43],
      popupAnchor: [0, -42]
    });

    const visitedIcon = L.icon({
      iconUrl: '/pin-bread-visited.svg',
      iconSize: [38, 44],
      iconAnchor: [19, 43],
      popupAnchor: [0, -42]
    });

    destinations.forEach((item) => {
      if (item.latitude && item.longitude) {
        const isVisited = item.status === '行った';
        const isDragging = draggingItemId === item.id;

        const marker = L.marker([item.latitude, item.longitude], {
          icon: isVisited ? visitedIcon : breadIcon,
          draggable: isDragging
        }).addTo(map);

        if (isDragging) {
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            const newLat = Math.round(pos.lat * 1000000) / 1000000;
            const newLng = Math.round(pos.lng * 1000000) / 1000000;
            setDestinations((prev) =>
              prev.map((d) => (d.id === item.id ? { ...d, latitude: newLat, longitude: newLng } : d))
            );
            showToast(`📍「${item.name}」のピン位置を更新したよ！🍞`);
          });
        }

        const popupContent = document.createElement('div');
        popupContent.style.fontFamily = "'M PLUS Rounded 1c', sans-serif";
        popupContent.style.fontSize = '12px';
        popupContent.style.minWidth = '160px';
        popupContent.innerHTML = `
          <div style="font-weight:900; color:#4a2810; margin-bottom:2px;">${item.name}</div>
          <div style="color:${isVisited ? '#2e7d32' : '#d78839'}; font-weight:800; font-size:11px;">
            ${isVisited ? '行った！🍓' : '行きたい！🍞'}
          </div>
          ${item.photoUrl ? `<div style="margin-top:4px; margin-bottom:4px; border-radius:6px; overflow:hidden; width:100%; height:64px; border:1.5px solid #7ab877;"><img src="${item.photoUrl}" style="width:100%; height:100%; object-fit:cover;" /></div>` : ''}
          ${item.address ? `<div style="font-size:10px; color:#7a583e; margin-top:2px;">📍 ${item.address}</div>` : ''}
          ${item.memo ? `<div style="font-size:11px; color:#4a2810; font-weight:700; margin-top:3px; white-space:pre-wrap;">💭 ${item.memo}</div>` : ''}
          ${item.visitedMemo ? `<div style="font-size:11px; color:#2e7d32; font-weight:700; margin-top:3px; white-space:pre-wrap;">🍓 ${item.visitedMemo}</div>` : ''}
          ${item.url ? `<div style="font-size:9px; color:#c96e1b; margin-top:2px;">🔗 リンクあり</div>` : ''}
          <div style="font-size:10px; color:#964d1f; font-weight:800; margin-top:2px;">${item.poster}</div>
        `;

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.gap = '4px';
        btnRow.style.marginTop = '6px';

        const viewDetailBtn = document.createElement('button');
        viewDetailBtn.innerText = '詳細を見る ＞';
        viewDetailBtn.style.padding = '3px 8px';
        viewDetailBtn.style.fontSize = '10px';
        viewDetailBtn.style.fontWeight = '900';
        viewDetailBtn.style.color = '#fff';
        viewDetailBtn.style.backgroundColor = '#d78839';
        viewDetailBtn.style.border = 'none';
        viewDetailBtn.style.borderRadius = '10px';
        viewDetailBtn.style.cursor = 'pointer';
        viewDetailBtn.onclick = () => {
          setSelectedItem(item);
        };
        btnRow.appendChild(viewDetailBtn);

        if (!isVisited) {
          const visitedBtn = document.createElement('button');
          visitedBtn.innerText = '🍓 行った！';
          visitedBtn.style.padding = '3px 8px';
          visitedBtn.style.fontSize = '10px';
          visitedBtn.style.fontWeight = '900';
          visitedBtn.style.color = '#fff';
          visitedBtn.style.backgroundColor = '#2e7d32';
          visitedBtn.style.border = 'none';
          visitedBtn.style.borderRadius = '10px';
          visitedBtn.style.cursor = 'pointer';
          visitedBtn.onclick = () => {
            setVisitedModalItem(item);
            setVisitedDate(new Date().toISOString().slice(0, 10));
            setVisitedMemo('');
            setVisitedAlbumUrl(item.albumUrl || '');
            setVisitedPhotoUrl(item.photoUrl || '');
          };
          btnRow.appendChild(visitedBtn);
        }

        popupContent.appendChild(btnRow);
        marker.bindPopup(popupContent);
        markersMapRef.current.set(item.id, marker);
      }
    });
  }, [destinations, draggingItemId]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  };

  // Googleフォト共有アルバムから代表写真を読み込み (Step 6)
  const handleFetchAlbumCover = async (albumUrlInput?: string) => {
    const urlToFetch = (albumUrlInput ?? visitedAlbumUrl).trim();
    if (!urlToFetch) {
      showToast('⚠️ アルバムURLを入力してください');
      return;
    }
    setIsLoadingAlbum(true);
    try {
      const res = await fetch('/api/album-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumUrl: urlToFetch })
      });
      const data = await res.json();
      if (data.success && data.photoUrl) {
        setVisitedPhotoUrl(data.photoUrl);
        showToast('📷 アルバムの写真を読み込みました！');
      } else {
        showToast('⚠️ 写真を取得できませんでした。共有アルバムURLを確認してください');
      }
    } catch (err) {
      console.error('Failed to load album cover:', err);
      showToast('⚠️ アルバム写真の取得に失敗しました');
    } finally {
      setIsLoadingAlbum(false);
    }
  };

  // 行った記録を保存（Step 6）
  const handleSaveVisited = () => {
    if (!visitedModalItem) return;
    const finalDate = visitedDate.trim() || new Date().toISOString().slice(0, 10);
    const finalMemo = visitedMemo.trim() || undefined;
    const finalAlbumUrl = visitedAlbumUrl.trim() || undefined;
    const finalPhotoUrl = visitedPhotoUrl.trim() || undefined;

    setDestinations((prev) =>
      prev.map((d) => {
        if (d.id === visitedModalItem.id) {
          return {
            ...d,
            status: '行った',
            visitedDate: finalDate,
            visitedMemo: finalMemo,
            albumUrl: finalAlbumUrl,
            photoUrl: finalPhotoUrl
          };
        }
        return d;
      })
    );

    // selectedItem が開かれている場合は更新
    setSelectedItem((prev) => {
      if (prev && prev.id === visitedModalItem.id) {
        return {
          ...prev,
          status: '行った',
          visitedDate: finalDate,
          visitedMemo: finalMemo,
          albumUrl: finalAlbumUrl,
          photoUrl: finalPhotoUrl
        };
      }
      return prev;
    });

    showToast(`🎉「${visitedModalItem.name}」の思い出を記録しました！🍓`);
    setVisitedModalItem(null);
  };

  const handleCardClick = (item: DestinationItem) => {
    if (item.latitude && item.longitude && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([item.latitude, item.longitude], 14, {
        duration: 0.8
      });
      const marker = markersMapRef.current.get(item.id);
      if (marker) {
        setTimeout(() => {
          marker.openPopup();
        }, 850);
      }
      showToast(`📍 地図で「${item.name}」を表示したよ！`);
    } else {
      setSelectedItem(item);
    }
  };

  /**
   * URLまたは店名から店名・住所・座標を自動取得する
   */
  const handleResolveUrl = async (inputQuery?: string) => {
    const target = (inputQuery !== undefined ? inputQuery : (formUrl || formName)).trim();
    if (!target) return;

    setIsResolvingUrl(true);
    try {
      const resp = await fetch('/api/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target })
      });
      const data = await resp.json();

      if (data && data.success) {
        if (data.address) {
          setAutoResolvedAddress(data.address);
          setFormAddress(data.address);
        }
        if (data.name && (!formName.trim() || formName === '行き先スポット')) {
          setFormName(data.name);
        }
        if (data.url && data.url !== formUrl && !formUrl.trim()) {
          setFormUrl(data.url);
        }
        if (data.lat && data.lng) {
          setResolvedCoords({ lat: data.lat, lng: data.lng });
          if (mapInstanceRef.current) {
            mapInstanceRef.current.flyTo([data.lat, data.lng], 14, { duration: 0.8 });
          }
        }
        if (data.address) {
          showToast(`📍「${data.name || 'スポット'}」の住所を取得したよ！🍞`);
        } else {
          showToast(`「${data.name}」を特定しました。最寄りや住所を入力してね！`);
        }
      } else {
        showToast('URLから住所を取得できませんでした。手入力してね！');
      }
    } catch (err) {
      console.warn('Resolve URL failed:', err);
    } finally {
      setIsResolvingUrl(false);
    }
  };

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('行き先・やりたいことの名前を入力してください🍞');
      return;
    }

    setIsSubmitting(true);

    // 精密な住所・施設名ジオコーディング
    let coords: { lat: number; lng: number } | null = null;
    if (formAddress.trim()) {
      coords = await resolveJapaneseCoordinates(formAddress.trim(), formName.trim());
    }

    // ジオコーディングで取れなかった場合、URL/店名解決時の座標を使用
    const finalLat = coords ? coords.lat : (resolvedCoords ? resolvedCoords.lat : null);
    const finalLng = coords ? coords.lng : (resolvedCoords ? resolvedCoords.lng : null);

    const newItem: DestinationItem = {
      id: `spot-${Date.now()}`,
      name: formName.trim(),
      category: formCategory,
      poster: formPoster,
      address: formAddress.trim(),
      url: formUrl.trim() || undefined,
      desire: formDesire,
      memo: formMemo.trim(),
      latitude: finalLat,
      longitude: finalLng,
      status: '行きたい',
      registeredAt: new Date().toISOString().slice(5, 10).replace('-', '/')
    };

    setDestinations((prev) => [newItem, ...prev]);
    setIsSubmitting(false);
    setIsModalOpen(false);

    // Reset form
    setFormName('');
    setFormUrl('');
    setAutoResolvedAddress(null);
    setResolvedCoords(null);
    setFormAddress('');
    setFormMemo('');
    setFormDesire(3);

    if (finalLat && finalLng) {
      showToast('📍 正確な住所の位置にパンのピンが立ちました！🍞');
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo([finalLat, finalLng], 14, { duration: 1.0 });
      }
    } else {
      showToast('ほっかほっカーに登録したよ！🍞');
    }
  };

  const wantCount = destinations.filter((d) => d.status !== '行った').length;
  const visitedCount = destinations.filter((d) => d.status === '行った').length;

  const filteredItems = destinations.filter((d) => {
    if (filter === 'want') return d.status !== '行った';
    if (filter === 'visited') return d.status === '行った';
    return true;
  });

  const getCategoryEmoji = (category: string) => {
    if (category === '店') return '🥞';
    if (category === 'やりたいこと') return '✨';
    return '📍';
  };

  return (
    <div className="w-full min-h-screen bg-[#f3e9db] flex justify-center text-[#4a2810] font-['M_PLUS_Rounded_1c',sans-serif]">
      {/* スマホ画面枠（390px幅、絵本テイスト） */}
      <div className="w-full max-w-[430px] min-h-screen bg-[#fbf6ec] shadow-2xl flex flex-col relative border-x-[3px] border-[#dfcfbd]">
        {/* トースト通知 */}
        {toastMessage && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[4000] bg-[#4a2810] text-[#fef9f0] px-4 py-2.5 rounded-full font-extrabold text-xs shadow-xl flex items-center gap-2 border-2 border-[#d78839] animate-bounce">
            <span>🍞</span>
            <span>{toastMessage}</span>
          </div>
        )}

        {/* ① ヘッダー */}
        <header className="bg-gradient-to-b from-[#f7e6cf] to-[#ebd4b7] border-b-[3px] border-[#8a481c] px-4 py-3 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍞</span>
            <div>
              <h1 className="text-base font-black text-[#5c3010] leading-tight tracking-tight">
                家族のやりたいことリスト
              </h1>
              <p className="text-[10px] font-extrabold text-[#964d1f]">
                パンどろぼう × ほっかほっカーの旅
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setFormUrl('');
              setAutoResolvedAddress(null);
              setResolvedCoords(null);
              setIsModalOpen(true);
            }}
            className="w-9 h-9 rounded-full bg-[#d78839] hover:bg-[#b86518] text-white flex items-center justify-center font-black shadow-md border-2 border-[#8a481c] active:scale-95 transition-transform cursor-pointer"
            title="新規投稿"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
          </button>
        </header>

        {/* メインスクロールエリア */}
        <main className="flex-1 overflow-y-auto pb-24">
          {/* ② ほっかほっカーの旅ヒーロービジュアル（上部1024×590のみ切り出して絵の中の疑似地図を非表示） */}
          <div className="p-3">
            <div
              className="w-full overflow-hidden rounded-2xl border-[3px] border-[#8a481c] shadow-md bg-[#fff7ea] relative"
              style={{ aspectRatio: '1024 / 590' }}
            >
              <img
                src="/file_000000001d4c81faaac961a36e8f3609.png"
                alt="ほっかほっカーの旅"
                className="w-full h-full object-cover object-top block"
              />
            </div>
          </div>

          {/* ドラッグ調整中の通知バナー */}
          {draggingItemId && (
            <div className="mx-3 mb-2 p-2.5 bg-[#fff3cd] border-2 border-[#d78839] rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-black text-[#8a481c]">
                <Move className="w-4 h-4 animate-spin" />
                <span>地図上のパンのピンをドラッグして微調整できます</span>
              </div>
              <button
                onClick={() => {
                  setDraggingItemId(null);
                  showToast('ピン位置の微調整を完了したよ！🍞');
                }}
                className="px-2.5 py-1 bg-[#2e7d32] text-white rounded-lg font-black text-[10px] flex items-center gap-1 shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> 完了
              </button>
            </div>
          )}

          {/* ③ 地図エリア（Leaflet & OpenStreetMap） */}
          <div className="px-3 mb-3">
            <div className="bg-[#fffdf8] p-2 rounded-2xl border-[3px] border-[#8a481c] shadow-md">
              <div className="flex justify-between items-center mb-1.5 px-1">
                <span className="text-xs font-black text-[#8a481c] flex items-center gap-1">
                  📍 いまの地図（ピン自動連動）
                </span>
                <span className="text-[10px] font-extrabold text-[#7a583e]">
                  カードをタップすると地図がジャンプ！
                </span>
              </div>

              {/* 地図本体 */}
              <div
                ref={mapContainerRef}
                className="w-full h-56 rounded-xl border-2 border-[#d9be9b] overflow-hidden relative shadow-inner"
              />

              {/* 地図下ステータスバッジ */}
              <div className="mt-2 flex justify-between items-center px-1 text-xs font-black">
                <div className="flex gap-3">
                  <span className="flex items-center gap-1 text-[#d78839]">
                    <img src="/pin-bread.svg" alt="行きたい" className="w-4 h-4 inline" /> 行きたい
                  </span>
                  <span className="flex items-center gap-1 text-[#2e7d32]">
                    <img src="/pin-bread-visited.svg" alt="行った" className="w-4 h-4 inline" /> 行った
                  </span>
                </div>
                <div className="text-[11px] bg-[#f7e6cf] border border-[#d9be9b] px-2.5 py-0.5 rounded-full text-[#8a481c]">
                  🍞 ピン合計: {destinations.filter((d) => d.latitude && d.longitude).length}件
                </div>
              </div>
            </div>
          </div>

          {/* ④ 行き先リスト（横スクロールカード） */}
          <div className="px-3 mb-4">
            <div className="flex justify-between items-center mb-2 px-1">
              <div className="text-sm font-black text-[#5c3010] flex items-center gap-1">
                🚩 行き先リスト
              </div>
              {/* フィルターボタン */}
              <div className="flex gap-1">
                <button
                  onClick={() => setFilter('all')}
                  className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border transition-all ${
                    filter === 'all'
                      ? 'bg-[#8a481c] text-white border-[#5c3010]'
                      : 'bg-white text-[#7a583e] border-[#d9be9b]'
                  }`}
                >
                  すべて
                </button>
                <button
                  onClick={() => setFilter('want')}
                  className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border transition-all ${
                    filter === 'want'
                      ? 'bg-[#d78839] text-white border-[#8a481c]'
                      : 'bg-white text-[#7a583e] border-[#d9be9b]'
                  }`}
                >
                  行きたい
                </button>
                <button
                  onClick={() => setFilter('visited')}
                  className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border transition-all ${
                    filter === 'visited'
                      ? 'bg-[#2e7d32] text-white border-[#1b5e20]'
                      : 'bg-white text-[#7a583e] border-[#d9be9b]'
                  }`}
                >
                  行った
                </button>
              </div>
            </div>

            {/* 横スクロールカードコンテナ */}
            <div className="flex gap-2.5 overflow-x-auto py-1 px-0.5 no-scrollbar min-h-[130px]">
              {filteredItems.length === 0 ? (
                <div className="w-full flex items-center justify-center py-6 text-xs text-[#7a583e] font-extrabold">
                  まだ登録がありません🍞 下のボタンから投稿してね！
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isVisited = item.status === '行った';
                  const hasPin = Boolean(item.latitude && item.longitude);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleCardClick(item)}
                      className={`flex-none w-[126px] rounded-xl p-2 shadow-sm border-2 transition-all cursor-pointer flex flex-col justify-between active:scale-95 ${
                        isVisited
                          ? 'bg-[#f7fdf7] border-[#7ab877] shadow-[#5a9457]/20'
                          : 'bg-[#fffdf8] border-[#d9be9b] shadow-[#caa981]/30'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span
                            className={`text-[8px] font-black px-1.5 py-0.2 rounded-md text-white ${
                              isVisited ? 'bg-[#2e7d32]' : 'bg-[#e0523d]'
                            }`}
                          >
                            {isVisited ? '行った！' : item.category}
                          </span>
                          {hasPin && (
                            <span
                              className="text-[9px] text-[#d78839]"
                              title="地図にピンがあります"
                            >
                              📍
                            </span>
                          )}
                          <span className="text-[9px] text-[#b86518] font-bold">
                            {'🍞'.repeat(item.desire || 1)}
                          </span>
                        </div>
                        <div className="w-full h-14 rounded-lg bg-[#fdf6ec] border border-[#ecd8c0] flex items-center justify-center text-2xl mb-1.5 shadow-inner overflow-hidden relative">
                          {item.photoUrl ? (
                            <>
                              <img
                                src={item.photoUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[8px] px-1 rounded-sm flex items-center gap-0.5">
                                📷
                              </span>
                            </>
                          ) : (
                            getCategoryEmoji(item.category)
                          )}
                        </div>
                        <div
                          className="text-[11px] font-black text-[#4a2810] truncate"
                          title={item.name}
                        >
                          {item.name}
                        </div>
                        {item.address && (
                          <div className="text-[9px] text-[#7a583e] truncate" title={item.address}>
                            📍 {item.address}
                          </div>
                        )}
                        {item.albumUrl && (
                          <div className="text-[8px] text-[#2e7d32] truncate font-bold mt-0.5 flex items-center gap-0.5">
                            📷 アルバム連携
                          </div>
                        )}
                        {item.url && (
                          <div className="text-[8px] text-[#c96e1b] truncate font-bold mt-0.5">
                            🔗 紹介URLあり
                          </div>
                        )}
                      </div>
                      <div className="flex justify-between items-center text-[9px] font-black text-[#7a583e] mt-2 pt-1 border-t border-[#f0e0cc]">
                        <span className="truncate max-w-[65px]">{item.poster}</span>
                        <span>
                          {item.visitedDate
                            ? item.visitedDate.slice(5)
                            : item.registeredAt?.slice(5)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 新しく投稿するメインボタン */}
          <div className="px-4 mb-4">
            <button
              onClick={() => {
                setFormUrl('');
                setAutoResolvedAddress(null);
                setResolvedCoords(null);
                setIsModalOpen(true);
              }}
              className="w-full py-3.5 bg-gradient-to-b from-[#f78d3f] to-[#db5b1a] hover:from-[#e87a2a] hover:to-[#c84d12] text-white font-black text-sm rounded-full shadow-[0_4px_0_#702a06] border-2 border-[#8e380b] flex items-center justify-center gap-2 active:translate-y-1 active:shadow-none transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5 stroke-[3]" />
              <span>新しく投稿する</span>
            </button>
          </div>
        </main>

        {/* ⑤ 下部固定ナビゲーションバー */}
        <nav className="fixed bottom-0 w-full max-w-[430px] bg-[#fbf6ec] border-t-[3px] border-[#8a481c] px-3 py-2 flex justify-around items-center z-20 shadow-[0_-4px_10px_rgba(0,0,0,0.06)]">
          <button className="flex flex-col items-center text-[#d78839] font-black text-[10px] cursor-pointer">
            <span className="text-lg">📍</span>
            <span>マップ</span>
          </button>
          <button
            onClick={() => {
              if (filteredItems.length > 0) handleCardClick(filteredItems[0]);
            }}
            className="flex flex-col items-center text-[#7a583e] hover:text-[#d78839] font-extrabold text-[10px] cursor-pointer"
          >
            <span className="text-lg">📋</span>
            <span>一覧</span>
          </button>
          <button
            onClick={() => setFilter('visited')}
            className="flex flex-col items-center text-[#7a583e] hover:text-[#d78839] font-extrabold text-[10px] cursor-pointer"
          >
            <span className="text-lg">📷</span>
            <span>思い出</span>
          </button>
          <button
            onClick={() => showToast('設定画面（GAS連携中）')}
            className="flex flex-col items-center text-[#7a583e] hover:text-[#d78839] font-extrabold text-[10px] cursor-pointer"
          >
            <span className="text-lg">⚙️</span>
            <span>設定</span>
          </button>
        </nav>

        {/* ⑥ 投稿モーダル */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-[#4a2810]/60 backdrop-blur-xs flex items-center justify-center p-4 z-[3000]">
            <div className="w-full max-w-[390px] bg-[#fffdf9] border-[3.5px] border-[#8a481c] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-[#f7e6cf] border-b-2 border-[#d9be9b] px-4 py-3 flex justify-between items-center">
                <div className="text-sm font-black text-[#8a481c] flex items-center gap-1.5">
                  🍞 新しい「行きたい！」を登録
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-[#7a583e] hover:text-[#4a2810] font-black text-xl leading-none cursor-pointer p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handlePostSubmit} className="p-4 overflow-y-auto flex flex-col gap-3">
                {/* 投稿者 */}
                <div>
                  <label className="block text-[11px] font-black text-[#4a2810] mb-1">
                    誰のやりたいこと？ <span className="text-[#e0523d] text-[9px]">※必須</span>
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['👨 かずや', '👩 ひとみ', '👦 れん', '👧 あやみ'].map((p) => (
                      <button
                        type="button"
                        key={p}
                        onClick={() => setFormPoster(p)}
                        className={`py-2 px-1 rounded-xl text-xs font-extrabold border-2 transition-all cursor-pointer text-center ${
                          formPoster === p
                            ? 'bg-[#ffe3b3] border-[#c96e1b] text-[#8a3c00] ring-1 ring-[#c96e1b]'
                            : 'bg-[#fbf6ec] border-[#d9be9b] text-[#4a2810]'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* カテゴリ */}
                <div>
                  <label className="block text-[11px] font-black text-[#4a2810] mb-1">
                    種類 <span className="text-[#e0523d] text-[9px]">※必須</span>
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: '🍰 お店', val: '店' as const },
                      { label: '📍 場所', val: '場所' as const },
                      { label: '✨ やりたい事', val: 'やりたいこと' as const }
                    ].map((c) => (
                      <button
                        type="button"
                        key={c.val}
                        onClick={() => setFormCategory(c.val)}
                        className={`py-2 px-1 rounded-xl text-xs font-black border-2 transition-all cursor-pointer text-center ${
                          formCategory === c.val
                            ? 'bg-[#d78839] text-white border-[#8a481c]'
                            : 'bg-[#fbf6ec] border-[#d9be9b] text-[#4a2810]'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ★ お店の紹介URL・Google共有リンク */}
                <div className="bg-[#fff9ef] p-2.5 rounded-2xl border-2 border-[#d9be9b]">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-black text-[#8a481c] flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5 text-[#d78839]" />
                      紹介URL・Googleマップ共有リンク
                    </label>
                    {isResolvingUrl && (
                      <span className="text-[10px] text-[#d78839] font-black animate-pulse flex items-center gap-1">
                        <span>🍞</span> 住所を取得中...
                      </span>
                    )}
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={formUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormUrl(val);
                        if (
                          val.includes('share.google') ||
                          val.includes('maps') ||
                          val.includes('http')
                        ) {
                          handleResolveUrl(val);
                        }
                      }}
                      onBlur={() => {
                        if (formUrl.trim() && !autoResolvedAddress) {
                          handleResolveUrl(formUrl);
                        }
                      }}
                      placeholder="例：https://share.google/... やマップURL"
                      className="flex-1 border-2 border-[#d9be9b] rounded-xl px-2.5 py-1.5 text-xs text-[#4a2810] bg-white focus:outline-none focus:border-[#d78839]"
                    />
                    <button
                      type="button"
                      disabled={!formUrl.trim() || isResolvingUrl}
                      onClick={() => handleResolveUrl(formUrl)}
                      className="px-2.5 py-1.5 bg-[#d78839] hover:bg-[#b86518] disabled:opacity-40 text-white rounded-xl text-xs font-black transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap"
                    >
                      <Search className="w-3 h-3" />
                      <span>調べる</span>
                    </button>
                  </div>

                  {/* URLの下に住所を自動表示するエリア */}
                  {autoResolvedAddress ? (
                    <div className="mt-2 p-2 bg-[#f4ebe1] border-2 border-[#8a481c] rounded-xl flex items-start gap-2 shadow-xs animate-in fade-in duration-200">
                      <span className="text-base leading-none">📍</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black text-[#5c3010] flex items-center justify-between">
                          <span>自動取得した住所</span>
                          <span className="text-[9px] text-[#2e7d32] bg-[#e8f5e9] border border-[#a5d6a7] px-1.5 py-0.2 rounded font-black">
                            ✓ 地図ピン反映
                          </span>
                        </div>
                        <div className="text-xs font-black text-[#8a481c] mt-0.5 break-all">
                          {autoResolvedAddress}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[9px] text-[#7a583e] mt-1 leading-tight">
                      ※Googleの共有URLを貼ると、店名と住所が自動で入り、正しい位置にピンが立ちます！
                    </p>
                  )}
                </div>

                {/* 行き先・やりたいことの名前 */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-black text-[#4a2810]">
                      行き先・店名・やりたいこと <span className="text-[#e0523d] text-[9px]">※必須</span>
                    </label>
                    {formName.trim() && !formAddress.trim() && (
                      <button
                        type="button"
                        onClick={() => handleResolveUrl(formName)}
                        className="text-[10px] text-[#d78839] hover:text-[#b86518] font-black underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Search className="w-3 h-3 inline" />
                        <span>住所を自動検索</span>
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes('share.google') || val.includes('http')) {
                        const m = val.match(/(https?:\/\/[^\s]+|share\.google\/[^\s]+)/i);
                        if (m) {
                          setFormUrl(m[1]);
                          handleResolveUrl(m[1]);
                          const rest = val.replace(m[0], '').trim();
                          setFormName(rest || formName);
                          return;
                        }
                      }
                      setFormName(val);
                    }}
                    placeholder="例：らーめん ニューカッパ、担々麺杉山"
                    className="w-full border-2 border-[#d9be9b] rounded-xl px-3 py-2 text-sm text-[#4a2810] bg-white focus:outline-none focus:border-[#d78839]"
                    maxLength={100}
                    required
                  />
                </div>

                {/* 場所・住所・最寄り駅 */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-black text-[#4a2810]">
                      場所・住所・最寄り駅（任意）
                    </label>
                    <span className="text-[9px] text-[#b86518] font-bold">
                      📍 市区町村・丁目まで対応
                    </span>
                  </div>
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.includes('share.google') || val.includes('http')) {
                        const m = val.match(/(https?:\/\/[^\s]+|share\.google\/[^\s]+)/i);
                        if (m) {
                          setFormUrl(m[1]);
                          handleResolveUrl(m[1]);
                          const rest = val.replace(m[0], '').trim();
                          setFormAddress(rest);
                          return;
                        }
                      }
                      setFormAddress(val);
                    }}
                    placeholder="例：羽村市小作台1-11-6、青梅市今寺4丁目"
                    className="w-full border-2 border-[#d9be9b] rounded-xl px-3 py-2 text-sm text-[#4a2810] bg-white focus:outline-none focus:border-[#d78839]"
                    maxLength={200}
                  />
                  {!formAddress.trim() && (
                    <p className="text-[9px] text-[#b86518] mt-1 flex items-center gap-1 font-bold">
                      <AlertCircle className="w-3 h-3 text-[#d78839] shrink-0 inline" />
                      <span>「青梅市」や「小作駅」などの地名を入れると正確な位置にピンが立ちます</span>
                    </p>
                  )}
                </div>

                {/* 行きたい度 */}
                <div>
                  <label className="block text-[11px] font-black text-[#4a2810] mb-1">行きたい度</label>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <button
                        type="button"
                        key={num}
                        onClick={() => setFormDesire(num)}
                        className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-black transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
                          formDesire >= num
                            ? 'bg-[#ffe3b3] border-[#c96e1b] text-[#8a3c00]'
                            : 'bg-[#fbf6ec] border-[#d9be9b] text-[#7a583e]'
                        }`}
                      >
                        <span>🍞</span>
                        <span>{num}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* メモ（任意） */}
                <div>
                  <label className="block text-[11px] font-black text-[#4a2810] mb-1">
                    メモ・ひとこと（任意）
                  </label>
                  <textarea
                    value={formMemo}
                    onChange={(e) => setFormMemo(e.target.value)}
                    placeholder="例：トマトラーメンとチーズご飯が食べたい！"
                    rows={2}
                    className="w-full border-2 border-[#d9be9b] rounded-xl px-3 py-2 text-sm text-[#4a2810] bg-white focus:outline-none focus:border-[#d78839] resize-none"
                    maxLength={500}
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2.5 bg-[#e8d8c3] border-2 border-[#b89f82] rounded-full text-xs font-black text-[#7a583e] cursor-pointer"
                  >
                    やめる
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-[2] py-2.5 bg-gradient-to-b from-[#f78d3f] to-[#db5b1a] text-white border-2 border-[#8e380b] rounded-full text-xs font-black shadow-[0_3px_0_#702a06] cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <span>🍞</span> {isSubmitting ? 'ピンを探して登録中...' : 'ほっかほっカーで登録'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ⑦ 詳細モーダル */}
        {selectedItem && (
          <div className="fixed inset-0 bg-[#4a2810]/60 backdrop-blur-xs flex items-center justify-center p-4 z-[3000]">
            <div className="w-full max-w-[390px] bg-[#fffdf9] border-[3.5px] border-[#8a481c] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-[#f7e6cf] border-b-2 border-[#d9be9b] px-4 py-3 flex justify-between items-center">
                <div className="text-sm font-black text-[#8a481c] truncate max-w-[280px]">
                  {selectedItem.name}
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-[#7a583e] hover:text-[#4a2810] font-black text-xl leading-none cursor-pointer p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 flex flex-col gap-2.5 text-xs">
                <div className="flex">
                  <span className="w-20 font-black text-[#7a583e]">状態</span>
                  <span
                    className={`font-black ${
                      selectedItem.status === '行った' ? 'text-[#2e7d32]' : 'text-[#d78839]'
                    }`}
                  >
                    {selectedItem.status === '行った'
                      ? `行った！🍓 (${selectedItem.visitedDate || ''})`
                      : '行きたい！🍞'}
                  </span>
                </div>
                <div className="flex">
                  <span className="w-20 font-black text-[#7a583e]">種類</span>
                  <span className="font-extrabold text-[#4a2810]">{selectedItem.category}</span>
                </div>
                <div className="flex">
                  <span className="w-20 font-black text-[#7a583e]">投稿者</span>
                  <span className="font-extrabold text-[#4a2810]">{selectedItem.poster}</span>
                </div>
                <div className="flex">
                  <span className="w-20 font-black text-[#7a583e]">行きたい度</span>
                  <span className="font-black text-[#b86518]">
                    {'🍞'.repeat(selectedItem.desire || 1)}
                  </span>
                </div>
                {selectedItem.address && (
                  <div className="flex">
                    <span className="w-20 font-black text-[#7a583e]">場所・住所</span>
                    <span className="font-extrabold text-[#4a2810]">{selectedItem.address}</span>
                  </div>
                )}
                {selectedItem.url && (
                  <div className="flex items-center">
                    <span className="w-20 font-black text-[#7a583e]">紹介リンク</span>
                    <a
                      href={selectedItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-black text-[#d78839] hover:text-[#b86518] underline flex items-center gap-1 break-all"
                    >
                      <span>紹介ページ・マップを開く</span>
                      <ExternalLink className="w-3 h-3 inline" />
                    </a>
                  </div>
                )}
                {selectedItem.memo && (
                  <div className="flex">
                    <span className="w-20 font-black text-[#7a583e]">メモ</span>
                    <span className="font-extrabold text-[#4a2810] whitespace-pre-wrap">
                      {selectedItem.memo}
                    </span>
                  </div>
                )}
                {selectedItem.visitedMemo && (
                  <div className="flex">
                    <span className="w-20 font-black text-[#2e7d32]">行った記録</span>
                    <span className="font-extrabold text-[#2e7d32] whitespace-pre-wrap">
                      {selectedItem.visitedMemo}
                    </span>
                  </div>
                )}

                {/* 行った記録をつけるボタン（行きたい！の場合） */}
                {selectedItem.status !== '行った' && (
                  <button
                    onClick={() => {
                      setVisitedModalItem(selectedItem);
                      setVisitedDate(new Date().toISOString().slice(0, 10));
                      setVisitedMemo('');
                      setVisitedAlbumUrl(selectedItem.albumUrl || '');
                      setVisitedPhotoUrl(selectedItem.photoUrl || '');
                    }}
                    className="w-full py-2.5 bg-gradient-to-b from-[#4caf50] to-[#2e7d32] hover:from-[#43a047] hover:to-[#1b5e20] text-white rounded-full text-xs font-black shadow-md border-2 border-[#1e5222] flex items-center justify-center gap-1.5 cursor-pointer mt-1 active:scale-98 transition-all"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>🍓 行った記録をつける（Googleフォト連携）</span>
                  </button>
                )}

                {/* 行った後の写真・アルバム表示 */}
                {selectedItem.status === '行った' && (selectedItem.photoUrl || selectedItem.albumUrl) && (
                  <div className="mt-1 p-2.5 bg-[#f4fbf4] rounded-2xl border-2 border-[#7ab877]">
                    <div className="text-[11px] font-black text-[#2e7d32] mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5" />
                        <span>アルバムの思い出写真</span>
                      </span>
                      {selectedItem.visitedDate && (
                        <span className="text-[10px] text-[#4e7028] font-bold">
                          {selectedItem.visitedDate}
                        </span>
                      )}
                    </div>
                    {selectedItem.photoUrl && (
                      <div className="relative rounded-xl overflow-hidden border-2 border-[#a3d9a0] shadow-sm aspect-video bg-[#e8f5e9]">
                        <img
                          src={selectedItem.photoUrl}
                          alt={selectedItem.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    {selectedItem.albumUrl && (
                      <a
                        href={selectedItem.albumUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 flex items-center justify-center w-full py-2 px-3 bg-[#e8f5e9] hover:bg-[#c8e6c9] border-2 border-[#2e7d32] text-[#1b5e20] rounded-xl text-xs font-black gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Googleフォトでアルバムを見る</span>
                        <ExternalLink className="w-3 h-3 ml-0.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3 bg-[#fbf6ec] border-t border-[#ecd8c0] flex gap-2 flex-wrap">
                {selectedItem.latitude && selectedItem.longitude && (
                  <>
                    <button
                      onClick={() => {
                        const item = selectedItem;
                        setSelectedItem(null);
                        handleCardClick(item);
                      }}
                      className="flex-1 py-2 bg-[#d78839] text-white rounded-full text-xs font-black shadow-sm cursor-pointer"
                    >
                      📍 地図で見る
                    </button>
                    <button
                      onClick={() => {
                        const item = selectedItem;
                        setSelectedItem(null);
                        setDraggingItemId(item.id);
                        if (item.latitude && item.longitude && mapInstanceRef.current) {
                          mapInstanceRef.current.setView([item.latitude, item.longitude], 15);
                        }
                        showToast(`📍「${item.name}」のピン位置を微調整できます！`);
                      }}
                      className="py-2 px-3 bg-[#fff8eb] border-2 border-[#d78839] text-[#8a481c] rounded-full text-xs font-black shadow-sm cursor-pointer flex items-center gap-1"
                    >
                      <Move className="w-3.5 h-3.5" />
                      <span>ピン位置調整</span>
                    </button>
                  </>
                )}
                {selectedItem.status === '行った' && (
                  <button
                    onClick={() => {
                      setVisitedModalItem(selectedItem);
                      setVisitedDate(selectedItem.visitedDate || new Date().toISOString().slice(0, 10));
                      setVisitedMemo(selectedItem.visitedMemo || '');
                      setVisitedAlbumUrl(selectedItem.albumUrl || '');
                      setVisitedPhotoUrl(selectedItem.photoUrl || '');
                    }}
                    className="py-2 px-3 bg-[#e8f5e9] border-2 border-[#2e7d32] text-[#1b5e20] rounded-full text-xs font-black shadow-sm cursor-pointer flex items-center gap-1"
                  >
                    <span>🍓 思い出編集</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedItem(null)}
                  className="py-2 px-4 bg-[#e8d8c3] border border-[#b89f82] rounded-full text-xs font-black text-[#7a583e] cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ⑧ 行った記録モーダル (Step 6) */}
        {visitedModalItem && (
          <div className="fixed inset-0 bg-[#4a2810]/60 backdrop-blur-xs flex items-center justify-center p-4 z-[3100]">
            <div className="w-full max-w-[390px] bg-[#fffdf9] border-[3.5px] border-[#2e7d32] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-[#e8f5e9] border-b-2 border-[#a5d6a7] px-4 py-3 flex justify-between items-center">
                <div className="text-sm font-black text-[#1b5e20] flex items-center gap-1.5 truncate max-w-[280px]">
                  <span>🍓</span>
                  <span>行った記録をのこす: {visitedModalItem.name}</span>
                </div>
                <button
                  onClick={() => setVisitedModalItem(null)}
                  className="text-[#388e3c] hover:text-[#1b5e20] font-black text-xl leading-none cursor-pointer p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex flex-col gap-3 text-xs">
                {/* 行った日 */}
                <div>
                  <label className="block text-[11px] font-black text-[#1b5e20] mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>行った日</span>
                  </label>
                  <input
                    type="date"
                    value={visitedDate}
                    onChange={(e) => setVisitedDate(e.target.value)}
                    className="w-full border-2 border-[#c8e6c9] rounded-xl px-3 py-2 text-xs bg-white text-[#2e7d32] font-black focus:outline-none focus:border-[#2e7d32]"
                  />
                </div>

                {/* 行ったメモ・思い出 */}
                <div>
                  <label className="block text-[11px] font-black text-[#1b5e20] mb-1">
                    🍓 思い出・ひとことメモ
                  </label>
                  <textarea
                    rows={3}
                    value={visitedMemo}
                    onChange={(e) => setVisitedMemo(e.target.value)}
                    placeholder="例: 名物のトマトラーメンが最高だった！シメのチーズご飯も美味しかったよ🍅"
                    className="w-full border-2 border-[#c8e6c9] rounded-xl px-3 py-2 text-xs bg-white text-[#4a2810] placeholder:text-[#9e9e9e] focus:outline-none focus:border-[#2e7d32] resize-none"
                  />
                </div>

                {/* Googleフォト共有アルバムURL */}
                <div className="bg-[#f1f8e9] p-3 rounded-2xl border-2 border-[#c5e1a5]">
                  <label className="block text-[11px] font-black text-[#33691e] mb-1 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" />
                    <span>Googleフォト 共有アルバムURL（任意）</span>
                  </label>
                  <p className="text-[10px] text-[#558b2f] mb-2 leading-relaxed">
                    Googleフォトで共有リンク（photos.app.goo.gl/...）を作成して貼り付けると、代表写真が自動でカードに飾られます！📷
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={visitedAlbumUrl}
                      onChange={(e) => setVisitedAlbumUrl(e.target.value)}
                      placeholder="https://photos.app.goo.gl/..."
                      className="flex-1 border-2 border-[#c5e1a5] rounded-xl px-2.5 py-1.5 text-xs bg-white text-[#33691e] placeholder:text-[#aed581] focus:outline-none focus:border-[#558b2f]"
                    />
                    <button
                      type="button"
                      disabled={isLoadingAlbum}
                      onClick={() => handleFetchAlbumCover()}
                      className="px-3 py-1.5 bg-[#558b2f] hover:bg-[#33691e] disabled:bg-[#9e9e9e] text-white rounded-xl text-xs font-black cursor-pointer shadow-xs transition-colors"
                    >
                      {isLoadingAlbum ? '取得中...' : '写真を読込'}
                    </button>
                  </div>

                  {/* 取得できた写真のプレビュー */}
                  {visitedPhotoUrl && (
                    <div className="mt-3 p-2 bg-white rounded-xl border-2 border-[#8bc34a] shadow-xs">
                      <div className="text-[10px] font-black text-[#2e7d32] mb-1 flex items-center justify-between">
                        <span>✨ 代表写真を読み込みました</span>
                        <button
                          type="button"
                          onClick={() => setVisitedPhotoUrl('')}
                          className="text-[10px] text-[#e0523d] font-black hover:underline"
                        >
                          削除
                        </button>
                      </div>
                      <div className="relative rounded-lg overflow-hidden border border-[#c8e6c9] aspect-video">
                        <img
                          src={visitedPhotoUrl}
                          alt="Album cover preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVisitedModalItem(null)}
                    className="flex-1 py-2.5 bg-[#e8d8c3] border border-[#b89f82] rounded-full text-xs font-black text-[#7a583e] cursor-pointer"
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveVisited}
                    className="flex-[2] py-2.5 bg-gradient-to-b from-[#4caf50] to-[#2e7d32] hover:from-[#43a047] hover:to-[#1b5e20] text-white rounded-full text-xs font-black shadow-[0_3px_0_#1b5e20] border-2 border-[#1e5222] active:translate-y-0.5 active:shadow-none cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>🍓 思い出を保存する！</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
