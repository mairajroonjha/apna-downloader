const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, exec } = require('child_process');
const { EventEmitter } = require('events');
const DownloadEngine = require('./download-engine');

class YtDlpDownloader extends EventEmitter {
    constructor(url, savePath, options = {}) {
        super();
        this.url = url;
        this.savePath = savePath;
        const { app } = require('electron');
        const isWin = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        this.binName = isWin ? 'yt-dlp.exe' : (isMac ? 'yt-dlp_macos' : 'yt-dlp');

        // 1. Resolve local installation directory bin folder
        let localDir = path.join(__dirname, 'bin');
        if (localDir.includes('app.asar')) {
            localDir = localDir.replace('app.asar', 'app.asar.unpacked');
        }

        // 2. Resolve process resources directory bin folder
        const resourcesBin = process.resourcesPath ? path.join(process.resourcesPath, 'bin') : localDir;

        // 3. Resolve user data directory bin folder (always writable)
        const userDir = path.join(app.getPath('userData'), 'bin');

        // If binaries exist in localDir or resourcesBin, use that.
        // Otherwise, fallback to writable user directory.
        if (fs.existsSync(path.join(localDir, this.binName))) {
            this.binDir = localDir;
        } else if (fs.existsSync(path.join(resourcesBin, this.binName))) {
            this.binDir = resourcesBin;
        } else {
            this.binDir = userDir;
        }
        this.binPath = path.join(this.binDir, this.binName);
        
        this.status = 'idle'; // idle, connecting, downloading, paused, completed, failed
        this.quality = options.quality || null;
        this.referer = options.referer || null;
        this.rateLimit = options.rateLimit || null; // in KB/s
        this.downloadSubtitles = options.downloadSubtitles || false;
        
        // Progress state
        this.totalSize = options.totalSize || 0;
        this.downloaded = options.downloaded || 0;
        this.percentage = this.totalSize > 0 ? (this.downloaded / this.totalSize) * 100 : 0;
        this.speed = 0; // bytes per second
        this.timeRemaining = 0; // seconds

        this.videoSize = this.totalSize > 0 ? Math.round(this.totalSize * 0.85) : 0;
        this.audioSize = 0;
        this.isDownloadingAudioTrack = false;
        this.videoCompleted = false;
        this.audioCompleted = false;
        this.timeRemaining = -1; // seconds
        
        this.childProcess = null;
        this.isKilled = false;
    }

    setSpeedLimit(limit) {
        if (limit) {
            this.rateLimit = Math.max(1, Math.floor(limit / 1024));
        } else {
            this.rateLimit = null;
        }
    }

    // Helper to download yt-dlp binary with redirects and progress
    async ensureBinary() {
        if (!fs.existsSync(this.binPath)) {
            if (!fs.existsSync(this.binDir)) {
                fs.mkdirSync(this.binDir, { recursive: true });
            }

            this.status = 'connecting';
            this.emit('status', this.status);
            this.emit('progress', {
                downloaded: 0,
                total: 100,
                percentage: 0,
                speed: 0,
                timeRemaining: -1,
                customMessage: 'Downloading grabber engine...'
            });

            const isWin = process.platform === 'win32';
            const isMac = process.platform === 'darwin';
            const binaryName = isWin ? 'yt-dlp.exe' : (isMac ? 'yt-dlp_macos' : 'yt-dlp');
            const binaryUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;

            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(this.binPath);
                
                file.on('finish', () => {
                    // Set execution permissions on non-windows platforms
                    if (process.platform !== 'win32') {
                        try {
                            fs.chmodSync(this.binPath, 0o755);
                        } catch (e) {
                            console.error('Failed to set execute permissions on yt-dlp', e);
                        }
                    }
                    resolve();
                });

                file.on('error', (err) => {
                    file.end();
                    try { fs.unlinkSync(this.binPath); } catch (e) {}
                    reject(err);
                });

                const download = (url) => {
                    https.get(url, (res) => {
                        // Follow redirects
                        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                            const redirectUrl = res.headers.location;
                            if (redirectUrl) {
                                download(redirectUrl);
                                return;
                            }
                        }

                        if (res.statusCode !== 200) {
                            file.end();
                            try { fs.unlinkSync(this.binPath); } catch (e) {}
                            reject(new Error(`Failed to download yt-dlp: HTTP Status ${res.statusCode}`));
                            return;
                        }

                        const totalSize = parseInt(res.headers['content-length'], 10) || 16000000;
                        let downloadedBytes = 0;

                        res.on('data', (chunk) => {
                            downloadedBytes += chunk.length;
                            file.write(chunk);
                            
                            const percent = (downloadedBytes / totalSize) * 100;
                            this.emit('progress', {
                                downloaded: downloadedBytes,
                                total: totalSize,
                                percentage: Math.min(100, percent),
                                speed: 0,
                                timeRemaining: -1,
                                customMessage: `Downloading grabber engine: ${Math.round(percent)}%`
                            });
                        });

                        res.on('end', () => {
                            file.end();
                        });

                        res.on('error', (err) => {
                            file.end();
                            try { fs.unlinkSync(this.binPath); } catch (e) {}
                            reject(err);
                        });
                    }).on('error', (err) => {
                        file.end();
                        try { fs.unlinkSync(this.binPath); } catch (e) {}
                        reject(err);
                    });
                };

                download(binaryUrl);
            });
        }

        // Always check and ensure ffmpeg is available
        await this.ensureFfmpeg();
    }

    async ensureFfmpeg() {
        const isWin = process.platform === 'win32';
        const isMac = process.platform === 'darwin';
        
        const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
        const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe';
        
        const ffmpegPath = path.join(this.binDir, ffmpegName);
        const ffprobePath = path.join(this.binDir, ffprobeName);
        
        // 1. Check if they exist locally
        const hasLocalFfmpeg = fs.existsSync(ffmpegPath);
        const hasLocalFfprobe = fs.existsSync(ffprobePath);

        if (hasLocalFfmpeg && hasLocalFfprobe) {
            return;
        }

        // 2. Check if available globally
        const checkCmd = isWin ? 'where' : 'which';
        const hasGlobalFfmpeg = await new Promise((resolve) => {
            exec(`${checkCmd} ffmpeg`, (err) => {
                resolve(!err);
            });
        });
        const hasGlobalFfprobe = await new Promise((resolve) => {
            exec(`${checkCmd} ffprobe`, (err) => {
                resolve(!err);
            });
        });

        if (hasGlobalFfmpeg && hasGlobalFfprobe) {
            console.log('Global ffmpeg and ffprobe found, skipping local download.');
            return;
        }

        // Download ffmpeg if needed
        if (!hasLocalFfmpeg && !hasGlobalFfmpeg) {
            console.log('Downloading ffmpeg binary...');
            this.emit('progress', {
                downloaded: 0,
                total: 100,
                percentage: 0,
                speed: 0,
                timeRemaining: -1,
                customMessage: 'Downloading video processing engine (ffmpeg)...'
            });

            let platformStr = 'linux-64';
            if (isWin) platformStr = 'win-64';
            else if (isMac) platformStr = 'osx-64';

            const zipPath = path.join(this.binDir, 'ffmpeg.zip');
            const ffmpegUrl = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-${platformStr}.zip`;

            const engine = new DownloadEngine(ffmpegUrl, zipPath, { numConnections: 8 });
            await new Promise((resolve, reject) => {
                engine.on('progress', (data) => {
                    this.emit('progress', {
                        downloaded: data.downloaded,
                        total: data.total,
                        percentage: data.percentage,
                        speed: data.speed,
                        timeRemaining: data.timeRemaining,
                        customMessage: `Downloading video processing engine: ${Math.round(data.percentage)}%`
                    });
                });
                engine.on('completed', () => resolve());
                engine.on('error', (err) => reject(err));
                engine.start();
            });

            // Extract ffmpeg.zip using native windows tar
            console.log('Extracting ffmpeg.zip...');
            this.emit('progress', {
                downloaded: 100,
                total: 100,
                percentage: 100,
                speed: 0,
                timeRemaining: -1,
                customMessage: 'Extracting video processing engine...'
            });

            await new Promise((resolve, reject) => {
                exec(`tar -xf "${zipPath}" -C "${this.binDir}"`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Set execution permissions on macOS/Linux
            if (!isWin) {
                try {
                    if (fs.existsSync(ffmpegPath)) fs.chmodSync(ffmpegPath, 0o755);
                } catch (e) {
                    console.error('Failed to set execution permissions on ffmpeg', e);
                }
            }

            try { fs.unlinkSync(zipPath); } catch (e) {}
        }

        // Download ffprobe if needed
        if (!hasLocalFfprobe && !hasGlobalFfprobe) {
            console.log('Downloading ffprobe binary...');
            this.emit('progress', {
                downloaded: 0,
                total: 100,
                percentage: 0,
                speed: 0,
                timeRemaining: -1,
                customMessage: 'Downloading analysis engine (ffprobe)...'
            });

            let platformStr = 'linux-64';
            if (isWin) platformStr = 'win-64';
            else if (isMac) platformStr = 'osx-64';

            const zipPath = path.join(this.binDir, 'ffprobe.zip');
            const ffprobeUrl = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffprobe-4.4.1-${platformStr}.zip`;

            const engine = new DownloadEngine(ffprobeUrl, zipPath, { numConnections: 8 });
            await new Promise((resolve, reject) => {
                engine.on('progress', (data) => {
                    this.emit('progress', {
                        downloaded: data.downloaded,
                        total: data.total,
                        percentage: data.percentage,
                        speed: data.speed,
                        timeRemaining: data.timeRemaining,
                        customMessage: `Downloading analysis engine: ${Math.round(data.percentage)}%`
                    });
                });
                engine.on('completed', () => resolve());
                engine.on('error', (err) => reject(err));
                engine.start();
            });

            // Extract ffprobe.zip using native windows tar
            console.log('Extracting ffprobe.zip...');
            this.emit('progress', {
                downloaded: 100,
                total: 100,
                percentage: 100,
                speed: 0,
                timeRemaining: -1,
                customMessage: 'Extracting analysis engine...'
            });

            await new Promise((resolve, reject) => {
                exec(`tar -xf "${zipPath}" -C "${this.binDir}"`, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Set execution permissions on macOS/Linux
            if (!isWin) {
                try {
                    if (fs.existsSync(ffprobePath)) fs.chmodSync(ffprobePath, 0o755);
                } catch (e) {
                    console.error('Failed to set execution permissions on ffprobe', e);
                }
            }

            try { fs.unlinkSync(zipPath); } catch (e) {}
        }

        console.log('ffmpeg and ffprobe successfully installed!');
    }

    async getFormatSizes() {
        return new Promise((resolve) => {
            const args = [
                this.url,
                '--dump-single-json',
                '--no-warnings',
                '-J'
            ];
            
            const spawnEnv = { ...process.env };
            const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
            spawnEnv[pathKey] = `${this.binDir}${path.delimiter}${spawnEnv[pathKey] || ''}`;
            
            console.log('[YtDlpDownloader] Fetching dynamic format sizes for pre-calc:', this.binPath, args.join(' '));
            
            const child = spawn(this.binPath, args, { env: spawnEnv });
            let stdoutData = '';
            
            child.stdout.on('data', chunk => stdoutData += chunk.toString());
            
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const parsed = JSON.parse(stdoutData);
                        let vSize = 0;
                        let aSize = 0;
                        
                        if (parsed.formats) {
                            const targetHeight = this.quality ? parseInt(this.quality.replace('p', ''), 10) : null;
                            const videoFormats = parsed.formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none');
                            const audioFormats = parsed.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
                            
                            let matchingVideo = videoFormats;
                            if (targetHeight && !isNaN(targetHeight)) {
                                matchingVideo = videoFormats.filter(f => f.height && f.height <= targetHeight);
                            }
                            
                            matchingVideo.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
                            audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                            
                            const bestVideo = matchingVideo[0] || videoFormats[0];
                            const bestAudio = audioFormats[0];
                            
                            if (bestVideo) {
                                vSize = bestVideo.filesize || bestVideo.filesize_approx || 0;
                            }
                            if (bestAudio) {
                                aSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
                            }
                        }
                        resolve({ videoSize: vSize, audioSize: aSize });
                    } catch (e) {
                        console.error('[YtDlpDownloader] Error parsing format JSON:', e);
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
            
            child.on('error', () => resolve(null));
        });
    }

    async start(resume = false) {
        if (this.status === 'downloading') return;
        this.isKilled = false;

        try {
            await this.ensureBinary();

            // Fetch exact formats size at start if not set, to make total size display instantly
            if (this.url.startsWith('http') && !this.videoSize && !this.audioSize && (this.url.includes('youtube.com') || this.url.includes('youtu.be')) && this.quality !== 'audio') {
                try {
                    const sizes = await this.getFormatSizes();
                    if (sizes && sizes.videoSize > 0) {
                        this.videoSize = sizes.videoSize;
                        this.audioSize = sizes.audioSize;
                        this.totalSize = this.videoSize + this.audioSize;
                    }
                } catch (e) {
                    console.error('[YtDlpDownloader] Failed to pre-fetch format sizes:', e);
                }
            }
            
            this.status = 'downloading';
            this.emit('status', this.status);

            // Configure yt-dlp arguments
            // Configure yt-dlp arguments based on selected quality
            const args = [this.url];

            if (this.quality === 'subtitles') {
                args.push(
                    '--skip-download',
                    '--write-subs',
                    '--write-auto-subs',
                    '--convert-subs', 'srt',
                    '--sub-langs', 'en,ur,hi'
                );
            } else if (this.quality === 'audio') {
                args.push(
                    '-f', 'bestaudio/best',
                    '--extract-audio',
                    '--audio-format', 'mp3',
                    '--audio-quality', '0'
                );
            } else if (this.quality === '2160p') {
                args.push('-f', 'bestvideo[height<=2160]+bestaudio/best');
            } else if (this.quality === '1440p') {
                args.push('-f', 'bestvideo[height<=1440]+bestaudio/best');
            } else if (this.quality === '1080p') {
                args.push('-f', 'bestvideo[height<=1080]+bestaudio/best');
            } else if (this.quality === '720p') {
                args.push('-f', 'bestvideo[height<=720]+bestaudio/best');
            } else if (this.quality === '480p') {
                args.push('-f', 'bestvideo[height<=480]+bestaudio/best');
            } else if (this.quality === '360p') {
                args.push('-f', 'bestvideo[height<=360]+bestaudio/best');
            } else if (this.quality === '240p') {
                args.push('-f', 'bestvideo[height<=240]+bestaudio/best');
            } else if (this.quality === '144p') {
                args.push('-f', 'bestvideo[height<=144]+bestaudio/best');
            } else {
                // Default: safest merged format
                args.push('-f', 'bestvideo+bestaudio/best');
            }

            if (this.quality !== 'subtitles' && this.downloadSubtitles) {
                args.push(
                    '--write-subs',
                    '--write-auto-subs',
                    '--convert-subs', 'srt',
                    '--sub-langs', 'en,ur,hi'
                );
            }

            let outputTemplate = this.savePath;
            if (this.quality === 'subtitles') {
                const ext = path.extname(this.savePath);
                if (ext.toLowerCase() === '.srt') {
                    outputTemplate = this.savePath.substring(0, this.savePath.length - ext.length);
                }
            }

            args.push(
                '-o', outputTemplate,
                '--newline',
                '--no-playlist',
                '--ignore-errors',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--extractor-args', 'youtube:player_client=android,web'
            );

            if (this.referer) {
                args.push('--referer', this.referer);
            }

            if (this.rateLimit) {
                args.push('--limit-rate', `${this.rateLimit}K`);
            }

            // Inject binDir into PATH so that yt-dlp can locate ffmpeg and ffprobe natively
            const spawnEnv = { ...process.env };
            const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
            spawnEnv[pathKey] = `${this.binDir}${path.delimiter}${spawnEnv[pathKey] || ''}`;

            console.log('Spawning yt-dlp:', this.binPath, args.join(' '));
            this.childProcess = spawn(this.binPath, args, { env: spawnEnv });

            this.childProcess.stdout.on('data', (data) => {
                const line = data.toString().trim();
                this.parseOutput(line);
            });

            this.childProcess.stderr.on('data', (data) => {
                console.warn('[yt-dlp stderr]:', data.toString());
            });

            this.childProcess.on('close', (code) => {
                if (this.isKilled) return;

                // Check if final path exists, if not, scan for alternative extensions
                if (!fs.existsSync(this.savePath)) {
                    const dir = path.dirname(this.savePath);
                    const ext = path.extname(this.savePath);
                    const baseName = path.basename(this.savePath, ext);
                    
                    if (fs.existsSync(dir)) {
                        if (this.quality === 'subtitles') {
                            const files = fs.readdirSync(dir);
                            const matchSub = files.find(f => f.startsWith(baseName + '.') && f.endsWith('.srt'));
                            if (matchSub) {
                                try {
                                    fs.renameSync(path.join(dir, matchSub), this.savePath);
                                    console.log(`[yt-dlp] Renamed subtitle file ${matchSub} to ${this.savePath}`);
                                } catch (e) {
                                    console.error('Failed to rename subtitle file:', e);
                                }
                            }
                        } else {
                            const files = fs.readdirSync(dir);
                            const matchFile = files.find(f => {
                                const fExt = path.extname(f).toLowerCase();
                                const fBase = path.basename(f, fExt);
                                return fBase === baseName && ['.mp4', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.flac', '.ogg'].includes(fExt);
                            });
                            
                            if (matchFile) {
                                const newPath = path.join(dir, matchFile);
                                console.log(`[yt-dlp] File at original path didn't exist, found matching file: ${newPath}`);
                                this.savePath = newPath;
                                this.emit('filePathChanged', newPath);
                            }
                        }
                    }
                }

                const minSize = this.quality === 'subtitles' ? 0 : 1024;
                const fileExists = fs.existsSync(this.savePath) && fs.statSync(this.savePath).size > minSize;

                if (code === 0 || fileExists) {
                    if (code !== 0) {
                        console.warn(`[yt-dlp] exited with code ${code} but save file exists. Treating as completed.`);
                    }
                    this.percentage = 100;
                    this.downloaded = this.totalSize;
                    this.emit('progress', {
                        downloaded: this.totalSize,
                        total: this.totalSize,
                        percentage: 100,
                        speed: 0,
                        timeRemaining: 0,
                        statusDetail: 'Completed'
                    });
                    this.status = 'completed';
                    this.emit('status', this.status);
                    this.emit('completed');
                } else {
                    this.status = 'failed';
                    this.emit('status', this.status);
                    this.emit('error', new Error(`yt-dlp exited with code ${code}`));
                }
            });

        } catch (err) {
            this.status = 'failed';
            this.emit('status', this.status);
            this.emit('error', err);
        }
    }

    parseOutput(line) {
        // Parse actual final output path if printed by yt-dlp or ffmpeg postprocessors
        if (line.startsWith('[ExtractAudio] Destination:')) {
            this.statusDetail = 'Extracting audio...';
            const match = line.match(/Destination:\s*(.+)/);
            if (match) {
                const finalPath = match[1].trim();
                this.savePath = finalPath;
                this.emit('filePathChanged', finalPath);
            }
        } else if (line.includes('has already been downloaded')) {
            const isAudioTrack = line.includes('.f140.') || 
                                 line.includes('.f251.') || 
                                 line.includes('.f249.') || 
                                 line.includes('.f250.') || 
                                 line.includes('.f171.') || 
                                 line.includes('.f139.') ||
                                 line.endsWith('.m4a');
            if (isAudioTrack) {
                this.audioCompleted = true;
            } else {
                this.videoCompleted = true;
            }
        } else if (line.startsWith('[ffmpeg] Merging formats into')) {
            this.statusDetail = 'Merging...';
            const match = line.match(/Merging formats into\s*"([^"]+)"/) || line.match(/Merging formats into\s*(.+)/);
            if (match) {
                const finalPath = match[1].trim();
                this.savePath = finalPath;
                this.emit('filePathChanged', finalPath);
            }
        } else if (line.startsWith('[download] Destination:')) {
            const match = line.match(/Destination:\s*(.+)/);
            if (match) {
                const finalPath = match[1].trim();
                
                const isAudioTrack = finalPath.includes('.f140.') || 
                                     finalPath.includes('.f251.') || 
                                     finalPath.includes('.f249.') || 
                                     finalPath.includes('.f250.') || 
                                     finalPath.includes('.f171.') || 
                                     finalPath.includes('.f139.') ||
                                     finalPath.endsWith('.m4a');
                
                if (this.quality === 'audio') {
                    this.statusDetail = 'Downloading...';
                    this.isDownloadingAudioTrack = true;
                } else {
                    if (isAudioTrack) {
                        if (!this.isDownloadingAudioTrack) {
                            this.videoCompleted = true;
                        }
                        this.isDownloadingAudioTrack = true;
                        this.statusDetail = 'Downloading...';
                    } else {
                        if (this.isDownloadingAudioTrack) {
                            this.audioCompleted = true;
                        }
                        this.isDownloadingAudioTrack = false;
                        this.statusDetail = 'Downloading...';
                    }
                }

                const isSubtitle = finalPath.endsWith('.vtt') || 
                                   finalPath.endsWith('.srt') || 
                                   finalPath.endsWith('.ass') || 
                                   finalPath.endsWith('.sbv') ||
                                   finalPath.endsWith('.lrc');
                
                if (!finalPath.endsWith('.part') && !/\.f\d+\./.test(finalPath) && !isSubtitle) {
                    this.savePath = finalPath;
                    this.emit('filePathChanged', finalPath);
                }
            }
        }

        // Example output: [download]  12.5% of  45.16MiB at   5.12MiB/s ETA 00:07
        if (line.startsWith('[download]')) {
            const percentRegex = /\s+(\d+(?:\.\d+)?)%/;
            const sizeRegex = /of\s+(\d+(?:\.\d+)?)\s*(\w+)/;
            const speedRegex = /at\s+(\d+(?:\.\d+)?)\s*(\w+\/s)/;
            const etaRegex = /ETA\s+(\d+:\d+(?::\d+)?)/;

            const percentMatch = line.match(percentRegex);
            const sizeMatch = line.match(sizeRegex);
            const speedMatch = line.match(speedRegex);
            const etaMatch = line.match(etaRegex);

            if (percentMatch) {
                const currentPercent = parseFloat(percentMatch[1]);
                
                // Scale split tracks to continuous overall progress internally
                if (this.quality !== 'audio' && !this.isDownloadingAudioTrack) {
                    this.percentage = currentPercent * 0.85;
                } else if (this.quality !== 'audio' && this.isDownloadingAudioTrack) {
                    this.percentage = 85 + (currentPercent * 0.15);
                } else {
                    this.percentage = currentPercent;
                }
            }

            if (sizeMatch) {
                const currentStreamSize = this.convertSizeToBytes(parseFloat(sizeMatch[1]), sizeMatch[2]);
                const currentStreamPercent = percentMatch ? parseFloat(percentMatch[1]) : 0;
                
                if (this.quality !== 'audio' && !this.isDownloadingAudioTrack) {
                    this.videoSize = currentStreamSize;
                    // Estimate combined size (video accounts for 85% of total size visually)
                    this.totalSize = Math.round(this.videoSize / 0.85);
                    this.downloaded = Math.round((currentStreamPercent / 100) * this.videoSize);
                } else if (this.quality !== 'audio' && this.isDownloadingAudioTrack) {
                    this.audioSize = currentStreamSize;
                    // Calculate exact combined size
                    this.totalSize = this.videoSize + this.audioSize;
                    this.downloaded = this.videoSize + Math.round((currentStreamPercent / 100) * this.audioSize);
                } else {
                    // Single stream
                    this.totalSize = currentStreamSize;
                    this.downloaded = Math.round((currentStreamPercent / 100) * this.totalSize);
                }
            }

            if (speedMatch) {
                this.speed = this.convertSpeedToBytesPerSec(parseFloat(speedMatch[1]), speedMatch[2]);
            }

            if (etaMatch) {
                this.timeRemaining = this.convertEtaToSeconds(etaMatch[1]);
            }

            // Emit overall progress
            this.emit('progress', {
                downloaded: this.downloaded,
                total: this.totalSize,
                percentage: this.percentage,
                speed: this.speed,
                timeRemaining: this.timeRemaining,
                statusDetail: this.statusDetail
            });

            // Replicate segment progress so that the 8-thread connection visualizer shows activity!
            // We can distribute the progress across 8 connection slots dynamically
            const numSegments = 8;
            for (let i = 0; i < numSegments; i++) {
                // Determine a staggered progress percentage for each simulated thread
                let segPercent = 0;
                const offset = i * (100 / numSegments);
                if (this.percentage >= offset + (100 / numSegments)) {
                    segPercent = 100;
                } else if (this.percentage > offset) {
                    segPercent = ((this.percentage - offset) / (100 / numSegments)) * 100;
                }
                
                this.emit('segmentProgress', {
                    id: i,
                    downloaded: Math.round((segPercent / 100) * (this.totalSize / numSegments)),
                    total: Math.round(this.totalSize / numSegments),
                    percentage: segPercent
                });
            }
        }
    }

    convertSizeToBytes(value, unit) {
        const u = unit.toLowerCase();
        if (u.startsWith('k')) return value * 1024;
        if (u.startsWith('m')) return value * 1024 * 1024;
        if (u.startsWith('g')) return value * 1024 * 1024 * 1024;
        return value;
    }

    convertSpeedToBytesPerSec(value, unit) {
        const u = unit.toLowerCase();
        if (u.startsWith('k')) return value * 1024;
        if (u.startsWith('m')) return value * 1024 * 1024;
        if (u.startsWith('g')) return value * 1024 * 1024 * 1024;
        return value;
    }

    convertEtaToSeconds(etaStr) {
        const parts = etaStr.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1]; // mm:ss
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
        }
        return -1;
    }

    pause() {
        // Note: yt-dlp processes are usually simple CLI downloads. Pausing isn't directly supported by yt-dlp unless we pause the process OS thread,
        // but it is simpler to kill the download process, and upon resume, let it restart (yt-dlp automatically resumes incomplete downloads natively if we don't delete files!).
        // This is extremely robust and works perfectly.
        this.status = 'paused';
        this.cleanup();
        this.emit('status', this.status);
    }

    cancel() {
        this.status = 'idle';
        this.cleanup();
        
        // Clean up partial files
        try {
            if (fs.existsSync(this.savePath)) fs.unlinkSync(this.savePath);
            const partPath = this.savePath + '.part';
            if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        } catch (e) {}

        this.emit('status', this.status);
    }

    cleanup() {
        this.isKilled = true;
        if (this.childProcess) {
            const pid = this.childProcess.pid;
            try {
                if (process.platform === 'win32') {
                    const { exec } = require('child_process');
                    exec(`taskkill /F /T /PID ${pid}`, (err) => {
                        if (err) {
                            console.warn(`[yt-dlp] taskkill failed:`, err);
                            try { this.childProcess.kill(); } catch (e) {}
                        }
                    });
                } else {
                    this.childProcess.kill();
                }
            } catch (e) {
                console.error('[yt-dlp] Failed to kill process:', e);
            }
            this.childProcess = null;
        }
    }
}

module.exports = YtDlpDownloader;
