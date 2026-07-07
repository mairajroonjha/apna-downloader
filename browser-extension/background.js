// Create right-click context menu item on installation
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "download-with-apna",
        title: "Download with Apna Downloader",
        contexts: ["link", "video", "audio", "image"]
    });
    chrome.contextMenus.create({
        id: "download-all-with-apna",
        title: "Download all links with Apna Downloader",
        contexts: ["page", "link"]
    });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "download-with-apna") {
        const url = shouldPreferSrcUrl(info) ? info.srcUrl : info.linkUrl;
        if (url) {
            // Check domain exclusion list before initiating download
            getSettingsFromNative((settings) => {
                const excluded = settings.excludedDomains || [];
                let downloadHost = '';
                try { downloadHost = new URL(url).hostname; } catch(e) {}
                let tabHost = '';
                try { tabHost = new URL(tab ? tab.url : '').hostname; } catch(e) {}
                
                if (isDomainExcluded(downloadHost, excluded) || isDomainExcluded(tabHost, excluded)) {
                    console.log('[Apna Helper] Context menu download skipped: domain is excluded.');
                    return;
                }
                
                if (url.startsWith('blob:') && tab && tab.id) {
                    // Send message to content script to resolve the blob URL
                    chrome.tabs.sendMessage(tab.id, { action: "resolveBlob", url: url }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('Error messaging tab to resolve blob:', chrome.runtime.lastError.message);
                        }
                        if (response && response.dataUrl) {
                            const filename = getFilenameFromUrl(response.dataUrl) || 'download';
                            sendToApna(response.dataUrl, filename, tab ? tab.url : null);
                        } else {
                            const filename = getFilenameFromUrl(url);
                            sendToApna(url, filename, tab ? tab.url : null);
                        }
                    });
                } else {
                    const filename = getFilenameFromUrl(url);
                    sendToApna(url, filename, tab ? tab.url : null);
                }
            });
        }
    } else if (info.menuItemId === "download-all-with-apna") {
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "downloadAllLinks" });
        }
    }
});

function shouldPreferSrcUrl(info) {
    if (!info.srcUrl) return false;
    if (!info.linkUrl) return true;

    const linkExt = getFileExtension(info.linkUrl);
    const nonWebpageExtensions = [
        'zip', 'rar', '7z', 'tar', 'gz', 
        'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma',
        'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub',
        'exe', 'msi', 'apk', 'dmg', 'bat',
        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'
    ];
    if (nonWebpageExtensions.includes(linkExt)) {
        return false; // Prefer linkUrl (points to a downloadable archive/media/document file)
    }
    return true; // Prefer srcUrl (webpage link, so we want the image itself)
}

// Intercept browser downloads automatically
chrome.downloads.onDeterminingFilename.addListener((item) => {
    const filename = item.filename || '';
    const url = item.url || '';
    
    // Check file extension
    const ext = getFileExtension(filename || url);
    const interceptableExtensions = [
        'zip', 'rar', '7z', 'tar', 'gz', 
        'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma',
        'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv',
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub',
        'exe', 'msi', 'apk', 'dmg', 'bat',
        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',
        'html', 'htm'
    ];

    if (interceptableExtensions.includes(ext)) {
        // Fetch exclude settings and check if domain should be ignored
        getSettingsFromNative((settings) => {
            const excluded = settings.excludedDomains || [];
            let downloadHost = '';
            try { downloadHost = new URL(url).hostname; } catch(e) {}
            let referrerHost = '';
            try { referrerHost = new URL(item.referrer || '').hostname; } catch(e) {}
            
            if (isDomainExcluded(downloadHost, excluded) || isDomainExcluded(referrerHost, excluded)) {
                console.log('[Apna Helper] Interception skipped: domain is excluded.');
                return;
            }
            
            // Cancel the browser download immediately
            chrome.downloads.cancel(item.id, () => {
                if (chrome.runtime.lastError) {
                    console.log('Download cancel status:', chrome.runtime.lastError.message);
                }
                
                chrome.downloads.erase({ id: item.id }, () => {
                    if (chrome.runtime.lastError) {
                        console.log('Download erase status:', chrome.runtime.lastError.message);
                    }
                });
            });

            // Send to Apna Downloader
            sendToApna(url, filename, item.referrer);
        });
    }
});

function sendToApna(url, filename, referer) {
    sendNativeMessage({
        action: 'grab',
        payload: {
            url: url,
            filename: filename,
            referer: referer || null,
            userAgent: navigator.userAgent,
            engine: 'basic'
        }
    }, (response) => {
        if (response && response.status === 'ok') {
            console.log('[Apna Helper] Link successfully grabbed via Native Messaging:', response);
        } else {
            console.error('[Apna Helper] Native Messaging grab failed:', response ? response.error : 'unknown error');
        }
    });
}

function getFileExtension(str) {
    if (!str) return '';
    let pathStr = str;
    if (str.startsWith('http://') || str.startsWith('https://')) {
        try {
            const url = new URL(str);
            pathStr = url.pathname;
        } catch (e) {}
    }
    const lastSegment = pathStr.substring(pathStr.lastIndexOf('/') + 1);
    const cleanSegment = lastSegment.split('?')[0].split('#')[0];
    const parts = cleanSegment.split('.');
    if (parts.length > 1) {
        return parts.pop().toLowerCase();
    }
    return '';
}

function getFilenameFromUrl(urlText) {
    if (!urlText) return null;
    if (urlText.startsWith('data:')) {
        return 'download';
    }
    try {
        const url = new URL(urlText);
        let pathname = url.pathname;
        let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (filename.indexOf('?') > -1) {
            filename = filename.substring(0, filename.indexOf('?'));
        }
        filename = decodeURIComponent(filename);
        return filename || null;
    } catch (e) {
        return null;
    }
}

function isDomainExcluded(hostname, excludedDomains) {
    if (!excludedDomains || !Array.isArray(excludedDomains)) return false;
    const hostLower = hostname.toLowerCase();
    return excludedDomains.some(domain => {
        const domainLower = domain.trim().toLowerCase();
        if (!domainLower) return false;
        return hostLower === domainLower || hostLower.endsWith('.' + domainLower);
    });
}

function sendNativeMessage(message, callback) {
    chrome.runtime.sendNativeMessage(
        'com.apnadownloader.app',
        message,
        (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Apna Helper] Native Messaging error:', chrome.runtime.lastError.message);
                callback({ error: chrome.runtime.lastError.message });
            } else {
                callback(response);
            }
        }
    );
}

function getSettingsFromNative(callback) {
    sendNativeMessage({ action: 'get-settings' }, (response) => {
        if (response && !response.error) {
            callback(response);
        } else {
            // Fallback default settings if app is not running
            callback({
                excludedDomains: [],
                queueEnabled: false,
                maxConcurrentDownloads: 3,
                speedLimitEnabled: false,
                maxSpeedLimit: 0,
                schedulerEnabled: false,
                clipboardMonitorEnabled: false
            });
        }
    });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'get-settings') {
        getSettingsFromNative((settings) => {
            sendResponse(settings);
        });
        return true; // Keep channel open for async response
    }
    if (message && message.action === 'grab') {
        sendNativeMessage({
            action: 'grab',
            payload: message.payload
        }, (response) => {
            sendResponse(response);
        });
        return true;
    }
    if (message && message.action === 'get-video-info') {
        sendNativeMessage({
            action: 'get-video-info',
            payload: { url: message.url }
        }, (response) => {
            sendResponse(response);
        });
        return true;
    }
});
