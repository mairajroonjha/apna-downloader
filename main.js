const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Notification, Tray, Menu } = require('electron');

// Optimize memory usage (saves 50MB - 100MB RAM)
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128 --expose-gc');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-gpu-program-cache');

const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { exec, spawn } = require('child_process');
const DownloadEngine = require('./download-engine');
const YtDlpDownloader = require('./yt-dlp-downloader');
const settingsManager = require('./settings-manager');
const MediaConverter = require('./converter');

let mainWindow = null;
let authWindow = null;
let progressWindows = {}; // keyed by download id
let activeConverters = {}; // keyed by download id
let downloads = [];
let localServer = null;
const dbPath = path.join(app.getPath('userData'), 'downloads_db.json');

let tray = null;
let isQuitting = false;
let hasShownMinimizeNotification = false;

let settings = settingsManager.load();

let licenseStatus = {
    status: 'trial', // 'trial', 'active', 'expired'
    limits: {
        maxSegments: 16,
        maxSpeedBytes: 10485760 // 10 MB/s
    }
};

const BACKEND_URL = "https://apna-downloader-backend.mirajroonjha.workers.dev"; // Cloudflare Workers subdomain

async function verifyLicenseStatus() {
    if (!settings.authToken) return { success: false, status: 'unauthorized', message: 'Auth token missing' };
    if (!settings.deviceId) {
        settings.deviceId = require('crypto').randomUUID();
        settingsManager.save(settings);
    }
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/license/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.authToken}`
            },
            body: JSON.stringify({ deviceId: settings.deviceId })
        });
        
        if (!response.ok) {
            return { success: false, status: 'error', message: 'License server returned an error.' };
        }
        
        const data = await response.json();
        return data;
    } catch (e) {
        console.error('License verification failed:', e);
        // Offline mode fallback: safe local limits
        return { 
            success: true, 
            status: 'trial', 
            limits: { maxSegments: 16, maxSpeedBytes: 10485760 } 
        };
    }
}

// Queue and Bandwidth Management Helpers
function processQueue() {
    if (!settings.queueEnabled) return;
    
    // Count active downloads
    const activeCount = downloads.filter(d => d.status === 'downloading' || d.status === 'connecting').length;
    const slotsAvailable = settings.maxConcurrentDownloads - activeCount;
    
    if (slotsAvailable <= 0) return;
    
    // Find next queued/idle downloads (oldest first, so reverse the unshifted list)
    const queuedItems = downloads.filter(d => d.status === 'queued' || d.status === 'idle').reverse();
    
    for (let i = 0; i < Math.min(slotsAvailable, queuedItems.length); i++) {
        const item = queuedItems[i];
        console.log(`[Queue] Auto-starting queued download: ${item.filename}`);
        startDownload(item);
    }
}

function updateActiveDownloadLimits() {
    const activeDownloads = Object.values(activeEngines);
    const activeCount = activeDownloads.length;
    
    if (activeCount === 0) return;
    
    // Check if we have trial limitations
    const isTrialLimit = licenseStatus && licenseStatus.status === 'trial';
    const trialSpeedLimit = isTrialLimit ? licenseStatus.limits.maxSpeedBytes : null;
    
    if (settings.speedLimitEnabled && settings.maxSpeedLimit > 0) {
        // Convert KB/s to Bytes/s
        const totalLimitBytes = settings.maxSpeedLimit * 1024;
        let limitPerDownload = Math.floor(totalLimitBytes / activeCount);
        
        // Trial limit applies if it is lower!
        if (trialSpeedLimit) {
            const trialLimitPerDownload = Math.floor(trialSpeedLimit / activeCount);
            limitPerDownload = Math.min(limitPerDownload, trialLimitPerDownload);
        }
        
        activeDownloads.forEach(engine => {
            if (typeof engine.setSpeedLimit === 'function') {
                engine.setSpeedLimit(limitPerDownload);
            }
        });
    } else if (trialSpeedLimit) {
        // Enforce trial speed limit even if user speed limit is disabled!
        const limitPerDownload = Math.floor(trialSpeedLimit / activeCount);
        activeDownloads.forEach(engine => {
            if (typeof engine.setSpeedLimit === 'function') {
                engine.setSpeedLimit(limitPerDownload);
            }
        });
    } else {
        // No limit
        activeDownloads.forEach(engine => {
            if (typeof engine.setSpeedLimit === 'function') {
                engine.setSpeedLimit(null);
            }
        });
    }
}

// Scheduler checking routine
let schedulerInterval = null;
function startSchedulerRoutine() {
    if (schedulerInterval) clearInterval(schedulerInterval);
    
    schedulerInterval = setInterval(() => {
        if (!settings.schedulerEnabled) return;
        
        const now = new Date();
        const currentHrsMins = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        if (currentHrsMins === settings.schedulerStart) {
            console.log('[Scheduler] Triggering start action...');
            let triggeredAny = false;
            downloads.forEach(d => {
                if (d.status === 'queued' || d.status === 'paused' || d.status === 'idle') {
                    if (settings.queueEnabled) {
                        d.status = 'queued';
                    } else {
                        startDownload(d);
                        triggeredAny = true;
                    }
                }
            });
            if (settings.queueEnabled) {
                processQueue();
                triggeredAny = true;
            }
            if (triggeredAny) {
                saveDownloads();
                broadcast('download-list-updated', downloads);
            }
        } else if (currentHrsMins === settings.schedulerStop) {
            console.log(`[Scheduler] Triggering stop action (${settings.schedulerAction})...`);
            if (settings.schedulerAction === 'pause') {
                Object.keys(activeEngines).forEach(id => {
                    const engine = activeEngines[id];
                    if (engine) engine.pause();
                });
            } else if (settings.schedulerAction === 'exit') {
                app.quit();
            }
        }
    }, 30000); // Check every 30 seconds
}

// Clipboard Monitoring
let clipboardInterval = null;
let lastClipboardText = '';
function startClipboardMonitor() {
    if (clipboardInterval) clearInterval(clipboardInterval);
    
    try {
        lastClipboardText = clipboard.readText();
    } catch (e) {}

    clipboardInterval = setInterval(() => {
        if (!settings.clipboardMonitorEnabled) return;
        
        try {
            const currentText = clipboard.readText().trim();
            if (currentText && currentText !== lastClipboardText) {
                lastClipboardText = currentText;
                
                if (currentText.startsWith('http://') || currentText.startsWith('https://')) {
                    const pathLower = currentText.toLowerCase();
                    const commonExtensions = [
                        'zip', 'rar', '7z', 'tar', 'gz', 
                        'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma',
                        'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv',
                        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub',
                        'exe', 'msi', 'apk', 'dmg', 'bat',
                        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'
                    ];
                    
                    const cleanUrl = pathLower.split('?')[0].split('#')[0];
                    const ext = cleanUrl.substring(cleanUrl.lastIndexOf('.') + 1);
                    
                    if (commonExtensions.includes(ext)) {
                        console.log(`[Clipboard] Downloadable URL detected: ${currentText}`);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('clipboard-url-detected', currentText);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed reading clipboard:', e);
        }
    }, 1500);
}


// Native OS Notifications
function showNotification(title, body) {
    if (Notification.isSupported()) {
        try {
            new Notification({
                title,
                body,
                icon: path.join(__dirname, 'src', 'icon.png')
            }).show();
        } catch (e) {
            console.error('Failed to trigger OS notification:', e);
        }
    }
}

// Handle Auto-Actions when download completes (notify, sound chime, file auto-open)
function handleDownloadCompletion(download) {
    if (settings.postPlayCompleteSound !== false) {
        if (mainWindow) {
            mainWindow.webContents.send('play-completion-sound');
        }
    }
    
    if (settings.postShowNotification !== false) {
        showNotification('Download Completed', `Successfully downloaded ${download.filename}`);
    }
    
    if (settings.postOpenCompletedFile) {
        const targetPath = download.savePath;
        if (fs.existsSync(targetPath)) {
            shell.openPath(targetPath).catch(err => {
                console.error('[Auto Open] Failed to open completed file:', err);
            });
        }
    }
}

function detectCategory(filename) {
    if (!filename) return 'other';
    const ext = filename.split('.').pop().toLowerCase();
    
    // Check custom categories first
    if (settings && settings.customCategories) {
        for (const cat of settings.customCategories) {
            if (cat.extensions && cat.extensions.includes(ext)) {
                return cat.id;
            }
        }
    }
    
    if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts'].includes(ext)) {
        return 'videos';
    }
    if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma'].includes(ext)) {
        return 'music';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return 'compressed';
    }
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'epub'].includes(ext)) {
        return 'documents';
    }
    if (['exe', 'msi', 'apk', 'dmg', 'bat'].includes(ext)) {
        return 'programs';
    }
    if (['html', 'htm', 'shtml', 'php', 'asp', 'jsp'].includes(ext)) {
        return 'webpages';
    }
    return 'other';
}

function getExtensionFromMimeType(mime) {
    const map = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'text/html': 'html',
        'application/pdf': 'pdf',
        'application/zip': 'zip'
    };
    return map[mime.toLowerCase()] || '';
}

// Load download history from database
function loadDownloads() {
    if (fs.existsSync(dbPath)) {
        try {
            downloads = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            // Reset speed and connecting/downloading states on start
            downloads.forEach(d => {
                d.speed = 0;
                d.timeRemaining = -1;
                if (d.status === 'downloading' || d.status === 'connecting') {
                    d.status = settings.queueEnabled ? 'queued' : 'paused';
                }
                if (!d.category) {
                    d.category = detectCategory(d.filename);
                }
            });
        } catch (e) {
            console.error('Failed to parse database', e);
            downloads = [];
        }
    } else {
        downloads = [];
    }
}

// Forced Garbage Collection helper
function runGC() {
    if (global.gc) {
        try {
            global.gc();
            console.log('[GC] Forced garbage collection completed successfully.');
        } catch (e) {
            console.error('[GC] Failed to run garbage collection:', e);
        }
    }
}

// Save download history to database
function saveDownloads() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(downloads, null, 2));
        runGC();
    } catch (e) {
        console.error('Failed to save database', e);
    }
}

// Active download engines in-memory
const activeEngines = {};

function createMainWindow() {
    const startHidden = process.argv.includes('--hidden');
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 700,
        minWidth: 480,
        minHeight: 500,
        title: "Apna Downloader",
        icon: path.join(__dirname, 'src', 'icon.png'), // we will create a placeholder or generate one
        show: !startHidden,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            runGC();
        }
    });

    mainWindow.on('minimize', () => {
        runGC();
    });

    mainWindow.on('hide', () => {
        runGC();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        // Close all progress windows when main window is closed
        Object.values(progressWindows).forEach(win => {
            if (win && !win.isDestroyed()) win.close();
        });
        progressWindows = {};
    });
}

function createAuthWindow() {
    authWindow = new BrowserWindow({
        width: 420,
        height: 520,
        resizable: false,
        title: "Login - Apna Downloader",
        icon: path.join(__dirname, 'src', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    authWindow.loadFile(path.join(__dirname, 'src', 'auth.html'));

    authWindow.on('closed', () => {
        authWindow = null;
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'src', 'icon.png');
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Open Apna Dowanloader', 
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                } else if (authWindow) {
                    authWindow.show();
                    authWindow.focus();
                }
            } 
        },
        { type: 'separator' },
        { 
            label: 'Quit', 
            click: () => {
                isQuitting = true;
                app.quit();
            } 
        }
    ]);
    
    tray.setToolTip('Apna Dowanloader');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.focus();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        } else if (authWindow) {
            authWindow.show();
            authWindow.focus();
        }
    });
    
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        } else if (authWindow) {
            authWindow.show();
            authWindow.focus();
        }
    });
}

let infoWindow = null;

// Create standalone Download File Info popup window
function createInfoWindow(url = '', filename = '', quality = '', referer = '', userAgent = '', engine = '') {
    if (infoWindow) {
        infoWindow.focus();
        infoWindow.webContents.send('update-info', { url, filename, quality, referer, userAgent, engine });
        return;
    }

    infoWindow = new BrowserWindow({
        width: 620,
        height: 520,
        resizable: false,
        title: "Download File Info",
        icon: path.join(__dirname, 'src', 'icon.png'),
        parent: (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) ? mainWindow : undefined,
        modal: (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    const query = { url, filename, quality, referer, userAgent, engine };
    infoWindow.loadFile(path.join(__dirname, 'src', 'info.html'), { query });

    // Focus Bypass: briefly set always on top to force on screen foreground
    infoWindow.setAlwaysOnTop(true);
    infoWindow.show();
    infoWindow.focus();
    setTimeout(() => {
        if (infoWindow) infoWindow.setAlwaysOnTop(false);
    }, 300);

    infoWindow.on('closed', () => {
        infoWindow = null;
    });
}

// Create progress dialog window for a specific download
function createProgressWindow(downloadId) {
    if (progressWindows[downloadId]) {
        progressWindows[downloadId].focus();
        return;
    }

    const download = downloads.find(d => d.id === downloadId);
    if (!download) return;

    let win = new BrowserWindow({
        width: 600,
        height: 520,
        resizable: false,
        title: `Downloading: ${download.filename}`,
        parent: mainWindow || undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    win.loadFile(path.join(__dirname, 'src', 'progress.html'), { query: { id: downloadId } });

    // Focus Bypass: briefly set always on top to force on screen foreground
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    }, 300);

    win.on('closed', () => {
        delete progressWindows[downloadId];
    });

    progressWindows[downloadId] = win;
}



let ipcServer = null;
const PIPE_PATH = process.platform === 'win32'
    ? '\\\\.\\pipe\\apna-downloader-ipc'
    : path.join(app.getPath('temp'), 'apna-downloader-ipc.sock');

function startIpcServer() {
    if (process.platform !== 'win32') {
        try {
            if (fs.existsSync(PIPE_PATH)) {
                fs.unlinkSync(PIPE_PATH);
            }
        } catch (e) {
            console.error('Failed to unlink socket:', e);
        }
    }

    ipcServer = net.createServer((socket) => {
        socket.on('error', (err) => {
            console.log('[IPC Socket] Handled error:', err.message);
        });
        
        let requestData = '';
        socket.on('data', (data) => {
            requestData += data.toString('utf8');
            try {
                const request = JSON.parse(requestData);
                handleIpcRequest(request, socket);
            } catch (e) {
                // If it's a complete message but invalid JSON, return error
                const trimmed = requestData.trim();
                if (trimmed.endsWith('}') || trimmed.endsWith(']')) {
                    console.error('[IPC Server] Error parsing request:', e);
                    socket.write(JSON.stringify({ error: 'Invalid IPC request format' }));
                    socket.end();
                }
            }
        });
    });

    ipcServer.on('error', (err) => {
        console.error('[IPC Server] Error:', err);
    });

    ipcServer.listen(PIPE_PATH, () => {
        console.log('[IPC Server] Secure IPC listening on:', PIPE_PATH);
    });
}

function bringMainWindowToFront() {
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(true);
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
    }
}

function handleIpcRequest(request, socket) {
    if (request.action === 'get-settings') {
        socket.write(JSON.stringify(settings));
        socket.end();
    } else if (request.action === 'grab') {
        const payload = request.payload || request;
        const { url, filename, quality, referer, userAgent, engine } = payload;
        if (url) {
            createInfoWindow(url, filename, quality, referer, userAgent, engine);
            socket.write(JSON.stringify({ status: 'ok' }));
        } else {
            socket.write(JSON.stringify({ error: 'URL missing' }));
        }
        socket.end();
    } else if (request.action === 'get-video-info') {
        const payload = request.payload || request;
        const { url } = payload;
        if (url) {
            fetchVideoFormatsAndSizes(url)
                .then(result => {
                    socket.write(JSON.stringify(result));
                    socket.end();
                })
                .catch(err => {
                    socket.write(JSON.stringify({ success: false, error: err.message }));
                    socket.end();
                });
        } else {
            socket.write(JSON.stringify({ error: 'URL missing' }));
            socket.end();
        }
    } else {
        socket.write(JSON.stringify({ error: 'Unknown action' }));
        socket.end();
    }
}

async function fetchVideoFormatsAndSizes(url) {
    const dummy = new YtDlpDownloader(url, 'dummy-path');
    await dummy.ensureBinary();
    
    return new Promise((resolve) => {
        const binPath = dummy.binPath;
        const binDir = dummy.binDir;
        
        const args = [
            url,
            '--dump-single-json',
            '--no-warnings',
            '-J'
        ];
        
        const spawnEnv = { ...process.env };
        const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
        spawnEnv[pathKey] = `${binDir}${path.delimiter}${spawnEnv[pathKey] || ''}`;
        
        const child = spawn(binPath, args, { env: spawnEnv });
        let stdoutData = '';
        
        child.stdout.on('data', (chunk) => {
            stdoutData += chunk.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(stdoutData);
                    if (!parsed.formats) {
                        resolve({ success: false, error: 'No formats found' });
                        return;
                    }
                    
                    const videoFormats = parsed.formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none');
                    const audioFormats = parsed.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
                    const combinedFormats = parsed.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
                    
                    // Sort audio descending by abr
                    audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                    const bestAudio = audioFormats[0];
                    let aSize = 0;
                    if (bestAudio) {
                        aSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
                    }
                    
                    const resolutions = [
                        { height: 2160, quality: '2160p', label: 'MKV Video - 2160p 4K', icon: '💎' },
                        { height: 1440, quality: '1440p', label: 'MKV Video - 1440p 2K', icon: '🌟' },
                        { height: 1080, quality: '1080p', label: 'MP4 Video - 1080p HD', icon: '🎬' },
                        { height: 720, quality: '720p', label: 'MP4 Video - 720p HD', icon: '⚡' },
                        { height: 480, quality: '480p', label: 'MP4 Video - 480p', icon: '📀' },
                        { height: 360, quality: '360p', label: 'MP4 Video - 360p', icon: '📱' },
                        { height: 240, quality: '240p', label: 'MP4 Video - 240p', icon: '🎞️' },
                        { height: 144, quality: '144p', label: 'MP4 Video - 144p', icon: '🎦' }
                    ];
                    
                    const availableOptions = [];
                    
                    for (const res of resolutions) {
                        const matchingVideo = videoFormats.filter(f => f.height === res.height);
                        const matchingCombined = combinedFormats.filter(f => f.height === res.height);
                        
                        if (matchingVideo.length > 0) {
                            matchingVideo.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
                            const bestV = matchingVideo[0];
                            const vSize = bestV.filesize || bestV.filesize_approx || 0;
                            const totalSize = vSize + aSize;
                            availableOptions.push({
                                quality: res.quality,
                                label: res.label,
                                icon: res.icon,
                                size: totalSize
                            });
                        } else if (matchingCombined.length > 0) {
                            matchingCombined.sort((a, b) => (b.tbr || 0) - (a.tbr || 0));
                            const bestC = matchingCombined[0];
                            const totalSize = bestC.filesize || bestC.filesize_approx || 0;
                            availableOptions.push({
                                quality: res.quality,
                                label: res.label,
                                icon: res.icon,
                                size: totalSize
                            });
                        }
                    }
                    
                    if (audioFormats.length > 0) {
                        availableOptions.push({
                            quality: 'audio',
                            label: 'MP3 Audio - High Quality',
                            icon: '🎵',
                            size: aSize
                        });
                    }
                    
                    const hasSubtitles = (parsed.subtitles && Object.keys(parsed.subtitles).length > 0) ||
                                         (parsed.automatic_captions && Object.keys(parsed.automatic_captions).length > 0);
                    
                    if (hasSubtitles) {
                        availableOptions.push({
                            quality: 'subtitles',
                            label: 'SRT Subtitles Only (English/Urdu/Hindi)',
                            icon: '📝',
                            size: 100 * 1024
                        });
                    }
                    
                    resolve({ success: true, title: parsed.title, options: availableOptions });
                } catch (e) {
                    console.error('[Get Video Info] Error parsing JSON:', e);
                    resolve({ success: false, error: e.message });
                }
            } else {
                resolve({ success: false, error: `yt-dlp exited with code ${code}` });
            }
        });
        
        child.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

function setupNativeMessaging() {
    if (process.platform !== 'win32') return;

    try {
        const userDataPath = app.getPath('userData');
        const manifestPath = path.join(userDataPath, 'com.apnadownloader.app.json');
        const batPath = path.join(userDataPath, 'apna-downloader-native.bat');
        const hostJsPath = path.join(userDataPath, 'native-host.js');
        const exePath = app.getPath('exe');

        const escapedHostJsPath = hostJsPath.replace(/\\/g, '\\\\');

        // 1. Write native-host.js
        const hostJsContent = `
const net = require('net');
const PIPE_PATH = "\\\\\\\\.\\\\pipe\\\\apna-downloader-ipc";

let inputBuffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    while (inputBuffer.length >= 4) {
        const msgLen = inputBuffer.readUInt32LE(0);
        if (inputBuffer.length >= 4 + msgLen) {
            const msgBody = inputBuffer.slice(4, 4 + msgLen).toString('utf8');
            inputBuffer = inputBuffer.slice(4 + msgLen);
            try {
                const msg = JSON.parse(msgBody);
                handleMessage(msg);
            } catch (e) {
                sendResponse({ error: 'Invalid JSON message' });
            }
        } else {
            break;
        }
    }
});

function sendResponse(msg) {
    const msgBuf = Buffer.from(JSON.stringify(msg), 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(msgBuf.length, 0);
    process.stdout.write(lenBuf);
    process.stdout.write(msgBuf);
}

function handleMessage(msg) {
    const client = net.connect(PIPE_PATH, () => {
        client.end(JSON.stringify(msg));
    });
    
    let responseData = '';
    client.on('data', (data) => {
        responseData += data.toString('utf8');
    });
    
    client.on('end', () => {
        try {
            if (responseData) {
                sendResponse(JSON.parse(responseData));
            } else {
                sendResponse({ status: 'ok' });
            }
        } catch(e) {
            sendResponse({ status: 'ok', parseError: true });
        }
    });

    client.on('error', (err) => {
        sendResponse({ error: 'Desktop app is not running or socket connection failed', details: err.message });
    });
}
`;
        fs.writeFileSync(hostJsPath, hostJsContent.trim(), 'utf8');

        // 2. Write batch file
        const batContent = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exePath}" "${escapedHostJsPath}"`;
        fs.writeFileSync(batPath, batContent, 'utf8');

        // 3. Write manifest file
        const escapedBatPath = batPath.replace(/\\/g, '\\\\');
        const manifestContent = {
            name: "com.apnadownloader.app",
            description: "Apna Downloader Native Messaging Host",
            path: escapedBatPath,
            type: "stdio",
            allowed_origins: [
                "chrome-extension://aaechcbgjhghnncgdhkjlddpjglfihmp/"
            ]
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 4), 'utf8');

        // 4. Register in registry
        const registryKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.apnadownloader.app';
        const { exec } = require('child_process');
        exec(`reg add "${registryKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, (err) => {
            if (err) {
                console.error('[Native Messaging] Failed to register registry key:', err);
            } else {
                console.log('[Native Messaging] Successfully registered native messaging host in registry.');
            }
        });

    } catch (e) {
        console.error('[Native Messaging] Error setting up host:', e);
    }
}


const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        } else if (authWindow) {
            authWindow.show();
            authWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        loadDownloads();
        
        if (!settings.authToken) {
            createAuthWindow();
        } else {
            const license = await verifyLicenseStatus();
            if (license && license.status === 'unauthorized') {
                // Token is completely invalid/unauthorized -> clear and open login page
                settings.authToken = null;
                settings.authEmail = null;
                settingsManager.save(settings);
                createAuthWindow();
            } else {
                if (license) {
                    licenseStatus = {
                        status: license.status, // 'trial', 'active', 'expired'
                        limits: license.limits || { maxSegments: 16, maxSpeedBytes: 10485760 }
                    };
                }
                createMainWindow();
            }
        }
        
        startIpcServer();
        setupNativeMessaging();
        startSchedulerRoutine();
        startClipboardMonitor();
        createTray();

        // Enable auto-start on Windows/Mac boot (production only)
        if (app.isPackaged) {
            try {
                app.setLoginItemSettings({
                    openAtLogin: true,
                    path: app.getPath('exe'),
                    args: ['--hidden']
                });
            } catch (e) {
                console.error('Failed to set login item settings:', e);
            }
        } else {
            // Clean up dev-mode startup settings so they don't pop up on PC boot
            try {
                app.setLoginItemSettings({
                    openAtLogin: false,
                    path: app.getPath('exe')
                });
            } catch (e) {
                console.error('Failed to clear dev login item settings:', e);
            }

            // Deep clean dev-mode registry startup keys to prevent electron.exe showing on boot
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
                const valueNames = ['electron.app.Apna Dowanloader', 'electron.app.apna-downloader', 'Apna Dowanloader', 'apna-downloader'];
                
                valueNames.forEach(valName => {
                    exec(`reg query "${runKey}" /v "${valName}"`, (err, stdout, stderr) => {
                        if (!err && stdout) {
                            if (stdout.toLowerCase().includes('electron.exe') || stdout.toLowerCase().includes('node_modules')) {
                                console.log(`[Startup Cleanup] Deleting dev startup registry value: ${valName}`);
                                exec(`reg delete "${runKey}" /v "${valName}" /f`, (delErr) => {
                                    if (delErr) console.error(`Failed to delete registry value ${valName}:`, delErr);
                                });
                            }
                        }
                    });
                });
            }
        }


        if (settings.queueEnabled) {
            processQueue();
        }

        app.on('activate', () => {
            if (mainWindow) {
                mainWindow.show();
            } else if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Clean up all downloads and IPC server on quit
app.on('will-quit', () => {
    Object.values(activeEngines).forEach(engine => {
        engine.cleanup();
    });
    if (ipcServer) {
        ipcServer.close();
    }
    if (process.platform !== 'win32') {
        try {
            if (fs.existsSync(PIPE_PATH)) {
                fs.unlinkSync(PIPE_PATH);
            }
        } catch (e) {}
    }
});

ipcMain.handle('open-info-window', (event, data = {}) => {
    createInfoWindow(data.url, data.filename, data.quality, data.referer, data.userAgent, data.engine);
});

// 0a. Settings getters/setters
ipcMain.handle('get-settings', () => {
    return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
    const prevQueueEnabled = settings.queueEnabled;
    settings = settingsManager.save(newSettings);
    
    // Apply speed limits dynamically
    updateActiveDownloadLimits();
    
    // Apply scheduler changes
    startSchedulerRoutine();
    
    // Apply clipboard monitor changes
    startClipboardMonitor();
    
    // If queue was enabled, check if we should trigger downloads
    if (settings.queueEnabled && !prevQueueEnabled) {
        processQueue();
    }
    
    return settings;
});

ipcMain.handle('reset-settings', () => {
    settings = settingsManager.reset();
    updateActiveDownloadLimits();
    startSchedulerRoutine();
    startClipboardMonitor();
    if (mainWindow) {
        mainWindow.webContents.send('settings-updated', settings);
    }
    return settings;
});

ipcMain.handle('save-auth-token', (event, { token, email }) => {
    settings.authToken = token;
    settings.authEmail = email;
    settingsManager.save(settings);

    createMainWindow();

    if (authWindow) {
        authWindow.destroy();
        authWindow = null;
    }
    return { success: true };
});

ipcMain.handle('logout-user', () => {
    settings.authToken = null;
    settings.authEmail = null;
    settingsManager.save(settings);

    createAuthWindow();

    if (mainWindow) {
        mainWindow.destroy();
        mainWindow = null;
    }
    return { success: true };
});

ipcMain.handle('open-external', (event, url) => {
    require('electron').shell.openExternal(url);
    return { success: true };
});

ipcMain.handle('get-subscription-details', async () => {
    if (!settings.authToken) return { success: false, error: 'Not logged in' };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/portal/subscription`, {
            headers: {
                'Authorization': `Bearer ${settings.authToken}`
            }
        });
        if (!response.ok) {
            return { success: false, error: `Server error: ${response.status}` };
        }
        const data = await response.json();
        if (data.success) {
            data.currentDeviceId = settings.deviceId;
        }
        return data;
    } catch(e) {
        console.error('Failed to get subscription details:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('unbind-device-slot', async (event, deviceId) => {
    if (!settings.authToken) return { success: false, error: 'Not logged in' };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/portal/device/unbind`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.authToken}`
            },
            body: JSON.stringify({ deviceId })
        });
        if (!response.ok) {
            return { success: false, error: `Server error: ${response.status}` };
        }
        const data = await response.json();
        return data;
    } catch(e) {
        console.error('Failed to unbind device:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('activate-free-trial', async () => {
    if (!settings.authToken) return { success: false, error: 'Not logged in' };
    
    try {
        const response = await fetch(`${BACKEND_URL}/api/portal/start-trial`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.authToken}`
            }
        });
        if (!response.ok) {
            return { success: false, error: `Server error: ${response.status}` };
        }
        const data = await response.json();
        if (data.success) {
            const verify = await verifyLicenseStatus();
            if (verify) {
                licenseStatus = {
                    status: verify.status,
                    limits: verify.limits || { maxSegments: 16, maxSpeedBytes: 10485760 }
                };
            }
        }
        return data;
    } catch(e) {
        console.error('Failed to activate free trial:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('start-google-auth', async () => {
    const http = require('http');
    const url = require('url');
    const { shell } = require('electron');

    const PORT = 48329;
    const GOOGLE_CLIENT_ID = "732595466975-kvoo3oio590k54bse7jhhu5pmctp7u1g.apps.googleusercontent.com";
    const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;

    return new Promise((resolve) => {
        let server;
        
        server = http.createServer(async (req, res) => {
            const parsedUrl = url.parse(req.url, true);
            if (parsedUrl.pathname === '/oauth/callback') {
                const code = parsedUrl.query.code;
                
                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #0b0f19; color: #f3f4f6;">
                            <h2 style="color: #10b981;">Authentication Successful!</h2>
                            <p>You have signed in successfully. You can close this tab and return to Apna Downloader.</p>
                            <script>setTimeout(() => window.close(), 3000);</script>
                        </body>
                        </html>
                    `);
                    
                    server.close();

                    try {
                        const backendResponse = await fetch(`${BACKEND_URL}/api/auth/google`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code })
                        });
                        
                        const data = await backendResponse.json();
                        resolve(data);
                    } catch(err) {
                        resolve({ success: false, error: `Backend verification failed: ${err.message}` });
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end('<h2>Authentication Failed: Code missing</h2>');
                    server.close();
                    resolve({ success: false, error: 'Google OAuth code missing from callback' });
                }
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        server.listen(PORT, '127.0.0.1', () => {
            const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
                new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    redirect_uri: REDIRECT_URI,
                    response_type: 'code',
                    scope: 'email profile',
                    access_type: 'online',
                    prompt: 'select_account'
                }).toString();
                
            shell.openExternal(googleAuthUrl);
        });

        setTimeout(() => {
            try {
                server.close();
            } catch(e) {}
            resolve({ success: false, error: 'Authentication request timed out. Please try again.' });
        }, 120000);
    });
});

ipcMain.handle('start-queue', () => {
    console.log('[Queue] Manual Start Queue triggered');
    
    let updatedAny = false;
    downloads.forEach(d => {
        if (d.status === 'paused' || d.status === 'failed' || d.status === 'idle') {
            d.status = 'queued';
            updatedAny = true;
        }
    });
    
    if (updatedAny) {
        saveDownloads();
    }
    
    settings.queueEnabled = true;
    settingsManager.save(settings);
    
    processQueue();
    
    broadcast('download-list-updated', downloads);
    broadcast('settings-updated', settings);
    
    return { success: true };
});

ipcMain.handle('stop-queue', () => {
    console.log('[Queue] Manual Stop Queue triggered');
    
    downloads.forEach(d => {
        if (d.status === 'downloading' || d.status === 'connecting') {
            const engine = activeEngines[d.id];
            if (engine) {
                engine.pause();
            } else {
                d.status = 'paused';
            }
        } else if (d.status === 'queued') {
            d.status = 'paused';
        }
    });
    
    saveDownloads();
    
    broadcast('download-list-updated', downloads);
    return { success: true };
});


// 1. Select Folder dialog
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled) {
        return null;
    } else {
        return result.filePaths[0];
    }
});

// 1b. Get default download directories based on user home
ipcMain.handle('get-default-download-dirs', () => {
    const baseDownloads = app.getPath('downloads');
    return {
        videos: path.join(baseDownloads, 'Videos'),
        music: path.join(baseDownloads, 'Music'),
        compressed: path.join(baseDownloads, 'Compressed'),
        documents: path.join(baseDownloads, 'Documents'),
        programs: path.join(baseDownloads, 'Programs'),
        webpages: path.join(baseDownloads, 'Web Pages'),
        other: baseDownloads
    };
});

// 2. Get Downloads list
ipcMain.handle('get-downloads', () => {
    return downloads;
});

// 3. Add Download
ipcMain.handle('add-download', async (event, { url, savePath, numConnections, quality, downloadLater, referer, userAgent, engine, silent, downloadSubtitles }) => {
    let finalSavePath = savePath;
    if (url.startsWith('data:')) {
        const matches = url.match(/^data:([^;]+);/);
        if (matches) {
            const mimeType = matches[1];
            const currentExt = path.extname(finalSavePath);
            if (!currentExt) {
                const targetExt = getExtensionFromMimeType(mimeType);
                if (targetExt) {
                    finalSavePath = finalSavePath + '.' + targetExt;
                }
            }
        }
    }
    const filename = path.basename(finalSavePath);
    const dir = path.dirname(finalSavePath);
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {
        console.error('Failed to create directory', e);
    }
    const downloadId = Date.now().toString();

    const newDownload = {
        id: downloadId,
        url: url,
        savePath: finalSavePath,
        filename: filename,
        totalSize: 0,
        downloaded: 0,
        status: 'idle',
        speed: 0,
        timeRemaining: -1,
        numConnections: numConnections || 8,
        quality: quality || null,
        referer: referer || null,
        userAgent: userAgent || null,
        engine: engine || null,
        category: detectCategory(filename),
        dateAdded: new Date().toISOString(),
        downloadSubtitles: !!downloadSubtitles
    };

    downloads.unshift(newDownload); // Add to beginning
    saveDownloads();

    if (mainWindow) {
        mainWindow.webContents.send('download-list-updated', downloads);
    }

    // Fetch size asynchronously in the background
    if (!url.startsWith('data:')) {
        fetchMediaSizeHelper(url, quality).then(res => {
            if (res && res.success && res.size > 0) {
                const item = downloads.find(d => d.id === downloadId);
                if (item) {
                    item.totalSize = res.size;
                    saveDownloads();
                    if (mainWindow) {
                        mainWindow.webContents.send('download-list-updated', downloads);
                    }
                }
            }
        }).catch(err => {
            console.error('[Add Download] Background size pre-fetch failed:', err);
        });
    }

    if (!downloadLater) {
        if (settings.queueEnabled) {
            newDownload.status = 'queued';
            saveDownloads();
            if (mainWindow) {
                mainWindow.webContents.send('download-list-updated', downloads);
            }
            processQueue();
        } else {
            if (!silent) {
                // Open progress window automatically for this download
                createProgressWindow(downloadId);
            }

            // Auto-start download
            startDownload(newDownload);
        }
    }

    return newDownload;
});

// 4. Pause Download
ipcMain.handle('pause-download', (event, id) => {
    const engine = activeEngines[id];
    if (engine) {
        engine.pause();
    }
});

// 5. Resume Download
ipcMain.handle('resume-download', (event, id) => {
    const download = downloads.find(d => d.id === id);
    if (download) {
        createProgressWindow(id);
        if (download.status !== 'downloading') {
            startDownload(download, true);
        }
    }
});

// 6. Cancel / Delete Download
ipcMain.handle('cancel-download', (event, { id, deleteFile }) => {
    const engine = activeEngines[id];
    if (engine) {
        engine.cancel();
        delete activeEngines[id];
    }

    const download = downloads.find(d => d.id === id);
    if (download) {
        // Delete meta path
        const metaPath = download.savePath + '.meta';
        try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch(e) {}
        
        // Delete main file if explicitly requested OR if the download was incomplete
        if (deleteFile || download.status !== 'completed') {
            try {
                if (fs.existsSync(download.savePath)) {
                    fs.unlinkSync(download.savePath);
                }
            } catch(e) {
                console.error('[Cancel Download] Failed to delete file:', e);
            }
        }
    }

    // Remove from database
    downloads = downloads.filter(d => d.id !== id);
    saveDownloads();

    if (mainWindow) {
        mainWindow.webContents.send('download-list-updated', downloads);
    }

    // Close progress window if open
    const win = progressWindows[id];
    if (win && !win.isDestroyed()) {
        win.close();
    }
});

// 7. Open File
ipcMain.handle('open-file', async (event, filePath) => {
    let targetPath = filePath;
    if (!fs.existsSync(targetPath)) {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const baseName = path.basename(filePath, ext);
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const matchFile = files.find(f => {
                const fExt = path.extname(f).toLowerCase();
                const fBase = path.basename(f, fExt);
                
                if (fBase === baseName) return true;
                
                // Loose match for yt-dlp sanitized filenames (e.g. video_title [video_id])
                const sanitize = (s) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const cleanFBase = sanitize(fBase);
                const cleanBaseName = sanitize(baseName);
                
                return cleanFBase === cleanBaseName || cleanFBase.startsWith(cleanBaseName) || cleanBaseName.startsWith(cleanFBase);
            });
            if (matchFile) {
                targetPath = path.join(dir, matchFile);
                console.log(`[Open File] Resolved alternative path: ${targetPath}`);
            }
        }
    }

    if (!fs.existsSync(targetPath)) {
        return { success: false, error: 'FileNotFound', path: filePath };
    }

    try {
        const err = await shell.openPath(targetPath);
        if (!err) {
            return { success: true };
        }
        
        console.warn(`[Open File] shell.openPath failed with: "${err}". Trying fallback...`);
        
        // Fallback using native command spawn
        const escapedPath = targetPath.replace(/"/g, '\\"');
        let cmd = '';
        if (process.platform === 'win32') {
            cmd = `start "" "${escapedPath}"`;
        } else if (process.platform === 'darwin') {
            cmd = `open "${escapedPath}"`;
        } else {
            cmd = `xdg-open "${escapedPath}"`;
        }
        
        return new Promise((resolve) => {
            exec(cmd, (execErr) => {
                if (execErr) {
                    console.error('[Open File] Fallback execution failed:', execErr);
                    resolve({ success: false, error: 'LaunchFailed', details: err });
                } else {
                    console.log('[Open File] Fallback opened file successfully.');
                    resolve({ success: true });
                }
            });
        });
    } catch (e) {
        console.error('[Open File] Exception opening path:', e);
        return { success: false, error: 'Exception', details: e.message };
    }
});

// 8. Open Folder (Show in folder)
ipcMain.handle('open-folder', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return true;
    } else {
        const dir = path.dirname(filePath);
        if (fs.existsSync(dir)) {
            shell.openPath(dir);
            return true;
        }
    }
    return false;
});

// 9. Resize Progress Window
ipcMain.handle('resize-progress-window', (event, { id, width, height }) => {
    const win = progressWindows[id];
    if (win && !win.isDestroyed()) {
        win.setContentSize(width, height);
    }
});

// 10. Minimize Progress Window
ipcMain.handle('minimize-progress-window', (event, id) => {
    const win = progressWindows[id];
    if (win && !win.isDestroyed()) {
        win.minimize();
    }
});

// 11. Check Engines
ipcMain.handle('check-engines', async () => {
    return new Promise((resolve) => {
        const downloader = new YtDlpDownloader('dummy-url', 'dummy-path');
        
        // Forward progress events
        const onProgress = (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('engine-progress', data);
            }
        };
        downloader.on('progress', onProgress);

        (async () => {
            try {
                await downloader.ensureBinary();
                await downloader.ensureFfmpeg();
            } catch (err) {
                console.error('[Check Engines] Error:', err);
            } finally {
                downloader.removeListener('progress', onProgress);
                resolve();
            }
        })();
    });
});

// 12. Convert Media
ipcMain.handle('convert-media', async (event, { id, format }) => {
    const download = downloads.find(d => d.id === id);
    if (!download) {
        throw new Error('Download not found');
    }

    const inputPath = download.savePath;
    if (!fs.existsSync(inputPath)) {
        throw new Error('Source file does not exist');
    }

    const ext = path.extname(inputPath);
    const dir = path.dirname(inputPath);
    const baseName = path.basename(inputPath, ext);
    
    let targetExt = `.${format}`;
    let outputPath = path.join(dir, `${baseName}${targetExt}`);
    
    // If output path is same as input path, append _converted
    if (outputPath === inputPath) {
        outputPath = path.join(dir, `${baseName}_converted${targetExt}`);
    }

    const converter = new MediaConverter();
    activeConverters[id] = converter;

    // Run conversion asynchronously
    converter.on('progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('conversion-progress', { id, progress });
        }
    });

    converter.on('completed', () => {
        delete activeConverters[id];
        
        // Add converted file to downloads list as a completed file
        const newId = Date.now().toString();
        const newDownload = {
            id: newId,
            url: 'file://' + outputPath.replace(/\\/g, '/'),
            savePath: outputPath,
            filename: path.basename(outputPath),
            totalSize: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
            downloaded: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
            status: 'completed',
            speed: 0,
            timeRemaining: 0,
            numConnections: 1,
            quality: null,
            referer: null,
            userAgent: null,
            engine: 'direct',
            category: detectCategory(path.basename(outputPath)),
            dateAdded: new Date().toISOString()
        };
        downloads.unshift(newDownload);
        saveDownloads();
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-list-updated', downloads);
            mainWindow.webContents.send('conversion-completed', { id, newId });
        }
    });

    converter.on('error', (err) => {
        delete activeConverters[id];
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('conversion-error', { id, error: err.message });
        }
    });

    // Start conversion
    converter.convert(inputPath, outputPath, format);
    return { success: true };
});

// 13. Cancel Conversion
ipcMain.handle('cancel-conversion', (event, id) => {
    const converter = activeConverters[id];
    if (converter) {
        converter.cancel();
        delete activeConverters[id];
    }
    return { success: true };
});

// 14. Fetch Playlist Metadata
ipcMain.handle('fetch-playlist-metadata', async (event, url) => {
    const dummy = new YtDlpDownloader(url, 'dummy-path');
    await dummy.ensureBinary();
    
    return new Promise((resolve, reject) => {
        const binPath = dummy.binPath;
        const binDir = dummy.binDir;
        
        // Spawn arguments to dump flat playlist metadata
        const args = [
            url,
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings'
        ];
        
        const spawnEnv = { ...process.env };
        const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
        spawnEnv[pathKey] = `${binDir}${path.delimiter}${spawnEnv[pathKey] || ''}`;
        
        console.log('[Playlist Loader] Spawning:', binPath, args.join(' '));
        
        const child = spawn(binPath, args, { env: spawnEnv });
        let stdoutData = '';
        let stderrData = '';
        
        child.stdout.on('data', (chunk) => {
            stdoutData += chunk.toString();
        });
        
        child.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(stdoutData);
                    
                    if (parsed && parsed.entries) {
                        const items = parsed.entries.map(entry => {
                            let videoUrl = entry.url;
                            if (videoUrl && !videoUrl.startsWith('http')) {
                                videoUrl = `https://www.youtube.com/watch?v=${videoUrl}`;
                            }
                            return {
                                id: entry.id || Date.now().toString() + Math.random().toString(),
                                url: videoUrl || url,
                                title: entry.title || 'Untitled Video',
                                duration: entry.duration || 0
                            };
                        });
                        resolve({ isPlaylist: true, title: parsed.title || 'Playlist', items });
                    } else {
                        resolve({ isPlaylist: false });
                    }
                } catch (e) {
                    console.error('[Playlist Loader] JSON parse failed:', e);
                    reject(new Error('Failed to parse playlist details.'));
                }
            } else {
                console.error('[Playlist Loader] yt-dlp failed:', code, stderrData);
                reject(new Error(stderrData || `yt-dlp exited with code ${code}`));
            }
        });
        
        child.on('error', (err) => {
            reject(err);
        });
    });
});

// 15. Fetch Media Size
async function fetchMediaSizeHelper(url, quality, depth = 0) {
    if (depth > 5) return { success: false };
    
    if (!isStreamUrl(url)) {
        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(url);
                const isHttps = parsedUrl.protocol === 'https:';
                const httpLib = isHttps ? require('https') : require('http');
                
                const req = httpLib.request(url, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }, async (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        let redirectUrl = res.headers.location;
                        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                            redirectUrl = new URL(redirectUrl, url).href;
                        }
                        resolve(await fetchMediaSizeHelper(redirectUrl, quality, depth + 1));
                        return;
                    }
                    
                    const contentLength = res.headers['content-length'];
                    const size = contentLength ? parseInt(contentLength, 10) : 0;
                    
                    let filename = path.basename(parsedUrl.pathname);
                    const disposition = res.headers['content-disposition'];
                    if (disposition && disposition.includes('filename=')) {
                        const match = disposition.match(/filename=["']?([^"';]+)/);
                        if (match && match[1]) {
                            filename = match[1];
                        }
                    }
                    if (!filename || filename === '/' || filename === '.') {
                        filename = 'download';
                    }
                    
                    resolve({ success: true, size, title: filename });
                });
                
                req.on('error', () => {
                    resolve({ success: false });
                });
                
                req.setTimeout(5000, () => {
                    req.destroy();
                    resolve({ success: false });
                });
                
                req.end();
            } catch (e) {
                resolve({ success: false });
            }
        });
    }

    const dummy = new YtDlpDownloader(url, 'dummy-path');
    await dummy.ensureBinary();
    
    return new Promise((resolve) => {
        const binPath = dummy.binPath;
        const binDir = dummy.binDir;
        
        const args = [
            url,
            '--dump-single-json',
            '--no-warnings',
            '-J',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--extractor-args', 'youtube:player_client=android,web'
        ];
        
        const spawnEnv = { ...process.env };
        const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
        spawnEnv[pathKey] = `${binDir}${path.delimiter}${spawnEnv[pathKey] || ''}`;
        
        const child = spawn(binPath, args, { env: spawnEnv });
        let stdoutData = '';
        
        child.stdout.on('data', (chunk) => {
            stdoutData += chunk.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(stdoutData);
                    let totalSize = 0;
                    
                    if (quality === 'subtitles') {
                        resolve({ success: true, size: 100 * 1024, title: parsed.title + ' Subtitles' });
                        return;
                    }
                    
                    if (quality === 'audio') {
                        if (parsed.formats) {
                            const audioFormats = parsed.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
                            audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
                            if (audioFormats[0]) {
                                totalSize = audioFormats[0].filesize || audioFormats[0].filesize_approx || 0;
                            }
                        }
                    } else if (parsed.formats) {
                        const targetHeight = quality ? parseInt(quality.replace('p', ''), 10) : null;
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
                        
                        let vSize = 0;
                        let aSize = 0;
                        
                        if (bestVideo) {
                            vSize = bestVideo.filesize || bestVideo.filesize_approx || 0;
                        }
                        if (bestAudio) {
                            aSize = bestAudio.filesize || bestAudio.filesize_approx || 0;
                        }
                        
                        if (vSize === 0 && aSize === 0) {
                            const combinedFormats = parsed.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
                            combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
                            if (combinedFormats[0]) {
                                totalSize = combinedFormats[0].filesize || combinedFormats[0].filesize_approx || 0;
                            }
                        } else {
                            totalSize = vSize + aSize;
                        }
                    }
                    
                    resolve({ success: true, size: totalSize, title: parsed.title });
                } catch (e) {
                    console.error('[Media Size Loader] Error parsing JSON:', e);
                    resolve({ success: false });
                }
            } else {
                resolve({ success: false });
            }
        });
        
        child.on('error', () => {
            resolve({ success: false });
        });
    });
}

ipcMain.handle('fetch-media-size', async (event, { url, quality }) => {
    return await fetchMediaSizeHelper(url, quality);
});


function isStreamUrl(urlText) {
    try {
        const parsed = new URL(urlText);
        const hostname = parsed.hostname.toLowerCase();
        return (
            hostname.includes('youtube.com') ||
            hostname.includes('youtu.be') ||
            hostname.includes('vimeo.com') ||
            hostname.includes('facebook.com') ||
            hostname.includes('fb.watch') ||
            hostname.includes('twitter.com') ||
            hostname.includes('x.com') ||
            hostname.includes('instagram.com') ||
            hostname.includes('tiktok.com')
        );
    } catch (e) {
        return false;
    }
}

// Core logic to coordinate download starting and updating database
async function startDownload(download, isResume = false) {
    if (activeEngines[download.id]) return;

    // Verify license status live at start
    const license = await verifyLicenseStatus();
    if (license && !license.success) {
        // License/Trial expired -> fail download and lock client
        download.status = 'failed';
        download.statusDetail = license.message || 'Trial/License Expired';
        saveDownloads();
        
        broadcast('download-status', { id: download.id, status: 'failed', error: download.statusDetail });
        broadcast('download-list-updated', downloads);
        broadcast('license-status-locked', { message: license.message, status: license.status });
        return;
    }

    if (license) {
        licenseStatus = {
            status: license.status,
            limits: license.limits
        };
    }

    if (download.url.startsWith('data:')) {
        // Handle data URL immediately
        broadcast('download-status', { id: download.id, status: 'connecting' });
        
        try {
            let buffer;
            const base64Idx = download.url.indexOf(';base64,');
            if (base64Idx !== -1) {
                const base64Data = download.url.substring(base64Idx + 8);
                buffer = Buffer.from(base64Data, 'base64');
            } else {
                const commaIdx = download.url.indexOf(',');
                if (commaIdx !== -1) {
                    buffer = Buffer.from(decodeURIComponent(download.url.substring(commaIdx + 1)), 'utf8');
                } else {
                    throw new Error('Invalid data URL');
                }
            }

            fs.writeFileSync(download.savePath, buffer);
            
            // Mark completed immediately
            download.status = 'completed';
            download.totalSize = buffer.length;
            download.downloaded = buffer.length;
            download.speed = 0;
            download.timeRemaining = 0;
            saveDownloads();

            broadcast('download-progress', {
                id: download.id,
                downloaded: buffer.length,
                total: buffer.length,
                percentage: 100,
                speed: 0,
                timeRemaining: 0
            });
            broadcast('download-status', { id: download.id, status: 'completed' });
            broadcast('download-list-updated', downloads);
            handleDownloadCompletion(download);
        } catch (e) {
            console.error('Data URL download failed:', e);
            download.status = 'failed';
            saveDownloads();
            broadcast('download-status', { id: download.id, status: 'failed', error: e.message });
            broadcast('download-list-updated', downloads);
        }
        return;
    }

    // Apply connections limit checks based on trial status
    let connections = download.numConnections || 8;
    if (licenseStatus && licenseStatus.status === 'trial') {
        connections = Math.min(connections, licenseStatus.limits.maxSegments);
    }

    let engine;
    if (download.engine === 'ytdlp' || isStreamUrl(download.url)) {
        let rateLimit = null;
        if (settings.speedLimitEnabled && settings.maxSpeedLimit > 0) {
            const activeCount = Object.keys(activeEngines).length + 1;
            rateLimit = Math.max(1, Math.floor(settings.maxSpeedLimit / activeCount));
        }
        engine = new YtDlpDownloader(download.url, download.savePath, {
            numConnections: connections,
            quality: download.quality,
            referer: download.referer,
            rateLimit: rateLimit,
            totalSize: download.totalSize,
            downloaded: download.downloaded,
            downloadSubtitles: download.downloadSubtitles
        });
    } else {
        engine = new DownloadEngine(download.url, download.savePath, {
            numConnections: connections,
            referer: download.referer,
            userAgent: download.userAgent
        });
    }

    activeEngines[download.id] = engine;
    updateActiveDownloadLimits();

    engine.on('status', (status) => {
        download.status = status;
        saveDownloads();
        
        // Notify windows
        broadcast('download-status', { id: download.id, status });
        broadcast('download-list-updated', downloads);

        if (status === 'paused' || status === 'failed') {
            if (activeEngines[download.id]) {
                delete activeEngines[download.id];
                updateActiveDownloadLimits();
                processQueue();
            }
        }
    });

    engine.on('filePathChanged', (newPath) => {
        download.savePath = newPath;
        download.filename = path.basename(newPath);
        download.category = detectCategory(download.filename);
        saveDownloads();
        
        broadcast('download-file-path-changed', {
            id: download.id,
            savePath: download.savePath,
            filename: download.filename,
            category: download.category
        });
        broadcast('download-list-updated', downloads);
    });

    engine.on('progress', (data) => {
        download.totalSize = data.total;
        download.downloaded = data.downloaded;
        download.speed = data.speed;
        download.timeRemaining = data.timeRemaining;
        download.statusDetail = data.statusDetail || '';
        
        saveDownloads();

        // Notify windows
        broadcast('download-progress', {
            id: download.id,
            downloaded: data.downloaded,
            total: data.total,
            percentage: data.percentage,
            speed: data.speed,
            timeRemaining: data.timeRemaining,
            statusDetail: download.statusDetail
        });
        
        if (mainWindow) {
            mainWindow.webContents.send('download-list-updated', downloads);
        }
    });

    engine.on('segmentProgress', (data) => {
        broadcast('segment-progress', {
            downloadId: download.id,
            segmentId: data.id,
            downloaded: data.downloaded,
            total: data.total,
            percentage: data.percentage
        });
    });

    engine.on('completed', () => {
        download.status = 'completed';
        download.speed = 0;
        download.timeRemaining = 0;
        saveDownloads();
        
        broadcast('download-status', { id: download.id, status: 'completed' });
        broadcast('download-list-updated', downloads);
        
        delete activeEngines[download.id];
        updateActiveDownloadLimits();
        processQueue();
        handleDownloadCompletion(download);
    });

    engine.on('error', (err) => {
        console.error(`Download error on ${download.id}:`, err);
        download.status = 'failed';
        download.speed = 0;
        download.timeRemaining = -1;
        saveDownloads();

        broadcast('download-status', { id: download.id, status: 'failed', error: err.message });
        broadcast('download-list-updated', downloads);
        
        delete activeEngines[download.id];
        updateActiveDownloadLimits();
        processQueue();
        showNotification('Download Failed', `Failed to download ${download.filename}: ${err.message}`);
    });

    engine.start(isResume);
}

// Send event to all open renderer windows
function broadcast(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
    Object.values(progressWindows).forEach(win => {
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, data);
        }
    });
}

// Demo simulation removed.
