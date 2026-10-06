const https = require('https');
const http = require('http');
const urlModule = require('url');
const path = require('path');

class UniversalExtractor {
    /**
     * Inspects any URL and auto-detects category, media formats, images, documents, and stream options.
     */
    static async extractInfo(url, options = {}) {
        if (!url || typeof url !== 'string') {
            throw new Error('Valid URL is required');
        }

        const parsed = urlModule.parse(url);
        const host = (parsed.hostname || '').toLowerCase();
        const pathname = (parsed.pathname || '').toLowerCase();

        // 1. Detect Direct Document / Archive / Binary File Extensions
        const docExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.zip', '.rar', '.7z', '.tar', '.gz', '.exe', '.msi', '.apk', '.iso', '.dmg'];
        const isDirectDoc = docExts.some(ext => pathname.endsWith(ext));

        // 2. Detect Image File Extensions
        const imgExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tiff', '.ico'];
        const isDirectImg = imgExts.some(ext => pathname.endsWith(ext));

        // 3. Detect Audio File Extensions
        const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus', '.wma'];
        const isDirectAudio = audioExts.some(ext => pathname.endsWith(ext));

        // 4. Detect Video File Extensions
        const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.3gp', '.m3u8', '.mpd'];
        const isDirectVideo = videoExts.some(ext => pathname.endsWith(ext));

        // 5. Detect Known Social / Video Streaming Platforms
        const isSocialPlatform = (
            host.includes('youtube.com') || host.includes('youtu.be') ||
            host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com') ||
            host.includes('instagram.com') || host.includes('tiktok.com') ||
            host.includes('twitter.com') || host.includes('x.com') ||
            host.includes('pinterest.com') || host.includes('pin.it') ||
            host.includes('reddit.com') || host.includes('vimeo.com') ||
            host.includes('dailymotion.com') || host.includes('twitch.tv') ||
            host.includes('soundcloud.com')
        );

        // 6. Probing Content-Type Header for unknown URLs
        let detectedType = 'file';
        let contentLength = 0;
        let mimeType = '';

        if (isSocialPlatform) {
            detectedType = 'video';
        } else if (isDirectVideo) {
            detectedType = 'video';
        } else if (isDirectAudio) {
            detectedType = 'audio';
        } else if (isDirectImg) {
            detectedType = 'image';
        } else if (isDirectDoc) {
            detectedType = 'document';
        } else {
            // Probe headers
            try {
                const headerInfo = await this.probeHeaders(url);
                mimeType = headerInfo.mimeType || '';
                contentLength = headerInfo.contentLength || 0;

                if (mimeType.startsWith('video/')) {
                    detectedType = 'video';
                } else if (mimeType.startsWith('audio/')) {
                    detectedType = 'audio';
                } else if (mimeType.startsWith('image/')) {
                    detectedType = 'image';
                } else if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('zip') || mimeType.includes('octet-stream')) {
                    detectedType = 'document';
                }
            } catch (e) {
                console.warn('Header probing failed for URL:', url, e.message);
            }
        }

        // Return unified metadata object
        return {
            url,
            detectedType, // 'video' | 'audio' | 'image' | 'document' | 'file'
            isSocialPlatform,
            mimeType,
            contentLength,
            fileName: path.basename(parsed.pathname || 'download'),
            host
        };
    }

    /**
     * Probes HTTP headers via HEAD request (or GET fallback)
     */
    static probeHeaders(targetUrl) {
        return new Promise((resolve) => {
            try {
                const parsed = urlModule.parse(targetUrl);
                const client = parsed.protocol === 'https:' ? https : http;

                const req = client.request(targetUrl, { method: 'HEAD', timeout: 4000 }, (res) => {
                    const mimeType = res.headers['content-type'] || '';
                    const contentLength = parseInt(res.headers['content-length'] || '0', 10);
                    resolve({ mimeType, contentLength });
                });

                req.on('error', () => resolve({ mimeType: '', contentLength: 0 }));
                req.on('timeout', () => { req.destroy(); resolve({ mimeType: '', contentLength: 0 }); });
                req.end();
            } catch (e) {
                resolve({ mimeType: '', contentLength: 0 });
            }
        });
    }
}

module.exports = UniversalExtractor;
