// newdown.js - 자체 TikTok 다운로드 API (Vercel용)
// /api/newdown.js 로 배포 예정

export default async function handler(req, res) {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            success: false, 
            message: 'Method not allowed' 
        });
    }
    
    try {
        const { videoUrl, licenseKey } = req.body;
        
        if (!videoUrl) {
            return res.status(400).json({ 
                success: false, 
                message: 'TikTok URL이 필요합니다' 
            });
        }
        
        // 간단한 라이센스 체크 (기존 방식 유지)
        if (!licenseKey) {
            return res.status(401).json({ 
                success: false, 
                message: '라이센스키가 필요합니다' 
            });
        }
        
        console.log('🎬 TikTok 다운로드 요청:', videoUrl);
        
        // 1. TikTok 페이지 HTML 가져오기
        const html = await fetchTikTokHTML(videoUrl);
        
        // 2. HTML에서 비디오 URL 추출
        const videoData = extractVideoURL(html);
        
        if (!videoData.downloadUrl) {
            throw new Error('비디오 다운로드 URL을 찾을 수 없습니다');
        }
        
        // 3. 파일명 생성
        const filename = generateFilename(videoUrl, videoData);
        
        console.log('✅ TikTok 비디오 URL 추출 성공:', videoData.downloadUrl);
        
        return res.status(200).json({
            success: true,
            data: {
                downloadUrl: videoData.downloadUrl,
                filename: filename,
                title: videoData.title || '',
                author: videoData.author || '',
                duration: videoData.duration || 0
            }
        });
        
    } catch (error) {
        console.error('❌ TikTok 다운로드 실패:', error);
        
        return res.status(500).json({
            success: false,
            message: `다운로드 실패: ${error.message}`
        });
    }
}

// TikTok 페이지 HTML 가져오기
async function fetchTikTokHTML(url) {
    try {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Android 14; Mobile; rv:109.0) Gecko/111.0 Firefox/111.0'
        ];
        
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': randomUA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7,zh-CN;q=0.6,zh;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                'DNT': '1'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        console.log('✅ TikTok HTML 획득 완료');
        
        return html;
        
    } catch (error) {
        throw new Error(`TikTok 페이지 로드 실패: ${error.message}`);
    }
}

// HTML에서 비디오 URL 추출
function extractVideoURL(html) {
    try {
        // 1. __UNIVERSAL_DATA_FOR_REHYDRATION__ 스크립트 태그에서 데이터 추출
        const scriptRegex = /<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>(.*?)<\/script>/s;
        const match = html.match(scriptRegex);
        
        if (!match || !match[1]) {
            throw new Error('TikTok 데이터 스크립트를 찾을 수 없습니다');
        }
        
        const jsonData = JSON.parse(match[1]);
        
        // 2. 비디오 데이터 찾기
        const videoInfo = findVideoInfo(jsonData);
        
        if (!videoInfo) {
            throw new Error('비디오 정보를 찾을 수 없습니다');
        }
        
        // 3. 비디오 URL 추출 (여러 방법 시도)
        let downloadUrl = null;
        let title = '';
        let author = '';
        let duration = 0;
        
        // 기본 정보 추출
        if (videoInfo.desc) title = videoInfo.desc;
        if (videoInfo.author && videoInfo.author.nickname) author = videoInfo.author.nickname;
        if (videoInfo.video && videoInfo.video.duration) duration = videoInfo.video.duration;
        
        // 비디오 URL 추출 시도
        if (videoInfo.video && videoInfo.video.playAddr) {
            downloadUrl = videoInfo.video.playAddr;
        }
        
        if (!downloadUrl && videoInfo.video && videoInfo.video.downloadAddr) {
            downloadUrl = videoInfo.video.downloadAddr;
        }
        
        if (!downloadUrl && videoInfo.video && videoInfo.video.bitrateInfo) {
            // 고화질 우선 선택
            const bitrateList = videoInfo.video.bitrateInfo;
            if (Array.isArray(bitrateList) && bitrateList.length > 0) {
                // 가장 높은 bitrate 선택
                const highestQuality = bitrateList.reduce((prev, current) => 
                    (prev.Bitrate > current.Bitrate) ? prev : current
                );
                if (highestQuality && highestQuality.PlayAddr && highestQuality.PlayAddr.UrlList) {
                    downloadUrl = highestQuality.PlayAddr.UrlList[0];
                }
            }
        }
        
        // 4. URL 정리 및 검증
        if (downloadUrl) {
            // 상대 URL을 절대 URL로 변환
            if (downloadUrl.startsWith('//')) {
                downloadUrl = 'https:' + downloadUrl;
            } else if (downloadUrl.startsWith('/')) {
                downloadUrl = 'https://www.tiktok.com' + downloadUrl;
            }
            
            // URL에서 워터마크 제거 파라미터 추가
            if (downloadUrl.includes('?')) {
                downloadUrl += '&watermark=0';
            } else {
                downloadUrl += '?watermark=0';
            }
        }
        
        return {
            downloadUrl,
            title: title.substring(0, 100), // 제목 길이 제한
            author,
            duration
        };
        
    } catch (error) {
        console.error('비디오 URL 추출 실패:', error);
        throw new Error(`비디오 URL 추출 실패: ${error.message}`);
    }
}

// JSON에서 비디오 정보 찾기
function findVideoInfo(obj) {
    if (obj && typeof obj === 'object') {
        // ItemModule에서 비디오 데이터 찾기
        if (obj.ItemModule) {
            for (const key in obj.ItemModule) {
                const item = obj.ItemModule[key];
                if (item && item.video && (item.video.playAddr || item.video.downloadAddr || item.video.bitrateInfo)) {
                    return item;
                }
            }
        }
        
        // 재귀적으로 찾기
        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                const result = findVideoInfo(obj[key]);
                if (result) return result;
            }
        }
    }
    
    return null;
}

// 파일명 생성
function generateFilename(videoUrl, videoData) {
    try {
        // TikTok 비디오 ID 추출
        const videoIdMatch = videoUrl.match(/\/video\/(\d+)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : Date.now().toString();
        
        // 작성자명 정리 (특수문자 제거)
        const cleanAuthor = videoData.author ? 
            videoData.author.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 20) : 
            'tiktok';
        
        // 제목 정리 (특수문자 제거)
        const cleanTitle = videoData.title ? 
            videoData.title.replace(/[^a-zA-Z0-9가-힣\s]/g, '_').substring(0, 30) : 
            '';
        
        // 파일명 조합
        let filename = `${cleanAuthor}_${videoId}`;
        if (cleanTitle) {
            filename += `_${cleanTitle}`;
        }
        filename += '.mp4';
        
        return filename;
        
    } catch (error) {
        console.error('파일명 생성 실패:', error);
        return `tiktok_video_${Date.now()}.mp4`;
    }
}
