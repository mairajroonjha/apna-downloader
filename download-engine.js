const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

// Connection pooling agents (Keep-Alive)
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 });

class DownloadEngine extends EventEmitter {
    constructor(url, savePath, options = {}) {
        super();
        this.url = url;
        this.savePath = savePath;
        this.metaPath = savePath + '.meta';
        this.numConnections = options.numConnections || 8;
        this.referer = options.referer || null;
        this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
        this.status = 'idle'; // idle, connecting, downloading, paused, completed, failed
        this.totalSize = 0;
        this.supportsRanges = false;
        this.segments = [];
        this.activeRequests = [];
        this.fileHandles = [];
        
        // Speed tracking variables
        this.downloadedSinceLastTick = 0;
        this.speed = 0; // Bytes per second
        this.timeRemaining = -1; // Seconds
        this.speedTimer = null;
        this.speedLimit = options.speedLimit || null;
    }

    setSpeedLimit(limit) {
        this.speedLimit = limit;
    }

    // Helper to parse URL and get appropriate request module
    getRequestModule(targetUrl) {
        return targetUrl.startsWith('https') ? https : http;
    }

    requestWithRedirects(urlStr, options, headers, redirectCount = 0) {
        return new Promise((resolve, reject) => {
            if (redirectCount > 10) {
                reject(new Error('Too many redirects'));
                return;
            }

            const reqModule = this.getRequestModule(urlStr);
            const agent = urlStr.startsWith('https') ? httpsAgent : httpAgent;
            const reqOpts = { ...options, agent, headers: { ...headers } };

            const req = reqModule.request(urlStr, reqOpts, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        const nextUrl = new URL(redirectUrl, urlStr).toString();
                        res.resume();
                        this.requestWithRedirects(nextUrl, options, headers, redirectCount + 1)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }
                resolve({ res, req, finalUrl: urlStr });
            });

            this.activeRequests.push(req);

            req.on('error', (err) => {
                reject(err);
            });

            req.end();
        });
    }

    getExtensionFromMimeType(mime) {
        if (!mime) return '';
        const cleanMime = mime.split(';')[0].trim().toLowerCase();
        const map = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/bmp': 'bmp',
            'image/x-icon': 'ico',
            'text/html': 'html',
            'text/plain': 'txt',
            'application/pdf': 'pdf',
            'application/zip': 'zip',
            'application/x-rar-compressed': 'rar',
            'application/x-7z-compressed': '7z',
            'application/json': 'json',
            'audio/mpeg': 'mp3',
            'audio/ogg': 'ogg',
            'audio/wav': 'wav',
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/x-matroska': 'mkv'
        };
        return map[cleanMime] || '';
    }

    // Probes the URL to check for size and range support
    async probe() {
        const headers = {
            'User-Agent': this.userAgent
        };
        if (this.referer) {
            headers['Referer'] = this.referer;
        }

        let useRange = true;
        let res, req, finalUrl;

        // Try with Range header first
        try {
            const probeHeaders = { ...headers, 'Range': 'bytes=0-0' };
            const result = await this.requestWithRedirects(this.url, { method: 'GET' }, probeHeaders);
            res = result.res;
            req = result.req;
            finalUrl = result.finalUrl;

            if (res.statusCode >= 400) {
                res.resume();
                useRange = false; // Fallback
            }
        } catch (err) {
            useRange = false; // Fallback on network/request errors too
        }

        // If range failed or wasn't supported, retry without Range header
        if (!useRange) {
            try {
                const result = await this.requestWithRedirects(this.url, { method: 'GET' }, headers);
                res = result.res;
                req = result.req;
                finalUrl = result.finalUrl;

                if (res.statusCode >= 400) {
                    res.resume();
                    throw new Error(`Server returned status code ${res.statusCode} for ${this.url}`);
                }
            } catch (err) {
                throw new Error(`Connection failed: ${err.message}`);
            }
        }

        this.url = finalUrl;

        const acceptRanges = res.headers['accept-ranges'];
        const contentRange = res.headers['content-range'];
        
        this.supportsRanges = useRange && ((res.statusCode === 206) || (acceptRanges === 'bytes'));
        
        if (useRange && contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match) {
                this.totalSize = parseInt(match[1], 10);
            }
        } else if (res.headers['content-length']) {
            this.totalSize = parseInt(res.headers['content-length'], 10);
        }

        const contentType = res.headers['content-type'];
        if (contentType) {
            const mimeExt = this.getExtensionFromMimeType(contentType);
            if (mimeExt) {
                const currentExt = path.extname(this.savePath).toLowerCase();
                const currentExtWithoutDot = currentExt.substring(1);
                const genericExtensions = ['', 'html', 'htm', 'php', 'jsp', 'asp', 'aspx', 'ashx', 'cgi', 'do'];
                if (genericExtensions.includes(currentExtWithoutDot) && currentExtWithoutDot !== mimeExt) {
                    let newPath = this.savePath;
                    if (currentExt) {
                        newPath = this.savePath.substring(0, this.savePath.length - currentExt.length) + '.' + mimeExt;
                    } else {
                        newPath = this.savePath + '.' + mimeExt;
                    }
                    if (newPath !== this.savePath) {
                        this.savePath = newPath;
                        this.metaPath = newPath + '.meta';
                        this.emit('filePathChanged', this.savePath);
                    }
                }
            }
        }

        res.resume(); // Clean up probe stream

        // If content size is still 0, try a HEAD request
        if (!this.totalSize) {
            try {
                const headRes = await this.requestWithRedirects(this.url, { method: 'HEAD' }, headers);
                headRes.res.resume();
                if (headRes.res.headers['content-length']) {
                    this.totalSize = parseInt(headRes.res.headers['content-length'], 10);
                }
            } catch (e) {
                // Ignore HEAD error and proceed
            }
        }
    }

    // Pre-allocates the file on disk
    async preallocate() {
        if (this.totalSize > 0) {
            const fd = fs.openSync(this.savePath, 'w');
            fs.ftruncateSync(fd, this.totalSize);
            fs.closeSync(fd);
        } else {
            // Just create empty file if size is unknown
            fs.writeFileSync(this.savePath, '');
        }
    }

    // Initialize segments based on size and connections
    initSegments() {
        if (this.supportsRanges && this.totalSize > 0) {
            const segmentSize = Math.floor(this.totalSize / this.numConnections);
            this.segments = [];
            for (let i = 0; i < this.numConnections; i++) {
                const start = i * segmentSize;
                const end = (i === this.numConnections - 1) ? this.totalSize - 1 : (i + 1) * segmentSize - 1;
                this.segments.push({
                    id: i,
                    start: start,
                    end: end,
                    downloaded: 0,
                    completed: false
                });
            }
        } else {
            // Single segment fallback
            this.segments = [{
                id: 0,
                start: 0,
                end: this.totalSize ? this.totalSize - 1 : null,
                downloaded: 0,
                completed: false
            }];
        }
    }

    saveMetadata() {
        const metadata = {
            url: this.url,
            savePath: this.savePath,
            totalSize: this.totalSize,
            supportsRanges: this.supportsRanges,
            segments: this.segments
        };
        fs.writeFileSync(this.metaPath, JSON.stringify(metadata, null, 2));
    }

    loadMetadata() {
        if (fs.existsSync(this.metaPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
                this.url = data.url;
                this.savePath = data.savePath;
                this.totalSize = data.totalSize;
                this.supportsRanges = data.supportsRanges;
                this.segments = data.segments;
                return true;
            } catch (e) {
                console.error('Failed to load metadata', e);
            }
        }
        return false;
    }

    async start(resume = false) {
        if (this.status === 'downloading') return;

        this.status = 'connecting';
        this.emit('status', this.status);

        try {
            let metadataLoaded = false;
            if (resume) {
                metadataLoaded = this.loadMetadata();
            }

            if (!metadataLoaded) {
                await this.probe();
                await this.preallocate();
                this.initSegments();
                this.saveMetadata();
            }

            this.status = 'downloading';
            this.emit('status', this.status);

            this.activeRequests = [];
            this.fileHandles = [];

            // Start speed ticks
            this.startSpeedCalculation();

            // Spawn downloads
            const downloadPromises = this.segments.map(seg => this.downloadSegment(seg));
            
            Promise.all(downloadPromises).then(() => {
                this.cleanup();
                if (this.status === 'downloading') {
                    this.status = 'completed';
                    this.emit('status', this.status);
                    // Remove metadata on completion
                    if (fs.existsSync(this.metaPath)) {
                        fs.unlinkSync(this.metaPath);
                    }
                    this.emit('completed');
                }
            }).catch(async (err) => {
                if (this.status === 'downloading') {
                    if (this.numConnections > 1) {
                        console.warn(`[DownloadEngine] Multi-threaded download failed: "${err.message}". Falling back to single-threaded download...`);
                        this.cleanup();
                        
                        // Fallback to single thread
                        this.numConnections = 1;
                        this.supportsRanges = false;
                        
                        // Delete partial files to avoid corruptions from previous multi-thread offsets
                        try {
                            if (fs.existsSync(this.savePath)) fs.unlinkSync(this.savePath);
                            if (fs.existsSync(this.metaPath)) fs.unlinkSync(this.metaPath);
                        } catch (e) {}

                        // Restart download
                        this.status = 'idle'; // Reset status so start() works
                        try {
                            await this.start(false); // Start from scratch
                        } catch (fallbackErr) {
                            this.status = 'failed';
                            this.emit('status', this.status);
                            this.emit('error', fallbackErr);
                        }
                    } else {
                        this.cleanup();
                        this.status = 'failed';
                        this.emit('status', this.status);
                        this.emit('error', err);
                    }
                }
            });

        } catch (err) {
            this.cleanup();
            this.status = 'failed';
            this.emit('status', this.status);
            this.emit('error', err);
        }
    }

    async downloadSegment(segment) {
        if (segment.completed) return;

        const startPos = segment.start + segment.downloaded;
        const endPos = segment.end;
        
        const headers = {
            'User-Agent': this.userAgent
        };
        if (this.referer) {
            headers['Referer'] = this.referer;
        }

        // Use Range header if supported and size is known
        if (this.supportsRanges && endPos !== null) {
            headers['Range'] = `bytes=${startPos}-${endPos}`;
        }

        // Open file for read/write. 'r+' permits writing at random offsets.
        const fd = fs.openSync(this.savePath, 'r+');
        this.fileHandles.push(fd);

        let currentWriteOffset = startPos;

        try {
            const { res, req } = await this.requestWithRedirects(this.url, { method: 'GET' }, headers);
            this.activeRequests.push(req);

            if (res.statusCode >= 400) {
                res.resume();
                this.safeClose(fd);
                throw new Error(`Server returned status code ${res.statusCode} for ${this.url}`);
            }

            // Ensure ranges work if we requested them
            if (this.supportsRanges && res.statusCode !== 206 && startPos > 0) {
                res.resume();
                this.safeClose(fd);
                throw new Error(`Server did not respond with 206 Partial Content for range download. Status: ${res.statusCode}`);
            }

            return new Promise((resolve, reject) => {
                let segmentBytesWrittenThisSlice = 0;
                let sliceStartTime = Date.now();
                const sliceDuration = 100; // 100ms

                res.on('data', (chunk) => {
                    if (this.status !== 'downloading') {
                        res.destroy();
                        return;
                    }

                    try {
                        const now = Date.now();
                        if (now - sliceStartTime >= sliceDuration) {
                            segmentBytesWrittenThisSlice = 0;
                            sliceStartTime = now;
                        }

                        // Write chunk at the current write offset in file
                        fs.writeSync(fd, chunk, 0, chunk.length, currentWriteOffset);
                        currentWriteOffset += chunk.length;
                        segment.downloaded += chunk.length;
                        this.downloadedSinceLastTick += chunk.length;

                        // Emit update for segment progress
                        this.emit('segmentProgress', {
                            id: segment.id,
                            downloaded: segment.downloaded,
                            total: segment.end - segment.start + 1,
                            percentage: Math.min(100, (segment.downloaded / (segment.end - segment.start + 1)) * 100)
                        });

                        // Emit overall progress
                        this.emitProgress();

                        // Speed throttling check
                        if (this.speedLimit && this.speedLimit > 0) {
                            const activeSegments = this.segments.filter(s => !s.completed).length || 1;
                            const segmentLimit = this.speedLimit / activeSegments;
                            const sliceQuota = segmentLimit * (sliceDuration / 1000);
                            
                            segmentBytesWrittenThisSlice += chunk.length;
                            
                            if (segmentBytesWrittenThisSlice >= sliceQuota) {
                                const elapsed = Date.now() - sliceStartTime;
                                const delay = Math.max(0, sliceDuration - elapsed);
                                
                                res.pause();
                                setTimeout(() => {
                                    if (this.status === 'downloading') {
                                        res.resume();
                                    }
                                }, delay);
                                
                                segmentBytesWrittenThisSlice = 0;
                                sliceStartTime = Date.now() + delay; // adjust start time of next slice
                            }
                        }
                    } catch (writeErr) {
                        res.destroy();
                        reject(writeErr);
                    }
                });

                res.on('end', () => {
                    this.safeClose(fd);
                    
                    if (this.status === 'downloading') {
                        segment.completed = true;
                        this.saveMetadata();
                        resolve();
                    }
                });

                res.on('error', (err) => {
                    this.safeClose(fd);
                    reject(err);
                });
            });
        } catch (err) {
            this.safeClose(fd);
            throw err;
        }
    }

    safeClose(fd) {
        const idx = this.fileHandles.indexOf(fd);
        if (idx !== -1) {
            this.fileHandles.splice(idx, 1);
            try {
                fs.closeSync(fd);
            } catch (e) {}
        }
    }

    emitProgress() {
        const totalDownloaded = this.segments.reduce((acc, seg) => acc + seg.downloaded, 0);
        const percent = this.totalSize ? (totalDownloaded / this.totalSize) * 100 : 0;
        
        this.emit('progress', {
            downloaded: totalDownloaded,
            total: this.totalSize,
            percentage: Math.min(100, percent),
            speed: this.speed,
            timeRemaining: this.timeRemaining
        });
    }

    startSpeedCalculation() {
        this.speedTimer = setInterval(() => {
            this.speed = this.downloadedSinceLastTick;
            this.downloadedSinceLastTick = 0;

            const totalDownloaded = this.segments.reduce((acc, seg) => acc + seg.downloaded, 0);
            if (this.totalSize && this.speed > 0) {
                this.timeRemaining = Math.max(0, Math.ceil((this.totalSize - totalDownloaded) / this.speed));
            } else {
                this.timeRemaining = -1;
            }

            this.emitProgress();
        }, 1000);
    }

    pause() {
        if (this.status !== 'downloading') return;
        this.status = 'paused';
        this.cleanup();
        this.saveMetadata();
        this.emit('status', this.status);
    }

    cancel() {
        this.status = 'idle';
        this.cleanup();
        if (fs.existsSync(this.metaPath)) {
            fs.unlinkSync(this.metaPath);
        }
        if (fs.existsSync(this.savePath)) {
            fs.unlinkSync(this.savePath);
        }
        this.emit('status', this.status);
    }

    cleanup() {
        // Stop speed timer
        if (this.speedTimer) {
            clearInterval(this.speedTimer);
            this.speedTimer = null;
        }

        // Abort all requests
        this.activeRequests.forEach(req => {
            try { req.destroy(); } catch (e) {}
        });
        this.activeRequests = [];

        // Close all file handles safely
        const handles = [...this.fileHandles];
        handles.forEach(fd => this.safeClose(fd));
        this.fileHandles = [];
    }
}

module.exports = DownloadEngine;
