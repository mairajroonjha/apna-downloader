const urlParams = new URLSearchParams(window.location.search);
const isGrabMode = urlParams.get('mode') === 'grab';

let downloads = [];
let selectedDownloadId = null;
let currentFilter = 'all';
let currentCategoryFilter = null;
let isManualFolder = false;
let grabbedQuality = null;
let grabbedReferer = null;
let grabbedUserAgent = null;
let grabbedEngine = null;
let appSettings = null;

const defaultCategories = [
    { id: 'compressed', name: 'Compressed', icon: 'fa-file-zipper' },
    { id: 'documents', name: 'Documents', icon: 'fa-file-lines' },
    { id: 'music', name: 'Music', icon: 'fa-file-audio' },
    { id: 'programs', name: 'Programs', icon: 'fa-file-code' },
    { id: 'videos', name: 'Videos', icon: 'fa-file-video' },
    { id: 'webpages', name: 'Web Pages', icon: 'fa-globe' }
];

const checkedDownloadIds = new Set();

// DOM elements
const downloadListBody = document.getElementById('download-list-body');
const btnAddUrl = document.getElementById('btn-add-url');
const btnResume = document.getElementById('btn-resume');
const btnPause = document.getElementById('btn-pause');
const btnDelete = document.getElementById('btn-delete');
const btnOpenFile = document.getElementById('btn-open-file');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnStartQueue = document.getElementById('btn-start-queue');
const btnStopQueue = document.getElementById('btn-stop-queue');
const btnConvertFile = document.getElementById('btn-convert-file');

const mediaConverterModal = document.getElementById('media-converter-modal');
const btnCloseConverterBtn = document.getElementById('modal-close-converter-btn');
const btnConverterStart = document.getElementById('btn-converter-start');
const btnConverterCancel = document.getElementById('btn-converter-cancel');
const converterSourceName = document.getElementById('converter-source-name');
const converterSourceSize = document.getElementById('converter-source-size');
const converterFormGroup = document.getElementById('converter-form-group');
const converterProgressContainer = document.getElementById('converter-progress-container');
const converterStatusText = document.getElementById('converter-status-text');
const converterPercentText = document.getElementById('converter-percent-text');
const converterProgressBarFill = document.getElementById('converter-progress-bar-fill');

let isConverting = false;
let convertingDownloadId = null;

const playlistLoader = document.getElementById('playlist-loader');
const playlistContainer = document.getElementById('playlist-container');
const playlistTitle = document.getElementById('playlist-title');
const playlistSelectAll = document.getElementById('playlist-select-all');
const playlistItemsList = document.getElementById('playlist-items-list');

let isPlaylistActive = false;
let playlistItems = [];
let currentSizeText = "Unknown";

const activeJobsCount = document.getElementById('active-jobs-count');
const totalSpeed = document.getElementById('total-speed');

// Modal Elements
const addUrlModal = document.getElementById('add-url-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const inputUrl = document.getElementById('input-url');
const inputSavePath = document.getElementById('input-save-path');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const btnAddCancel = document.getElementById('btn-add-cancel');
const btnAddStart = document.getElementById('btn-add-start');
const selectThreads = document.getElementById('connections-count');

// New Modal Elements
const btnAddLater = document.getElementById('btn-add-later');
const selectCategory = document.getElementById('select-category');
const lblCategoryName = document.getElementById('lbl-category-name');
const inputCategoryPath = document.getElementById('input-category-path');
const inputDescription = document.getElementById('input-description');
const chkRememberPath = document.getElementById('chk-remember-path');
const chkDownloadSubtitles = document.getElementById('chk-download-subtitles');
const sideFileIcon = document.getElementById('side-file-icon');
const sideIconContainer = document.getElementById('side-icon-container');
const sideFileSize = document.getElementById('side-file-size');
const btnAddCategory = document.getElementById('btn-add-category');

// Helper to format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper to format speed
function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '0 KB/s';
    return formatBytes(bytesPerSecond, 1) + '/s';
}

// Helper to format remaining time
function formatTimeRemaining(seconds) {
    if (seconds === -1 || seconds === undefined) return 'Unknown';
    if (seconds === 0) return '0s';
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let ret = '';
    if (hrs > 0) ret += `${hrs}h `;
    if (mins > 0 || hrs > 0) ret += `${mins}m `;
    ret += `${secs}s`;
    return ret;
}

// Helper to format date
function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initialize Application
async function init() {
    if (isGrabMode) {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';
        
        const appContainer = document.querySelector('.app-container');
        if (appContainer) appContainer.style.display = 'none';
        
        document.body.classList.add('grab-mode');
        
        try {
            const currentSettings = await window.api.getSettings();
            if (currentSettings) {
                appSettings = currentSettings;
                applyThemeAndAccent(currentSettings.theme, currentSettings.accentColor);
                if (currentSettings.customCategories) {
                    currentSettings.customCategories.forEach(c => {
                        defaultCategoryPaths[c.id] = c.savePath;
                    });
                }
            }
        } catch (e) {}
        
        try {
            const paths = await window.api.getDefaultDownloadDirs();
            if (paths) {
                Object.assign(defaultCategoryPaths, paths);
            }
        } catch (e) {}
        
        const url = urlParams.get('url') || '';
        const filename = urlParams.get('filename') || '';
        const quality = urlParams.get('quality') || '';
        const referer = urlParams.get('referer') || '';
        const userAgent = urlParams.get('userAgent') || '';
        const engine = urlParams.get('engine') || '';
        
        addUrlModal.classList.add('active');
        handleGrabbedUrl({ url, filename, quality, referer, userAgent, engine });
        return;
    }

    // Hide splash screen after delay
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('fade-out');
        }
    }, 2800);

    // Fetch and apply settings
    try {
        const currentSettings = await window.api.getSettings();
        if (currentSettings) {
            appSettings = currentSettings;
            applyThemeAndAccent(currentSettings.theme, currentSettings.accentColor);
            populateSettingsUI(currentSettings);
            
            // Register custom category default save paths
            if (currentSettings.customCategories) {
                currentSettings.customCategories.forEach(c => {
                    defaultCategoryPaths[c.id] = c.savePath;
                });
            }
            
            // Render dynamic categories
            renderCategoriesList();
            
            // Auto-trigger tour guide for first-use
            setTimeout(() => {
                if (appSettings && appSettings.hasSeenTour === false) {
                    startOnboardingTour();
                }
            }, 3200);
        }
    } catch (e) {
        console.error('Failed to load settings on startup:', e);
    }

    // Initialize sidebar speed chart and full analytics dashboard
    initSpeedChart();
    initAnalyticsChart();

    // Fetch default download directories
    try {
        const paths = await window.api.getDefaultDownloadDirs();
        if (paths) {
            Object.assign(defaultCategoryPaths, paths);
        }
    } catch (e) {
        console.error('Failed to load default download dirs:', e);
    }

    // Fetch initial download list
    downloads = await window.api.getDownloads();
    renderDownloads();

    // Listen to updates
    window.api.onDownloadListUpdated((newList) => {
        downloads = newList;
        renderDownloads();
    });

    window.api.onDownloadProgress((data) => {
        const item = downloads.find(d => d.id === data.id);
        if (item) {
            item.downloaded = data.downloaded;
            item.totalSize = data.total;
            item.speed = data.speed;
            item.timeRemaining = data.timeRemaining;
            item.statusDetail = data.statusDetail || '';
        }

        const row = document.querySelector(`tr[data-id="${data.id}"]`);
        if (row) {
            // Update progress bar
            const bar = row.querySelector('.progress-bar-fill');
            if (bar) bar.style.width = `${data.percentage.toFixed(1)}%`;
            
            const percentText = row.querySelector('.percent-text');
            if (percentText) percentText.innerText = `${data.percentage.toFixed(1)}%`;
            
            const downloadedText = row.querySelector('.downloaded-text');
            if (downloadedText) downloadedText.innerText = `${formatBytes(data.downloaded)} / ${data.total ? formatBytes(data.total) : 'Unknown'}`;

            const statusBadge = row.querySelector('.status-badge');
            if (statusBadge) statusBadge.innerText = data.statusDetail || data.status || 'downloading';

            // Update speed and time left
            const speedCol = row.querySelector('.col-speed');
            if (speedCol) speedCol.innerText = formatSpeed(data.speed);

            const timeCol = row.querySelector('.col-time');
            if (timeCol) timeCol.innerText = formatTimeRemaining(data.timeRemaining);
            
            // If the row was selected, we might want to refresh the actions state
            if (selectedDownloadId === data.id) {
                updateToolbarState();
            }
        }
        updateGlobalStats();
    });

    window.api.onDownloadStatus((data) => {
        const item = downloads.find(d => d.id === data.id);
        if (item) {
            item.status = data.status;
        }

        const row = document.querySelector(`tr[data-id="${data.id}"]`);
        if (row) {
            const statusCol = row.querySelector('.col-status');
            if (statusCol) {
                statusCol.innerHTML = `<span class="status-badge ${data.status}">${data.status}</span>`;
            }
            if (selectedDownloadId === data.id) {
                updateToolbarState();
            }
        }
        updateGlobalStats();
    });

    window.api.onGrabbedUrl((data) => {
        handleGrabbedUrl(data);
    });

    window.api.onClipboardUrlDetected((url) => {
        const toast = document.getElementById('clipboard-toast');
        const toastUrl = document.getElementById('clipboard-toast-url');
        if (toast && toastUrl) {
            toastUrl.innerText = url;
            toastUrl.title = url;
            toast.classList.add('active');
            
            if (window.clipboardToastTimeout) clearTimeout(window.clipboardToastTimeout);
            window.clipboardToastTimeout = setTimeout(() => {
                toast.classList.remove('active');
            }, 8000);
        }
    });
    window.api.onSettingsUpdated((updatedSettings) => {
        appSettings = updatedSettings;
        populateSettingsUI(updatedSettings);
    });

    window.api.onConversionProgress(({ id, progress }) => {
        if (id === convertingDownloadId) {
            converterPercentText.innerText = progress.toFixed(1) + '%';
            converterProgressBarFill.style.width = progress.toFixed(1) + '%';
        }
    });

    window.api.onConversionCompleted(({ id, newId }) => {
        if (id === convertingDownloadId) {
            isConverting = false;
            convertingDownloadId = null;
            mediaConverterModal.classList.remove('active');
            alert('Media conversion completed successfully!');
            selectedDownloadId = newId; // Select the new item
            renderDownloads();
        }
    });

    window.api.onConversionError(({ id, error }) => {
        if (id === convertingDownloadId) {
            isConverting = false;
            convertingDownloadId = null;
            mediaConverterModal.classList.remove('active');
            alert('Media conversion failed: ' + error);
        }
    });

    // License paywall locks trigger listener
    const paywallLockOverlay = document.getElementById('paywall-lock-overlay');
    const paywallLockMessage = document.getElementById('paywall-lock-message');
    const btnPaywallBuy = document.getElementById('btn-paywall-buy');
    const btnPaywallLogout = document.getElementById('btn-paywall-logout');

    if (window.api && window.api.onLicenseStatusLocked) {
        window.api.onLicenseStatusLocked((data) => {
            if (paywallLockOverlay) {
                const headerTitle = paywallLockOverlay.querySelector("h3");
                const lockIcon = paywallLockOverlay.querySelector("i.fa-solid");
                
                if (data.status === 'trial_not_started') {
                    if (headerTitle) headerTitle.innerText = "Free Trial Available";
                    if (lockIcon) {
                        lockIcon.className = "fa-solid fa-circle-play";
                        lockIcon.style.color = "var(--accent-color)";
                        lockIcon.style.filter = "drop-shadow(0 0 10px rgba(59, 130, 246, 0.3))";
                    }
                    if (paywallLockMessage) {
                        paywallLockMessage.innerText = "Welcome! Activate your 15-day free trial now to unlock unlimited downloading capabilities.";
                    }
                    if (btnPaywallBuy) {
                        btnPaywallBuy.innerHTML = `<i class="fa-solid fa-circle-play"></i> Activate Free Trial`;
                        btnPaywallBuy.dataset.action = "activate";
                    }
                } else {
                    if (headerTitle) headerTitle.innerText = "License Required";
                    if (lockIcon) {
                        lockIcon.className = "fa-solid fa-lock";
                        lockIcon.style.color = "var(--danger-color)";
                        lockIcon.style.filter = "drop-shadow(0 0 10px rgba(239, 68, 68, 0.3))";
                    }
                    if (paywallLockMessage) {
                        paywallLockMessage.innerText = data.message || "Your trial period or subscription has expired. Please buy a license key to unlock Apna Downloader.";
                    }
                    if (btnPaywallBuy) {
                        btnPaywallBuy.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Purchase License`;
                        btnPaywallBuy.dataset.action = "buy";
                    }
                }
                paywallLockOverlay.style.display = 'flex';
            }
        });
    }

    if (btnPaywallBuy) {
        btnPaywallBuy.addEventListener('click', async () => {
            if (btnPaywallBuy.dataset.action === "activate") {
                btnPaywallBuy.disabled = true;
                const res = await window.api.activateFreeTrial();
                btnPaywallBuy.disabled = false;
                if (res && res.success) {
                    if (paywallLockOverlay) paywallLockOverlay.style.display = 'none';
                    alert("Your 15-day free trial has been activated successfully!");
                    // Trigger dynamic profile updates
                    if (typeof loadProfilePortal === 'function') {
                        loadProfilePortal();
                    }
                } else {
                    alert(res.error || "Failed to activate free trial.");
                }
            } else {
                window.api.openExternal('https://apna-downloader.pages.dev/');
            }
        });
    }

    if (btnPaywallLogout) {
        btnPaywallLogout.addEventListener('click', async () => {
            await window.api.logoutUser();
        });
    }

    const paywallCloseBtn = document.getElementById('paywall-close-btn');
    if (paywallCloseBtn) {
        paywallCloseBtn.addEventListener('click', () => {
            if (paywallLockOverlay) paywallLockOverlay.style.display = 'none';
        });
    }

    setupEventListeners();
}

function handleGrabbedUrl(data) {
    inputUrl.value = data.url;
    isManualFolder = false;
    grabbedQuality = data.quality || null;
    grabbedReferer = data.referer || null;
    grabbedUserAgent = data.userAgent || null;
    grabbedEngine = data.engine || null;
    inputDescription.value = ''; // Reset description
    
    let filename = data.filename || 'download';
    let ext = getFileExtension(filename);
    if (data.url.startsWith('data:')) {
        const matches = data.url.match(/^data:([^;]+);/);
        if (matches && !ext) {
            ext = getExtensionFromMimeType(matches[1]);
        }
        if (filename === 'download' && ext) {
            filename = 'download.' + ext;
        }
    } else {
        if (!ext) ext = getFileExtension(data.url);
    }
    
    if (isStreamUrl(data.url) && !ext) {
        if (grabbedQuality === 'audio') {
            ext = 'mp3';
        } else if (grabbedQuality === 'subtitles') {
            ext = 'srt';
        } else {
            ext = 'mp4';
        }
    }
    
    let cleanName = sanitizeFilename(filename);
    if (grabbedQuality === 'audio') {
        ext = 'mp3';
        const dotIdx = cleanName.lastIndexOf('.');
        if (dotIdx !== -1) {
            const currentExt = cleanName.substring(dotIdx + 1).toLowerCase();
            if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(currentExt)) {
                cleanName = cleanName.substring(0, dotIdx);
            }
        }
    } else if (grabbedQuality === 'subtitles') {
        ext = 'srt';
        const dotIdx = cleanName.lastIndexOf('.');
        if (dotIdx !== -1) {
            const currentExt = cleanName.substring(dotIdx + 1).toLowerCase();
            if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'mp3', 'wav'].includes(currentExt)) {
                cleanName = cleanName.substring(0, dotIdx);
            }
        }
        chkDownloadSubtitles.checked = false;
    }
    
    if (ext && !cleanName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
        cleanName += `.${ext}`;
    }
    
    const category = detectCategory(cleanName);
    selectCategory.value = category;
    
    // Trigger UI category update
    updateCategoryUI(category);
    
    // Ensure the filename in path matches cleanName exactly
    const parts = inputSavePath.value.split('\\');
    parts[parts.length - 1] = cleanName;
    inputSavePath.value = parts.join('\\');
    
    // Duplicate check
    const duplicateByUrl = downloads.find(d => d.url === data.url);
    if (duplicateByUrl) {
        const proceed = confirm(`Duplicate Download Warning:\n\n"${duplicateByUrl.filename}" is already in your download list (Status: ${duplicateByUrl.status}).\n\nDo you want to download it again?`);
        if (!proceed) return;
    } else {
        const duplicateByName = downloads.find(d => d.filename === cleanName && d.category === category);
        if (duplicateByName) {
            const proceed = confirm(`File Name Conflict:\n\nA file named "${cleanName}" is already in your download list.\n\nDo you want to add it anyway?`);
            if (!proceed) return;
        }
    }

    addUrlModal.classList.add('active');
    validateForm();
    inputUrl.focus();

    if (data.url.includes('list=')) {
        checkAndLoadPlaylist(data.url);
    } else if (isStreamUrl(data.url)) {
        checkAndFetchMediaSize(data.url);
    }
}

// Render Table Items
function renderDownloads() {
    const filtered = downloads.filter(d => {
        if (currentFilter) {
            if (currentFilter === 'all') return true;
            return d.status === currentFilter;
        }
        if (currentCategoryFilter) {
            return d.category === currentCategoryFilter;
        }
        return true;
    });

    // Update Sidebar Badges
    document.getElementById('badge-all').innerText = downloads.length;
    
    const downloadingCount = downloads.filter(d => d.status === 'downloading' || d.status === 'connecting').length;
    document.getElementById('badge-downloading').innerText = downloadingCount;
    
    const downloadingIcon = document.getElementById('nav-downloading-icon');
    if (downloadingIcon) {
        if (downloadingCount > 0) {
            downloadingIcon.classList.add('fa-spin-slow');
        } else {
            downloadingIcon.classList.remove('fa-spin-slow');
        }
    }

    document.getElementById('badge-completed').innerText = downloads.filter(d => d.status === 'completed').length;
    document.getElementById('badge-paused').innerText = downloads.filter(d => d.status === 'paused').length;
    document.getElementById('badge-failed').innerText = downloads.filter(d => d.status === 'failed').length;

    // Update Category Badges
    const allSidebarCats = [
        ...defaultCategories,
        ...(appSettings && appSettings.customCategories ? appSettings.customCategories.map(c => ({ id: c.id })) : [])
    ];
    allSidebarCats.forEach(cat => {
        const badge = document.getElementById(`badge-${cat.id}`);
        if (badge) {
            badge.innerText = downloads.filter(d => d.category === cat.id).length;
        }
    });

    // Sync the "Select All" checkbox in the header
    const selectAllDownloads = document.getElementById('select-all-downloads');
    if (selectAllDownloads) {
        const visibleChecked = filtered.filter(d => checkedDownloadIds.has(d.id));
        selectAllDownloads.checked = filtered.length > 0 && visibleChecked.length === filtered.length;
    }

    if (filtered.length === 0) {
        downloadListBody.innerHTML = `
            <tr class="empty-state-row">
                <td colspan="9" class="empty-state">
                    <i class="fa-solid fa-folder-open empty-icon"></i>
                    <p>No downloads in this category.</p>
                </td>
            </tr>
        `;
        selectedDownloadId = null;
        updateToolbarState();
        updateGlobalStats();
        return;
    }

    downloadListBody.innerHTML = '';
    filtered.forEach(d => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', d.id);
        if (d.id === selectedDownloadId) {
            tr.classList.add('selected');
        }

        const percentage = d.totalSize ? (d.downloaded / d.totalSize) * 100 : 0;
        const isChecked = checkedDownloadIds.has(d.id) ? 'checked' : '';

        tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle; padding: 10px 5px;" class="checkbox-cell">
                <input type="checkbox" class="download-row-checkbox" data-id="${d.id}" ${isChecked} style="accent-color: var(--accent-color); cursor: pointer;">
            </td>
            <td class="col-name" title="${d.savePath}">
                ${getThumbnailHTML(d)}
                <span style="margin-left: 8px; font-weight: 500;">${d.filename}</span>
            </td>
            <td class="col-size">${d.totalSize ? formatBytes(d.totalSize) : 'Unknown'}</td>
            <td>
                <div class="progress-wrapper">
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${percentage.toFixed(1)}%"></div>
                    </div>
                    <div class="progress-text">
                        <span class="downloaded-text">${formatBytes(d.downloaded)} / ${d.totalSize ? formatBytes(d.totalSize) : 'Unknown'}</span>
                        <span class="percent-text">${percentage.toFixed(1)}%</span>
                    </div>
                </div>
            </td>
            <td class="col-status">
                <span class="status-badge ${d.status}">${d.statusDetail || d.status}</span>
            </td>
            <td class="col-category">
                <span class="category-badge ${d.category || 'other'}">${d.category || 'other'}</span>
            </td>
            <td class="col-speed">${d.status === 'downloading' ? formatSpeed(d.speed) : '-'}</td>
            <td class="col-time">${d.status === 'downloading' ? formatTimeRemaining(d.timeRemaining) : '-'}</td>
            <td class="col-date">${formatDate(d.dateAdded)}</td>
        `;

        // Row Selection
        tr.addEventListener('click', () => {
            document.querySelectorAll('.download-table tbody tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            selectedDownloadId = d.id;
            updateToolbarState();
        });

        // Checkbox click propagation bypass
        const chk = tr.querySelector('.download-row-checkbox');
        if (chk) {
            chk.addEventListener('click', (e) => {
                e.stopPropagation();
                if (chk.checked) {
                    checkedDownloadIds.add(d.id);
                } else {
                    checkedDownloadIds.delete(d.id);
                }
                updateToolbarState();
            });
        }

        // Double Click to open progress or open file
        tr.addEventListener('dblclick', () => {
            if (d.status === 'completed') {
                openDownloadedFile(d);
            } else {
                window.api.resumeDownload(d.id);
            }
        });

        downloadListBody.appendChild(tr);
    });

    updateToolbarState();
    updateGlobalStats();
}

function getThumbnailHTML(download) {
    if (download.url) {
        try {
            const urlObj = new URL(download.url);
            const hostname = urlObj.hostname.toLowerCase();
            if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
                let videoId = '';
                if (hostname.includes('youtu.be')) {
                    videoId = urlObj.pathname.slice(1);
                } else if (urlObj.searchParams.has('v')) {
                    videoId = urlObj.searchParams.get('v');
                }
                if (videoId) {
                    return `<div class="thumbnail-wrapper" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border-color); vertical-align: middle; margin-right: 8px; flex-shrink: 0; overflow: hidden; background-color: var(--bg-tertiary);">
                        <img src="https://img.youtube.com/vi/${videoId}/default.jpg" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.outerHTML='${getFileIconInnerHTML(download.filename, download.url)}'">
                    </div>`;
                }
            }
        } catch(e) {}
    }
    return getFileIconHTML(download.filename, download.url);
}

function getFileIconInnerHTML(filename, url = '') {
    if (url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            if (hostname.includes('facebook.com') || hostname.includes('fb.watch') || hostname.includes('fb.com')) {
                return `<i class="fa-brands fa-facebook" style="color: #1877F2; font-size: 18px;"></i>`;
            }
            if (hostname.includes('instagram.com')) {
                return `<i class="fa-brands fa-instagram" style="color: #E1306C; font-size: 18px;"></i>`;
            }
            if (hostname.includes('soundcloud.com')) {
                return `<i class="fa-brands fa-soundcloud" style="color: #FF5500; font-size: 18px;"></i>`;
            }
            if (hostname.includes('tiktok.com')) {
                return `<i class="fa-brands fa-tiktok" style="color: var(--text-main); font-size: 18px; text-shadow: 1px 1px 0 #00f2fe, -1px -1px 0 #fe0979;"></i>`;
            }
        } catch (e) {}
    }

    const ext = filename.split('.').pop().toLowerCase();
    
    // 1. Android APK (Green Android Droid)
    if (ext === 'apk') {
        return `<i class="fa-brands fa-android" style="color: #3DDC84; font-size: 16px;"></i>`;
    }
    
    // 2. HTML / Web pages (Chrome Brand Colors)
    if (['html', 'htm', 'php', 'asp', 'jsp'].includes(ext)) {
        return `<i class="fa-brands fa-chrome" style="color: #4285F4; font-size: 16px;"></i>`;
    }
    
    // 3. Videos (VLC Traffic Cone SVG!)
    if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', '3gp'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" style="fill: #f15a24; display: inline-block;">
            <polygon points="12,2 15,16 9,16" fill="#f15a24"/>
            <ellipse cx="12" cy="16" rx="4" ry="1.5" fill="#f15a24"/>
            <polygon points="11.1,6 12.9,6 13.5,10 10.5,10" fill="#ffffff"/>
            <polygon points="10.2,11 13.8,11 14.3,14 9.7,14" fill="#ffffff"/>
            <ellipse cx="12" cy="19" rx="8" ry="2.5" fill="#f15a24"/>
            <ellipse cx="12" cy="19" rx="7" ry="2" fill="#d0481b"/>
        </svg>`;
    }
    
    // 4. Audio / Music (Purple Disc / CD)
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'].includes(ext)) {
        return `<i class="fa-solid fa-compact-disc" style="color: #a855f7; font-size: 16px;"></i>`;
    }
    
    // 5. Setup Program / Windows Executable (Setup Installer SVG)
    if (['exe', 'msi', 'bat', 'cmd', 'dmg'].includes(ext)) {
        return `<svg viewBox="0 0 24 24" width="18" height="18" style="fill: #0284c7; display: inline-block;">
            <rect x="2" y="2" width="20" height="15" rx="2" fill="#0284c7" />
            <rect x="4" y="4" width="16" height="11" fill="#ffffff" />
            <rect x="2" y="17" width="20" height="3" fill="#64748b" />
            <path d="M12 5v5H9l3 3 3-3h-3z" fill="#10b981" />
        </svg>`;
    }
    
    // 6. Zip / Compressed archive (Orange Zip Archive)
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return `<i class="fa-solid fa-file-zipper" style="color: #f59e0b; font-size: 16px;"></i>`;
    }
    
    // 7. PDF Document (Red PDF)
    if (ext === 'pdf') {
        return `<i class="fa-solid fa-file-pdf" style="color: #ef4444; font-size: 16px;"></i>`;
    }
    
    // 8. Text & Office documents
    if (['txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
        let color = '#3b82f6';
        let icon = 'fa-file-lines';
        if (['doc', 'docx'].includes(ext)) { color = '#2b579a'; icon = 'fa-file-word'; }
        else if (['xls', 'xlsx'].includes(ext)) { color = '#217346'; icon = 'fa-file-excel'; }
        else if (['ppt', 'pptx'].includes(ext)) { color = '#b7472a'; icon = 'fa-file-powerpoint'; }
        return `<i class="fa-solid ${icon}" style="color: ${color}; font-size: 16px;"></i>`;
    }
    
    // 9. Images (Pink file-image)
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
        return `<i class="fa-solid fa-file-image" style="color: #ec4899; font-size: 16px;"></i>`;
    }
    
    // Default file
    return `<i class="fa-solid fa-file" style="color: #94a3b8; font-size: 16px;"></i>`;
}

function getFileIconHTML(filename, url = '') {
    return `<div class="thumbnail-wrapper" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--border-color); vertical-align: middle; margin-right: 8px; flex-shrink: 0; background-color: var(--bg-tertiary);">
        ${getFileIconInnerHTML(filename, url)}
    </div>`;
}

// Update Enabled States of Toolbar Actions
function updateToolbarState() {
    if (checkedDownloadIds.size > 0) {
        const checkedList = downloads.filter(d => checkedDownloadIds.has(d.id));
        
        btnOpenFile.disabled = true;
        btnOpenFolder.disabled = checkedList.length !== 1;
        if (btnConvertFile) btnConvertFile.disabled = true;
        
        btnDelete.disabled = false;
        
        const canResume = checkedList.some(d => d.status !== 'downloading' && d.status !== 'connecting' && d.status !== 'completed');
        btnResume.disabled = !canResume;
        
        const canPause = checkedList.some(d => d.status === 'downloading' || d.status === 'connecting');
        btnPause.disabled = !canPause;
        return;
    }

    if (!selectedDownloadId) {
        btnResume.disabled = true;
        btnPause.disabled = true;
        btnDelete.disabled = true;
        btnOpenFile.disabled = true;
        btnOpenFolder.disabled = true;
        if (btnConvertFile) btnConvertFile.disabled = true;
        return;
    }

    const download = downloads.find(d => d.id === selectedDownloadId);
    if (!download) {
        selectedDownloadId = null;
        updateToolbarState();
        return;
    }

    btnDelete.disabled = false;
    btnOpenFolder.disabled = false;
    if (btnConvertFile) btnConvertFile.disabled = true;

    if (download.status === 'downloading' || download.status === 'connecting') {
        btnResume.disabled = true;
        btnPause.disabled = false;
        btnOpenFile.disabled = true;
    } else if (download.status === 'completed') {
        btnResume.disabled = true;
        btnPause.disabled = true;
        btnOpenFile.disabled = false;
        
        const isMedia = download.category === 'Videos' || download.category === 'Music';
        if (btnConvertFile) btnConvertFile.disabled = !isMedia;
    } else {
        btnResume.disabled = false;
        btnPause.disabled = true;
        btnOpenFile.disabled = true;
    }
}

// Update summary stats in bottom footer
function updateGlobalStats() {
    const active = downloads.filter(d => d.status === 'downloading' || d.status === 'connecting');
    activeJobsCount.innerText = `${active.length} download(s) active`;

    const totalSpeedBytes = active.reduce((acc, d) => acc + (d.speed || 0), 0);
    totalSpeed.innerText = `Total Speed: ${formatSpeed(totalSpeedBytes)}`;
}

async function openDownloadedFile(d) {
    if (!d || d.status !== 'completed') return;
    const res = await window.api.openFile(d.savePath);
    if (res && !res.success) {
        if (res.error === 'FileNotFound') {
            alert(`File not found: "${d.filename}"\nIt may have been moved, renamed, or deleted.`);
        } else {
            alert(`Could not open file: "${d.filename}"\nTry opening it manually from its folder.`);
        }
    }
}

// Setup Event Handlers
function setupEventListeners() {
    // Toolbar Actions
    btnResume.addEventListener('click', () => {
        if (checkedDownloadIds.size > 0) {
            checkedDownloadIds.forEach(id => {
                const d = downloads.find(x => x.id === id);
                if (d && d.status !== 'downloading' && d.status !== 'connecting' && d.status !== 'completed') {
                    window.api.resumeDownload(id);
                }
            });
        } else if (selectedDownloadId) {
            window.api.resumeDownload(selectedDownloadId);
        }
    });

    btnPause.addEventListener('click', () => {
        if (checkedDownloadIds.size > 0) {
            checkedDownloadIds.forEach(id => {
                const d = downloads.find(x => x.id === id);
                if (d && (d.status === 'downloading' || d.status === 'connecting')) {
                    window.api.pauseDownload(id);
                }
            });
        } else if (selectedDownloadId) {
            window.api.pauseDownload(selectedDownloadId);
        }
    });

    // Custom Delete Confirmation Modal logic
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const deleteModalCloseBtn = document.getElementById('delete-modal-close-btn');
    const btnDeleteConfirmCancel = document.getElementById('btn-delete-confirm-cancel');
    const btnDeleteConfirmSubmit = document.getElementById('btn-delete-confirm-submit');
    const chkDeleteDiskFile = document.getElementById('chk-delete-disk-file');
    const deleteModalPromptText = document.getElementById('delete-modal-prompt-text');
    let deleteTargetIds = [];

    btnDelete.addEventListener('click', () => {
        deleteTargetIds = [];
        if (checkedDownloadIds.size > 0) {
            deleteTargetIds = Array.from(checkedDownloadIds);
            deleteModalPromptText.innerText = `Are you sure you want to delete the ${deleteTargetIds.length} selected download(s) from the list?`;
        } else if (selectedDownloadId) {
            deleteTargetIds = [selectedDownloadId];
            const d = downloads.find(x => x.id === selectedDownloadId);
            deleteModalPromptText.innerText = `Are you sure you want to delete "${d ? d.filename : 'this download'}" from the list?`;
        }
        
        if (deleteTargetIds.length > 0) {
            chkDeleteDiskFile.checked = false;
            deleteConfirmModal.classList.add('active');
        }
    });

    const closeDeleteModal = () => {
        deleteConfirmModal.classList.remove('active');
    };

    deleteModalCloseBtn.addEventListener('click', closeDeleteModal);
    btnDeleteConfirmCancel.addEventListener('click', closeDeleteModal);

    btnDeleteConfirmSubmit.addEventListener('click', async () => {
        const deleteDisk = chkDeleteDiskFile.checked;
        closeDeleteModal();
        
        for (const id of deleteTargetIds) {
            await window.api.cancelDownload(id, deleteDisk);
            checkedDownloadIds.delete(id);
        }
        
        selectedDownloadId = null;
        renderDownloads();
    });

    btnOpenFile.addEventListener('click', () => {
        if (selectedDownloadId) {
            const d = downloads.find(x => x.id === selectedDownloadId);
            if (d) openDownloadedFile(d);
        }
    });

    btnOpenFolder.addEventListener('click', () => {
        let targetId = selectedDownloadId;
        if (checkedDownloadIds.size === 1) {
            targetId = Array.from(checkedDownloadIds)[0];
        }
        if (targetId) {
            const d = downloads.find(x => x.id === targetId);
            if (d) window.api.openFolder(d.savePath);
        }
    });

    // Reset settings to default button trigger
    const btnResetSettings = document.getElementById('btn-reset-settings');
    if (btnResetSettings) {
        btnResetSettings.addEventListener('click', async () => {
            if (confirm('Are you sure you want to reset all settings to their default values? This will clear custom category paths and options.')) {
                try {
                    const reseted = await window.api.resetSettings();
                    appSettings = reseted;
                    populateSettingsUI(reseted);
                    applyThemeAndAccent(reseted.theme, reseted.accentColor);
                    
                    const statusMsg = document.getElementById('settings-status-msg');
                    statusMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Settings reset to default';
                    statusMsg.style.opacity = 1;
                    setTimeout(() => {
                        statusMsg.style.opacity = 0;
                        statusMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Settings saved successfully';
                    }, 3000);
                } catch (e) {
                    console.error('Failed to reset settings:', e);
                    alert('Failed to reset settings!');
                }
            }
        });
    }

    // Logout user trigger
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (confirm('Are you sure you want to log out of Apna Downloader?')) {
                await window.api.logoutUser();
            }
        });
    }

    // Select-all checkbox in header trigger
    const selectAllDownloads = document.getElementById('select-all-downloads');
    if (selectAllDownloads) {
        selectAllDownloads.addEventListener('change', () => {
            const checked = selectAllDownloads.checked;
            const filtered = downloads.filter(d => {
                if (currentFilter) {
                    if (currentFilter === 'all') return true;
                    return d.status === currentFilter;
                }
                if (currentCategoryFilter) {
                    return d.category === currentCategoryFilter;
                }
                return true;
            });
            
            filtered.forEach(d => {
                if (checked) {
                    checkedDownloadIds.add(d.id);
                } else {
                    checkedDownloadIds.delete(d.id);
                }
            });
            
            renderDownloads();
        });
    }

    if (btnConvertFile) {
        btnConvertFile.addEventListener('click', () => {
            if (selectedDownloadId) {
                const d = downloads.find(x => x.id === selectedDownloadId);
                if (d) {
                    // Populate converter source info
                    converterSourceName.innerText = d.filename;
                    converterSourceSize.innerText = formatBytes(d.totalSize);
                    
                    // Reset converter modal form state
                    converterFormGroup.style.display = 'flex';
                    converterProgressContainer.style.display = 'none';
                    converterPercentText.innerText = '0.0%';
                    converterProgressBarFill.style.width = '0%';
                    btnConverterStart.disabled = false;
                    btnConverterStart.innerText = 'Convert';
                    
                    // Show modal
                    mediaConverterModal.classList.add('active');
                }
            }
        });
    }

    const closeConverterModal = () => {
        if (isConverting) {
            if (confirm('A conversion is currently in progress. Cancel it?')) {
                window.api.cancelConversion(convertingDownloadId);
                isConverting = false;
                convertingDownloadId = null;
                mediaConverterModal.classList.remove('active');
            }
        } else {
            mediaConverterModal.classList.remove('active');
        }
    };

    btnCloseConverterBtn.addEventListener('click', closeConverterModal);
    btnConverterCancel.addEventListener('click', closeConverterModal);

    btnConverterStart.addEventListener('click', async () => {
        if (selectedDownloadId && !isConverting) {
            const selectedFormat = document.querySelector('input[name="converter-format"]:checked').value;
            
            // Set state
            isConverting = true;
            convertingDownloadId = selectedDownloadId;
            btnConverterStart.disabled = true;
            btnConverterStart.innerText = 'Converting...';
            
            // Show progress section
            converterFormGroup.style.display = 'none';
            converterProgressContainer.style.display = 'flex';
            converterStatusText.innerText = 'Converting media file...';
            converterPercentText.innerText = '0.0%';
            converterProgressBarFill.style.width = '0%';
            
            try {
                await window.api.convertMedia(selectedDownloadId, selectedFormat);
            } catch (err) {
                alert('Failed to start conversion: ' + err.message);
                isConverting = false;
                convertingDownloadId = null;
                mediaConverterModal.classList.remove('active');
            }
        }
    });

    btnOpenFolder.addEventListener('click', () => {
        if (selectedDownloadId) {
            const d = downloads.find(x => x.id === selectedDownloadId);
            if (d) window.api.openFolder(d.savePath);
        }
    });

    btnStartQueue.addEventListener('click', () => {
        window.api.startQueue();
    });

    btnStopQueue.addEventListener('click', () => {
        window.api.stopQueue();
    });

    // Navigation Category Selection
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const tableContainer = document.querySelector('.table-container');
            const settingsContainer = document.getElementById('settings-container');
            const analyticsContainer = document.getElementById('analytics-container');
            const profileContainer = document.getElementById('profile-container');
 
            if (item.id === 'nav-settings') {
                tableContainer.style.display = 'none';
                settingsContainer.style.display = 'block';
                if (analyticsContainer) analyticsContainer.style.display = 'none';
                if (profileContainer) profileContainer.style.display = 'none';
            } else if (item.id === 'nav-analytics') {
                tableContainer.style.display = 'none';
                settingsContainer.style.display = 'none';
                if (profileContainer) profileContainer.style.display = 'none';
                if (analyticsContainer) {
                    analyticsContainer.style.display = 'block';
                    if (window.resizeAnalyticsCanvas) {
                        window.resizeAnalyticsCanvas();
                    }
                }
            } else {
                tableContainer.style.display = 'block';
                settingsContainer.style.display = 'none';
                if (analyticsContainer) analyticsContainer.style.display = 'none';
                if (profileContainer) profileContainer.style.display = 'none';
                
                const filter = item.getAttribute('data-filter');
                const category = item.getAttribute('data-category');
                
                if (filter) {
                    currentFilter = filter;
                    currentCategoryFilter = null;
                } else if (category) {
                    currentFilter = null;
                    currentCategoryFilter = category;
                }
                renderDownloads();
            }
        });
    });

    // Save Settings Button
    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', saveSettingsFromUI);
    }

    // Color swatches click listener
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
        });
    });

    // Quick Speed Limiter UI bindings
    const quickLimitEnable = document.getElementById('quick-limit-enable');
    const quickLimitValue = document.getElementById('quick-limit-value');
    if (quickLimitEnable && quickLimitValue) {
        const updateQuickLimiter = async () => {
            appSettings.speedLimitEnabled = quickLimitEnable.checked;
            appSettings.maxSpeedLimit = parseInt(quickLimitValue.value, 10) || 1024;
            
            // Sync settings page controls
            const mainLimitEnable = document.getElementById('setting-limit-speed');
            const mainLimitValue = document.getElementById('setting-speed-value');
            if (mainLimitEnable) mainLimitEnable.checked = appSettings.speedLimitEnabled;
            if (mainLimitValue) mainLimitValue.value = appSettings.maxSpeedLimit;
            
            // Save settings
            await window.api.saveSettings(appSettings);
        };
        quickLimitEnable.addEventListener('change', updateQuickLimiter);
        quickLimitValue.addEventListener('change', updateQuickLimiter);
    }

    // Onboarding Tour Navigation Event Listeners
    const btnTourSkip = document.getElementById('btn-tour-skip');
    if (btnTourSkip) {
        btnTourSkip.addEventListener('click', finishTour);
    }
    
    const btnTourBack = document.getElementById('btn-tour-back');
    if (btnTourBack) {
        btnTourBack.addEventListener('click', () => {
            if (currentTourStep > 0) {
                showTourStep(currentTourStep - 1);
            }
        });
    }
    
    const btnTourNext = document.getElementById('btn-tour-next');
    if (btnTourNext) {
        btnTourNext.addEventListener('click', () => {
            if (currentTourStep < tourSteps.length - 1) {
                showTourStep(currentTourStep + 1);
            } else {
                finishTour();
            }
        });
    }

    const btnRestartTour = document.getElementById('btn-restart-tour');
    if (btnRestartTour) {
        btnRestartTour.addEventListener('click', () => {
            // Switch back to downloads table view
            const tableContainer = document.querySelector('.table-container');
            const settingsContainer = document.getElementById('settings-container');
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            if (navAll) navAll.classList.add('active');
            
            tableContainer.style.display = 'block';
            settingsContainer.style.display = 'none';
            
            currentFilter = 'all';
            currentCategoryFilter = null;
            renderDownloads();
            
            // Start the tour
            startOnboardingTour();
        });
    }

    // Adjust spotlight positioning if window resizes during active tour
    window.addEventListener('resize', () => {
        const overlay = document.getElementById('tour-overlay');
        if (overlay && overlay.style.display === 'block') {
            showTourStep(currentTourStep);
        }
    });

    // Modal Control
    btnAddUrl.addEventListener('click', async () => {
        let clipboardUrl = '';
        try {
            const text = await navigator.clipboard.readText();
            if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
                clipboardUrl = text.trim();
            }
        } catch (e) {}
        
        if (window.api && window.api.openInfoWindow) {
            window.api.openInfoWindow({ url: clipboardUrl });
        }
    });

    modalCloseBtn.addEventListener('click', closeModal);
    btnAddCancel.addEventListener('click', closeModal);

    inputUrl.addEventListener('input', (e) => {
        handleUrlChange(e.target.value);
    });

    btnBrowseFolder.addEventListener('click', async () => {
        const folder = await window.api.selectFolder();
        if (folder) {
            isManualFolder = true; // Mark as custom chosen
            const urlText = inputUrl.value.trim();
            let filename = getFilenameFromUrl(urlText) || 'download';
            let ext = getFileExtension(filename) || getFileExtension(urlText) || '';
            if (isStreamUrl(urlText) && !ext) {
                ext = selectCategory.value === 'music' ? 'mp3' : 'mp4';
            }
            let cleanName = sanitizeFilename(filename);
            if (ext && !cleanName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
                cleanName += `.${ext}`;
            }
            inputSavePath.value = `${folder}\\${cleanName}`;
            validateForm();
        }
    });

    // Category selection change
    selectCategory.addEventListener('change', (e) => {
        updateCategoryUI(e.target.value);
    });

    // Start download immediately
    btnAddStart.addEventListener('click', async () => {
        const url = inputUrl.value.trim();
        const savePath = inputSavePath.value.trim();
        const threads = parseInt(selectThreads.value, 10);

        if (isPlaylistActive) {
            closeModal();
            const checkedBoxes = document.querySelectorAll('.playlist-item-checkbox:checked');
            const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
            const dir = lastSlash > -1 ? savePath.substring(0, lastSlash) : '';
            const ext = grabbedQuality === 'audio' ? 'mp3' : 'mp4';
            
            for (let i = 0; i < checkedBoxes.length; i++) {
                const index = parseInt(checkedBoxes[i].getAttribute('data-index'), 10);
                const item = playlistItems[index];
                if (item) {
                    const cleanTitle = sanitizeFilename(item.title) + '.' + ext;
                    const finalItemPath = dir ? `${dir}\\${cleanTitle}` : cleanTitle;
                    const silent = i > 0; 
                    await window.api.addDownload(item.url, finalItemPath, threads, grabbedQuality, false, grabbedReferer, grabbedUserAgent, grabbedEngine, silent, chkDownloadSubtitles.checked);
                }
            }
        } else if (url && savePath) {
            closeModal();
            await window.api.addDownload(url, savePath, threads, grabbedQuality, false, grabbedReferer, grabbedUserAgent, grabbedEngine, false, chkDownloadSubtitles.checked);
        }
    });

    // Download later (add in idle state)
    btnAddLater.addEventListener('click', async () => {
        const url = inputUrl.value.trim();
        const savePath = inputSavePath.value.trim();
        const threads = parseInt(selectThreads.value, 10);

        if (isPlaylistActive) {
            closeModal();
            const checkedBoxes = document.querySelectorAll('.playlist-item-checkbox:checked');
            const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
            const dir = lastSlash > -1 ? savePath.substring(0, lastSlash) : '';
            const ext = grabbedQuality === 'audio' ? 'mp3' : 'mp4';
            
            for (let i = 0; i < checkedBoxes.length; i++) {
                const index = parseInt(checkedBoxes[i].getAttribute('data-index'), 10);
                const item = playlistItems[index];
                if (item) {
                    const cleanTitle = sanitizeFilename(item.title) + '.' + ext;
                    const finalItemPath = dir ? `${dir}\\${cleanTitle}` : cleanTitle;
                    await window.api.addDownload(item.url, finalItemPath, threads, grabbedQuality, true, grabbedReferer, grabbedUserAgent, grabbedEngine, true, chkDownloadSubtitles.checked);
                }
            }
        } else if (url && savePath) {
            closeModal();
            await window.api.addDownload(url, savePath, threads, grabbedQuality, true, grabbedReferer, grabbedUserAgent, grabbedEngine, false, chkDownloadSubtitles.checked);
        }
    });

    // Open Add Category Modal
    btnAddCategory.addEventListener('click', () => {
        document.getElementById('input-category-name').value = '';
        document.getElementById('input-category-save-path').value = '';
        document.getElementById('input-category-extensions').value = '';
        document.getElementById('add-category-modal').classList.add('active');
    });

    // Browse Folder for Category Save Path
    const btnBrowseCatFolder = document.getElementById('btn-browse-category-folder');
    if (btnBrowseCatFolder) {
        btnBrowseCatFolder.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder) {
                document.getElementById('input-category-save-path').value = folder;
            }
        });
    }

    // Category modal cancel/close actions
    const closeCatBtn = document.getElementById('modal-close-category-btn');
    if (closeCatBtn) {
        closeCatBtn.addEventListener('click', () => {
            document.getElementById('add-category-modal').classList.remove('active');
        });
    }
    
    const cancelCatBtn = document.getElementById('btn-create-category-cancel');
    if (cancelCatBtn) {
        cancelCatBtn.addEventListener('click', () => {
            document.getElementById('add-category-modal').classList.remove('active');
        });
    }

    // Save Custom Category Action
    const saveCatBtn = document.getElementById('btn-create-category-save');
    if (saveCatBtn) {
        saveCatBtn.addEventListener('click', async () => {
            const name = document.getElementById('input-category-name').value.trim();
            const savePath = document.getElementById('input-category-save-path').value.trim();
            const extensionsRaw = document.getElementById('input-category-extensions').value.trim();
            
            if (!name) {
                alert('Please enter a category name.');
                return;
            }
            if (!savePath) {
                alert('Please select a default save folder.');
                return;
            }
            
            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            
            // Check duplicates
            const isDuplicate = defaultCategories.some(c => c.id === id) || 
                                (appSettings.customCategories && appSettings.customCategories.some(c => c.id === id)) ||
                                id === 'other';
            if (isDuplicate) {
                alert('A category with a similar name already exists.');
                return;
            }
            
            const extensions = extensionsRaw 
                ? extensionsRaw.split(',').map(e => e.trim().toLowerCase().replace(/^\./, '')).filter(e => e.length > 0)
                : [];
                
            const newCategory = { id, name, savePath, extensions };
            
            if (!appSettings.customCategories) {
                appSettings.customCategories = [];
            }
            
            appSettings.customCategories.push(newCategory);
            
            try {
                const saved = await window.api.saveSettings({ customCategories: appSettings.customCategories });
                appSettings = saved;
                
                // Add to path mappings
                defaultCategoryPaths[id] = savePath;
                
                // Refresh dropdowns and sidebar
                renderCategoriesList();
                
                // Set selected category in the Add URL Modal
                selectCategory.value = id;
                updateCategoryUI(id);
                
                // Close modal
                document.getElementById('add-category-modal').classList.remove('active');
            } catch (e) {
                console.error('Failed to save category:', e);
                alert('Failed to save category.');
            }
        });
    }

    // Clipboard toast action buttons
    document.getElementById('btn-clipboard-download').addEventListener('click', () => {
        const toast = document.getElementById('clipboard-toast');
        const url = document.getElementById('clipboard-toast-url').innerText;
        if (toast) toast.classList.remove('active');
        if (url) {
            if (window.api && window.api.openInfoWindow) {
                window.api.openInfoWindow({ url: url });
            }
        }
    });

    document.getElementById('btn-clipboard-ignore').addEventListener('click', () => {
        const toast = document.getElementById('clipboard-toast');
        if (toast) toast.classList.remove('active');
    });


}

function closeModal() {
    if (isGrabMode) {
        window.close();
        return;
    }
    addUrlModal.classList.remove('active');
}

function getCategoryFolder(filename) {
    const cat = detectCategory(filename);
    return defaultCategoryPaths[cat] || defaultCategoryPaths.other;
}

function getFileExtension(str) {
    if (!str) return '';
    
    // If it looks like a URL, parse it first to get the pathname
    let pathStr = str;
    if (str.startsWith('http://') || str.startsWith('https://')) {
        try {
            const url = new URL(str);
            pathStr = url.pathname;
        } catch (e) {
            // ignore URL parse errors
        }
    }
    
    // Get the last segment
    const lastSegment = pathStr.substring(pathStr.lastIndexOf('/') + 1);
    
    // Remove query parameters or hash if present
    const cleanSegment = lastSegment.split('?')[0].split('#')[0];
    
    const parts = cleanSegment.split('.');
    if (parts.length > 1) {
        const ext = parts.pop().toLowerCase();
        // Ensure it's a valid extension (only apnanumeric, length 2 to 5)
        if (/^[a-z0-9]{2,5}$/.test(ext)) {
            return ext;
        }
    }
    return '';
}

function sanitizeFilename(name) {
    if (!name) return 'download';
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

let currentFetchUrl = '';

function handleUrlChange(urlText) {
    urlText = urlText.trim();
    
    playlistContainer.style.display = 'none';
    playlistLoader.style.display = 'none';
    isPlaylistActive = false;
    playlistItems = [];
    currentSizeText = "Unknown";
    btnAddStart.innerText = 'Start Download';
    btnAddLater.innerText = 'Download Later';
    
    if (urlText.startsWith('data:')) {
        let ext = '';
        const matches = urlText.match(/^data:([^;]+);/);
        if (matches) {
            ext = getExtensionFromMimeType(matches[1]);
        }
        let cleanName = 'download';
        if (ext) cleanName += '.' + ext;
        const category = detectCategory(cleanName);
        selectCategory.value = category;
        updateCategoryUI(category);
        validateForm();
        return;
    }
    
    if (urlText.startsWith('http://') || urlText.startsWith('https://')) {
        let filename = getFilenameFromUrl(urlText) || 'download';
        
        let ext = getFileExtension(filename) || getFileExtension(urlText) || '';
        if (isStreamUrl(urlText) && !ext) {
            ext = grabbedQuality === 'audio' ? 'mp3' : 'mp4';
        }
        
        let cleanName = sanitizeFilename(filename);
        if (ext && !cleanName.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
            cleanName += `.${ext}`;
        }

        const category = detectCategory(cleanName);
        selectCategory.value = category;
        updateCategoryUI(category);
        
        if (urlText.includes('list=')) {
            checkAndLoadPlaylist(urlText);
        } else if (isStreamUrl(urlText)) {
            checkAndFetchMediaSize(urlText);
        }
    }
    validateForm();
}

async function checkAndLoadPlaylist(url) {
    currentFetchUrl = url;
    playlistLoader.style.display = 'flex';
    playlistContainer.style.display = 'none';
    btnAddStart.disabled = true;
    btnAddLater.disabled = true;

    try {
        const result = await window.api.fetchPlaylistMetadata(url);
        if (currentFetchUrl !== url) return;

        playlistLoader.style.display = 'none';
        if (result && result.isPlaylist && result.items && result.items.length > 0) {
            isPlaylistActive = true;
            playlistItems = result.items;
            playlistTitle.innerText = `${result.title || 'Playlist'} (${result.items.length} videos)`;
            
            playlistItemsList.innerHTML = result.items.map((item, index) => {
                const durationStr = item.duration ? formatTimeRemaining(item.duration) : '';
                return `
                    <div style="display: flex; align-items: flex-start; gap: 8px; font-size: 12px; padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05);">
                        <input type="checkbox" class="playlist-item-checkbox" data-index="${index}" checked style="accent-color: var(--accent-color); margin-top: 2px;">
                        <span style="flex: 1; word-break: break-all; line-height: 1.3; font-weight: 500;">${index + 1}. ${item.title}</span>
                        <span style="color: var(--text-muted); font-size: 11px; margin-left: auto; white-space: nowrap;">${durationStr}</span>
                    </div>
                `;
            }).join('');

            playlistContainer.style.display = 'flex';
            btnAddStart.innerText = 'Queue Playlist';
            btnAddLater.innerText = 'Queue Later';
            btnAddStart.disabled = false;
            btnAddLater.disabled = false;

            const itemCheckboxes = document.querySelectorAll('.playlist-item-checkbox');
            playlistSelectAll.checked = true;
            
            playlistSelectAll.onchange = () => {
                itemCheckboxes.forEach(cb => cb.checked = playlistSelectAll.checked);
                validateForm();
            };

            itemCheckboxes.forEach(cb => {
                cb.onchange = () => {
                    const allChecked = Array.from(itemCheckboxes).every(c => c.checked);
                    playlistSelectAll.checked = allChecked;
                    validateForm();
                };
            });
        }
    } catch (e) {
        console.error('[Playlist Load] Error:', e);
        if (currentFetchUrl === url) {
            playlistLoader.style.display = 'none';
            validateForm();
        }
    }
}

let sizeFetchTimeout = null;

async function checkAndFetchMediaSize(url) {
    if (sizeFetchTimeout) clearTimeout(sizeFetchTimeout);
    
    currentSizeText = "Loading...";
    updateSidePanel(selectCategory.value, currentSizeText);
    
    sizeFetchTimeout = setTimeout(async () => {
        try {
            const res = await window.api.fetchMediaSize(url, grabbedQuality);
            if (inputUrl.value.trim() !== url) return;
            
            if (res && res.success && res.size > 0) {
                currentSizeText = formatBytes(res.size);
                updateSidePanel(selectCategory.value, currentSizeText);
                
                const savePathVal = inputSavePath.value.trim();
                const lastSlash = Math.max(savePathVal.lastIndexOf('\\'), savePathVal.lastIndexOf('/'));
                const dir = lastSlash > -1 ? savePathVal.substring(0, lastSlash) : '';
                const currentName = lastSlash > -1 ? savePathVal.substring(lastSlash + 1) : savePathVal;
                
                if (res.title && (currentName.startsWith('watch') || currentName.startsWith('download') || currentName === 'video.mp4')) {
                    const ext = grabbedQuality === 'audio' ? 'mp3' : 'mp4';
                    const cleanTitle = sanitizeFilename(res.title) + '.' + ext;
                    inputSavePath.value = dir ? `${dir}\\${cleanTitle}` : cleanTitle;
                }
            } else {
                currentSizeText = "Streaming";
                updateSidePanel(selectCategory.value, currentSizeText);
            }
        } catch (e) {
            if (inputUrl.value.trim() === url) {
                currentSizeText = "Streaming";
                updateSidePanel(selectCategory.value, currentSizeText);
            }
        }
    }, 800);
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
        
        // Remove query parameters from filename
        if (filename.indexOf('?') > -1) {
            filename = filename.substring(0, filename.indexOf('?'));
        }
        
        // Decode URI component (e.g. %20 -> space)
        filename = decodeURIComponent(filename);
        
        return filename || null;
    } catch (e) {
        return null;
    }
}

function validateForm() {
    const urlVal = inputUrl.value.trim();
    const pathVal = inputSavePath.value.trim();
    
    const isValidUrl = urlVal.startsWith('http://') || urlVal.startsWith('https://') || urlVal.startsWith('data:');
    let isValidPath = pathVal.length > 0;
    
    if (isPlaylistActive && pathVal.length > 0) {
        isValidPath = true;
    }
    
    let disabledState = !(isValidUrl && isValidPath);
    
    if (isPlaylistActive) {
        const checkedCount = document.querySelectorAll('.playlist-item-checkbox:checked').length;
        if (checkedCount === 0) disabledState = true;
    }
    
    btnAddStart.disabled = disabledState;
    btnAddLater.disabled = disabledState;
}

function updateAddStartButtonState() {
    const url = inputUrl.value.trim();
    const savePath = inputSavePath.value.trim();
    
    // Add start button is enabled if we have both URL and save path
    const disabledState = !url || !savePath;
    btnAddStart.disabled = disabledState;
    btnAddLater.disabled = disabledState;
}

// Start app
document.addEventListener('DOMContentLoaded', async () => {
    init();

    // Handle Engine Initializer UI
    const overlay = document.getElementById('engine-init-overlay');
    const progressFill = document.getElementById('engine-init-progress');
    const progressText = document.getElementById('engine-init-text');
    const percentText = document.getElementById('engine-init-percent');

    window.api.onEngineProgress((data) => {
        if (progressFill && percentText && progressText) {
            progressFill.style.width = `${data.percentage}%`;
            percentText.innerText = `${Math.round(data.percentage)}%`;
            if (data.customMessage) {
                progressText.innerText = data.customMessage;
            }
        }
    });

    try {
        await window.api.checkEngines();
    } catch (e) {
        console.error('Failed to init engines:', e);
    }

    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    }
});

// Category paths will be updated dynamically from main process on init
let defaultCategoryPaths = {
    videos: 'C:\\Downloads\\Videos',
    music: 'C:\\Downloads\\Music',
    compressed: 'C:\\Downloads\\Compressed',
    documents: 'C:\\Downloads\\Documents',
    programs: 'C:\\Downloads\\Programs',
    webpages: 'C:\\Downloads\\Web Pages',
    other: 'C:\\Downloads'
};

function detectCategory(filename) {
    if (!filename) return 'other';
    const ext = filename.split('.').pop().toLowerCase();
    
    // Check custom categories first
    if (appSettings && appSettings.customCategories) {
        for (const cat of appSettings.customCategories) {
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

// Dynamically render sidebar categories & Add URL Modal dropdown options
function renderCategoriesList() {
    const sidebarList = document.getElementById('sidebar-categories-list');
    const selectDropdown = document.getElementById('select-category');
    if (!sidebarList || !selectDropdown) return;

    // 1. Populate sidebar categories
    sidebarList.innerHTML = '';
    const allCategories = [
        ...defaultCategories,
        ...(appSettings && appSettings.customCategories ? appSettings.customCategories.map(c => ({
            id: c.id,
            name: c.name,
            icon: 'fa-folder' // Generic icon for custom categories
        })) : [])
    ];

    allCategories.forEach(cat => {
        const li = document.createElement('li');
        li.className = 'nav-item';
        if (currentCategoryFilter === cat.id) {
            li.classList.add('active');
        }
        li.setAttribute('data-category', cat.id);
        li.innerHTML = `
            <i class="fa-solid ${cat.icon}"></i>
            <span>${cat.name}</span>
            <span class="badge" id="badge-${cat.id}">0</span>
        `;

        li.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            li.classList.add('active');
            
            const tableContainer = document.querySelector('.table-container');
            const settingsContainer = document.getElementById('settings-container');

            tableContainer.style.display = 'block';
            settingsContainer.style.display = 'none';
            
            currentFilter = null;
            currentCategoryFilter = cat.id;
            
            renderDownloads();
        });

        sidebarList.appendChild(li);
    });

    // 2. Populate select dropdown
    const selectedVal = selectDropdown.value;
    selectDropdown.innerHTML = '';
    
    allCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.innerText = cat.name;
        selectDropdown.appendChild(opt);
    });
    
    const optOther = document.createElement('option');
    optOther.value = 'other';
    optOther.innerText = 'Other';
    selectDropdown.appendChild(optOther);

    if (selectedVal) {
        selectDropdown.value = selectedVal;
    }
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

function updateSidePanel(category, sizeText = "Unknown") {
    sideIconContainer.className = `file-type-icon-wrapper ${category}`;
    
    let iconClass = 'fa-file';
    switch(category) {
        case 'videos': iconClass = 'fa-file-video'; break;
        case 'music': iconClass = 'fa-file-audio'; break;
        case 'compressed': iconClass = 'fa-file-zipper'; break;
        case 'documents': iconClass = 'fa-file-lines'; break;
        case 'programs': iconClass = 'fa-file-code'; break;
        case 'webpages': iconClass = 'fa-globe'; break;
    }
    sideFileIcon.className = `fa-solid ${iconClass}`;
    sideFileSize.innerText = sizeText;
}

function updateCategoryUI(category) {
    lblCategoryName.innerText = category;
    const pathVal = defaultCategoryPaths[category] || 'C:\\Downloads';
    inputCategoryPath.value = pathVal;
    
    const urlText = inputUrl.value.trim();
    if (isStreamUrl(urlText) && !urlText.includes('list=')) {
        if (currentSizeText === "Unknown") {
            currentSizeText = "Streaming";
        }
    } else {
        currentSizeText = "Unknown";
    }
    updateSidePanel(category, currentSizeText);
    
    if (!isManualFolder) {
        let currentFile = '';
        if (inputSavePath.value) {
            const parts = inputSavePath.value.split('\\');
            currentFile = parts[parts.length - 1];
        }
        
        if (!currentFile || currentFile === 'download') {
            currentFile = getFilenameFromUrl(urlText) || 'download';
        }
        
        let ext = getFileExtension(currentFile) || getFileExtension(urlText) || '';
        let cleanName = sanitizeFilename(currentFile);
        
        // Strip existing extension
        const dotIdx = cleanName.lastIndexOf('.');
        if (dotIdx !== -1) {
            const currentExt = cleanName.substring(dotIdx + 1).toLowerCase();
            if (['mp3', 'wav', 'mp4', 'mkv', 'zip', 'rar', 'pdf', 'exe', 'html', 'bin', 'watch'].includes(currentExt) || currentExt === ext) {
                cleanName = cleanName.substring(0, dotIdx);
            }
        }
        
        // Determine extension
        if (isStreamUrl(urlText)) {
            ext = category === 'music' ? 'mp3' : 'mp4';
        } else {
            if (!ext) {
                switch(category) {
                    case 'videos': ext = 'mp4'; break;
                    case 'music': ext = 'mp3'; break;
                    case 'compressed': ext = 'zip'; break;
                    case 'documents': ext = 'pdf'; break;
                    case 'programs': ext = 'exe'; break;
                    case 'webpages': ext = 'html'; break;
                    default: ext = 'bin';
                }
            }
        }
        
        if (ext) {
            cleanName += `.${ext}`;
        }
        
        inputSavePath.value = `${pathVal}\\${cleanName}`;
    }
}

// Settings and Customization helpers

function applyThemeAndAccent(theme, accent) {
    document.documentElement.className = `theme-${theme} accent-${accent}`;
}

function populateSettingsUI(settings) {
    appSettings = settings;
    
    // Checkboxes
    document.getElementById('setting-limit-speed').checked = settings.speedLimitEnabled;
    document.getElementById('setting-enable-queue').checked = settings.queueEnabled;
    document.getElementById('setting-enable-scheduler').checked = settings.schedulerEnabled;
    document.getElementById('setting-clipboard-monitor').checked = settings.clipboardMonitorEnabled;
    document.getElementById('setting-post-notification').checked = settings.postShowNotification !== false;
    document.getElementById('setting-post-play-sound').checked = settings.postPlayCompleteSound !== false;
    document.getElementById('setting-post-open-file').checked = !!settings.postOpenCompletedFile;
    
    // Inputs
    document.getElementById('setting-speed-value').value = settings.maxSpeedLimit;
    document.getElementById('setting-concurrent-downloads').value = settings.maxConcurrentDownloads;
    document.getElementById('setting-scheduler-start').value = settings.schedulerStart;
    document.getElementById('setting-scheduler-stop').value = settings.schedulerStop;
    document.getElementById('setting-scheduler-action').value = settings.schedulerAction;
    document.getElementById('setting-select-theme').value = settings.theme;
    document.getElementById('setting-excluded-domains').value = (settings.excludedDomains || []).join(', ');
    
    // Accent swatches active state
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.classList.remove('active');
        if (swatch.getAttribute('data-color') === settings.accentColor) {
            swatch.classList.add('active');
        }
    });

    // Populate Quick Speed Limiter values
    const quickLimitEnable = document.getElementById('quick-limit-enable');
    const quickLimitValue = document.getElementById('quick-limit-value');
    if (quickLimitEnable) quickLimitEnable.checked = settings.speedLimitEnabled;
    if (quickLimitValue) {
        const valueNum = parseInt(settings.maxSpeedLimit, 10);
        const optionExists = Array.from(quickLimitValue.options).some(opt => parseInt(opt.value, 10) === valueNum);
        if (optionExists) {
            quickLimitValue.value = valueNum;
        } else {
            // Remove previous custom option if it exists
            const prevCustom = quickLimitValue.querySelector('option[data-custom="true"]');
            if (prevCustom) prevCustom.remove();
            
            // Add custom option
            const opt = document.createElement('option');
            opt.value = valueNum;
            opt.innerText = valueNum >= 1024 ? `${(valueNum / 1024).toFixed(1)} MB/s` : `${valueNum} KB/s`;
            opt.setAttribute('data-custom', 'true');
            opt.selected = true;
            quickLimitValue.appendChild(opt);
        }
    }
}

async function saveSettingsFromUI() {
    const theme = document.getElementById('setting-select-theme').value;
    const activeSwatch = document.querySelector('.color-swatch.active');
    const accentColor = activeSwatch ? activeSwatch.getAttribute('data-color') : 'blue';
    
    const settingsToSave = {
        speedLimitEnabled: document.getElementById('setting-limit-speed').checked,
        maxSpeedLimit: parseInt(document.getElementById('setting-speed-value').value, 10) || 1024,
        queueEnabled: document.getElementById('setting-enable-queue').checked,
        maxConcurrentDownloads: parseInt(document.getElementById('setting-concurrent-downloads').value, 10) || 2,
        schedulerEnabled: document.getElementById('setting-enable-scheduler').checked,
        schedulerStart: document.getElementById('setting-scheduler-start').value,
        schedulerStop: document.getElementById('setting-scheduler-stop').value,
        schedulerAction: document.getElementById('setting-scheduler-action').value,
        theme,
        accentColor,
        clipboardMonitorEnabled: document.getElementById('setting-clipboard-monitor').checked,
        excludedDomains: document.getElementById('setting-excluded-domains').value
            .split(',')
            .map(d => d.trim())
            .filter(d => d.length > 0),
        postShowNotification: document.getElementById('setting-post-notification').checked,
        postPlayCompleteSound: document.getElementById('setting-post-play-sound').checked,
        postOpenCompletedFile: document.getElementById('setting-post-open-file').checked
    };
    
    try {
        const saved = await window.api.saveSettings(settingsToSave);
        appSettings = saved;
        applyThemeAndAccent(saved.theme, saved.accentColor);
        
        // Show status message
        const statusMsg = document.getElementById('settings-status-msg');
        statusMsg.style.opacity = 1;
        setTimeout(() => {
            statusMsg.style.opacity = 0;
        }, 3000);
    } catch (e) {
        console.error('Failed to save settings:', e);
        alert('Failed to save settings!');
    }
}

// Speed Chart plotting logic
const speedHistory = Array(60).fill(0);
let chartInterval = null;

function initSpeedChart() {
    const canvas = document.getElementById('speed-chart');
    if (!canvas) return;
    
    const resizeCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        drawChart();
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    if (chartInterval) clearInterval(chartInterval);
    
    chartInterval = setInterval(() => {
        const active = downloads.filter(d => d.status === 'downloading' || d.status === 'connecting');
        const currentSpeed = active.reduce((acc, d) => acc + (d.speed || 0), 0);
        
        speedHistory.push(currentSpeed);
        speedHistory.shift();
        
        const speedTextEl = document.getElementById('chart-speed-text');
        if (speedTextEl) {
            speedTextEl.innerText = formatSpeed(currentSpeed);
        }
        
        // Track session analytics
        if (currentSpeed > 0) {
            sessionDownloadedBytes += currentSpeed;
            sessionSpeedSamples.push(currentSpeed);
            if (currentSpeed > sessionPeakSpeed) {
                sessionPeakSpeed = currentSpeed;
            }
        }
        
        // Update Odometer
        const odometerEl = document.getElementById('analytics-speed-odometer');
        const unitEl = document.getElementById('analytics-speed-unit');
        if (odometerEl && unitEl) {
            if (currentSpeed >= 1024 * 1024) {
                odometerEl.innerText = (currentSpeed / (1024 * 1024)).toFixed(1);
                unitEl.innerText = 'MB/s';
            } else {
                odometerEl.innerText = (currentSpeed / 1024).toFixed(1);
                unitEl.innerText = 'KB/s';
            }
        }
        
        // Update statistics cards
        const totalDownloadedEl = document.getElementById('stat-total-downloaded');
        if (totalDownloadedEl) {
            totalDownloadedEl.innerText = formatBytes(sessionDownloadedBytes);
        }
        
        const avgSpeedEl = document.getElementById('stat-avg-speed');
        if (avgSpeedEl) {
            const avgSpeed = sessionSpeedSamples.length > 0 
                ? sessionSpeedSamples.reduce((a, b) => a + b, 0) / sessionSpeedSamples.length 
                : 0;
            avgSpeedEl.innerText = formatSpeed(avgSpeed);
        }
        
        const peakSpeedEl = document.getElementById('stat-peak-speed');
        if (peakSpeedEl) {
            peakSpeedEl.innerText = formatSpeed(sessionPeakSpeed);
        }
        
        const activeThreadsEl = document.getElementById('stat-active-threads');
        if (activeThreadsEl) {
            const activeThreadsCount = active.reduce((acc, d) => acc + (d.status === 'downloading' ? (d.numConnections || 8) : 0), 0);
            activeThreadsEl.innerText = `${activeThreadsCount} threads`;
        }
        
        drawChart();
        drawAnalyticsChart();
    }, 1000);
}

function drawChart() {
    const canvas = document.getElementById('speed-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const maxVal = Math.max(1024 * 1024, ...speedHistory);
    
    const style = getComputedStyle(document.documentElement);
    const accentColor = style.getPropertyValue('--accent-color').trim() || '#3b82f6';
    
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
    strokeGrad.addColorStop(0, accentColor);
    strokeGrad.addColorStop(1, accentColor);
    ctx.strokeStyle = strokeGrad;
    
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, accentColor + '30');
    fillGrad.addColorStop(1, accentColor + '00');
    
    ctx.beginPath();
    
    const len = speedHistory.length;
    const stepX = w / (len - 1);
    
    speedHistory.forEach((val, i) => {
        const x = i * stepX;
        const y = h - (val / maxVal) * (h - 10) - 5;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            const prevX = (i - 1) * stepX;
            const prevY = h - (speedHistory[i - 1] / maxVal) * (h - 10) - 5;
            const cpX1 = prevX + stepX / 2;
            const cpY1 = prevY;
            const cpX2 = prevX + stepX / 2;
            const cpY2 = y;
            ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x, y);
        }
    });
    
    ctx.stroke();
    
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
}

// Session statistics variables
let sessionPeakSpeed = 0;
let sessionDownloadedBytes = 0;
const sessionSpeedSamples = [];

function initAnalyticsChart() {
    const canvas = document.getElementById('analytics-speed-chart');
    if (!canvas) return;
    
    // Globally expose resize method so navigation can call it when shown
    window.resizeAnalyticsCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        drawAnalyticsChart();
    };
    
    window.resizeAnalyticsCanvas();
    window.addEventListener('resize', window.resizeAnalyticsCanvas);
}

function drawAnalyticsChart() {
    const canvas = document.getElementById('analytics-speed-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const numGridLines = 5;
    for (let i = 1; i < numGridLines; i++) {
        const y = (h / numGridLines) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    
    const maxVal = Math.max(1024 * 1024, ...speedHistory);
    const style = getComputedStyle(document.documentElement);
    const accentColor = style.getPropertyValue('--accent-color').trim() || '#3b82f6';
    
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
    strokeGrad.addColorStop(0, accentColor);
    strokeGrad.addColorStop(1, accentColor);
    ctx.strokeStyle = strokeGrad;
    
    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, accentColor + '40');
    fillGrad.addColorStop(1, accentColor + '00');
    
    ctx.beginPath();
    
    const len = speedHistory.length;
    const stepX = w / (len - 1);
    
    speedHistory.forEach((val, i) => {
        const x = i * stepX;
        const y = h - (val / maxVal) * (h - 20) - 10;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            const prevX = (i - 1) * stepX;
            const prevY = h - (speedHistory[i - 1] / maxVal) * (h - 20) - 10;
            const cpX1 = prevX + stepX / 2;
            const cpY1 = prevY;
            const cpX2 = prevX + stepX / 2;
            const cpY2 = y;
            ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, x, y);
        }
    });
    
    ctx.stroke();
    
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
}

// Onboarding Tour Controller
let currentTourStep = 0;
const tourSteps = [
    {
        element: '#btn-add-url',
        title: 'Add New Downloads',
        desc: 'Click here to paste a new download link. Apna Downloader supports direct HTTP/HTTPS downloads, plus YouTube and other streaming links.',
        position: 'bottom',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '#btn-add-category',
        title: 'Custom Categories',
        desc: 'Within the Add URL window, click the "+" button to create a custom category (e.g. "E-Books"). This routes specific extensions to folders of your choice!',
        position: 'bottom',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'block';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '.table-container',
        title: 'Downloads Grid',
        desc: 'Your active, paused, queued, and completed downloads are displayed in this grid. Track file sizes, progress, speeds, and ETA in real time.',
        position: 'top',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '#select-all-downloads',
        title: 'Gmail-style Multi-Select',
        desc: 'Hover over any row to reveal its checkbox, or click the master checkbox in the header. Use the Action Toolbar to pause, resume, or delete selected items in bulk.',
        position: 'bottom',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
        }
    },
    {
        element: '.actions',
        title: 'Action Toolbar',
        desc: 'Pause, resume, or delete your selected downloads. You can also open downloaded files or view them in their folders immediately.',
        position: 'bottom',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '.sidebar',
        title: 'Smart Filters & Categories',
        desc: 'Organize and filter downloads by status (Downloading, Paused, Completed) or file categories (Videos, Music, etc.). Your custom categories appear here too!',
        position: 'right',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
        }
    },
    {
        element: '.speed-chart-wrapper',
        title: 'Real-time Speed Graph',
        desc: 'Watch your combined download speed history dynamically update on this animated spline chart over the last 60 seconds.',
        position: 'right',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
        }
    },
    {
        element: '.quick-limiter-widget',
        title: 'Quick Speed Limiter',
        desc: 'Easily enable or adjust global download speed limits directly from the status bar without opening the Settings panel.',
        position: 'top',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
        }
    },
    {
        element: '#nav-analytics',
        title: 'Speed & Bandwidth Analytics',
        desc: 'Click here to access real-time charts, telemetry meters, data usage counters, and deep network performance stats.',
        position: 'right',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '#nav-settings',
        title: 'Settings Navigation',
        desc: 'Click here to switch to the advanced settings panel to configure premium features like Queue Manager, Speed Limits, Scheduler, and Themes.',
        position: 'right',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'block';
            document.getElementById('settings-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            const navAll = document.querySelector('.nav-item[data-filter="all"]');
            if (navAll) navAll.classList.add('active');
        }
    },
    {
        element: '#card-bandwidth',
        title: 'Global Bandwidth Control',
        desc: 'Enable this to set a maximum download speed limit. The app will throttle segments dynamically and divide speeds equally among active streams.',
        position: 'right',
        beforeShow: () => {
            const addUrlModal = document.getElementById('add-url-modal');
            if (addUrlModal) addUrlModal.style.display = 'none';
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.getElementById('nav-settings').classList.add('active');
        }
    },
    {
        element: '#card-queue',
        title: 'Sequential Queue Manager',
        desc: 'Turn this on to run downloads sequentially instead of starting all at once. Specify max concurrent tasks, and the app manages the queue.',
        position: 'left',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
        }
    },
    {
        element: '#card-scheduler',
        title: 'Download Scheduler',
        desc: 'Set custom Start and Stop times to automate downloads during off-peak hours, and configure automatic pause or app-exit events.',
        position: 'right',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
        }
    },
    {
        element: '#card-clipboard',
        title: 'Clipboard Auto-Grab & Exclusions',
        desc: 'Sniffs copied URLs from your clipboard and prompts you to download. Enter domain whitelists here to exclude specific websites from interception.',
        position: 'left',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
        }
    },
    {
        element: '#card-post-download',
        title: 'Post-Download Actions',
        desc: 'Choose what happens when a download finishes: trigger a native system notification, play a premium synthesizer chime sound, or auto-open the completed file.',
        position: 'left',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
        }
    },
    {
        element: '#card-themes',
        title: 'Custom Themes & Accents',
        desc: 'Personalize the UI! Choose Deep Dark, Glassmorphic Neon, or Clean Light theme, and click any color swatch to apply colorful accent highlights.',
        position: 'right',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
        }
    },
    {
        element: '#btn-reset-settings',
        title: 'Reset to Default Settings',
        desc: 'Want to start fresh? Click this button to restore all settings, custom category paths, speeds, and scheduler rules back to their original default values.',
        position: 'top',
        beforeShow: () => {
            document.querySelector('.table-container').style.display = 'none';
            document.getElementById('analytics-container').style.display = 'none';
            document.getElementById('settings-container').style.display = 'block';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.getElementById('nav-settings').classList.add('active');
        }
    }
];

function startOnboardingTour() {
    currentTourStep = 0;
    const overlay = document.getElementById('tour-overlay');
    if (!overlay) return;
    
    overlay.style.display = 'block';
    showTourStep(0);
}

function showTourStep(stepIdx) {
    if (stepIdx < 0 || stepIdx >= tourSteps.length) return;
    currentTourStep = stepIdx;
    
    const step = tourSteps[stepIdx];
    
    // Centralized modal state toggling
    const addUrlModal = document.getElementById('add-url-modal');
    if (addUrlModal) {
        addUrlModal.style.display = ''; // Clear inline styles
        if (stepIdx === 1) {
            addUrlModal.classList.add('active');
        } else {
            addUrlModal.classList.remove('active');
        }
    }
    
    // Execute panel switches or modal configurations before highlighting elements
    if (typeof step.beforeShow === 'function') {
        step.beforeShow();
    }
    
    let targetEl = document.querySelector(step.element);
    const highlight = document.getElementById('tour-highlight-box');
    const popover = document.getElementById('tour-popover');
    const titleEl = document.getElementById('tour-title');
    const descEl = document.getElementById('tour-desc');
    const stepsIndicator = document.getElementById('tour-steps-indicator');
    const btnBack = document.getElementById('btn-tour-back');
    const btnNext = document.getElementById('btn-tour-next');
    
    if (!targetEl || !highlight || !popover) return;
    
    // Fallback for hidden elements on narrow screens (e.g. collapsed sidebar/speedometer)
    let finalTargetEl = targetEl;
    const targetRect = targetEl.getBoundingClientRect();
    if (targetRect.width === 0 || targetRect.height === 0 || window.getComputedStyle(targetEl).display === 'none') {
        if (step.element === '.speed-chart-wrapper') {
            finalTargetEl = document.getElementById('total-speed') || targetEl;
        } else if (step.element === '#nav-settings') {
            finalTargetEl = document.querySelector('.sidebar') || targetEl;
        }
    }
    
    // Scroll target element into view programmatically
    if (finalTargetEl && typeof finalTargetEl.scrollIntoView === 'function') {
        finalTargetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    
    // Update content
    titleEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${step.title}`;
    descEl.innerText = step.desc;
    stepsIndicator.innerText = `${stepIdx + 1}/${tourSteps.length}`;
    
    // Back button state
    btnBack.disabled = (stepIdx === 0);
    
    // Next/Finish button state
    if (stepIdx === tourSteps.length - 1) {
        btnNext.innerHTML = 'Get Started <i class="fa-solid fa-check"></i>';
    } else {
        btnNext.innerHTML = 'Next <i class="fa-solid fa-angle-right"></i>';
    }
    
    // Spotlight position
    const rect = finalTargetEl.getBoundingClientRect();
    const padding = 6;
    highlight.style.top = `${rect.top - padding}px`;
    highlight.style.left = `${rect.left - padding}px`;
    highlight.style.width = `${rect.width + padding * 2}px`;
    highlight.style.height = `${rect.height + padding * 2}px`;
    
    // Position popover and set arrow data attribute
    popover.setAttribute('data-arrow', step.position);
    
    // Position adjustments
    setTimeout(() => {
        const popoverRect = popover.getBoundingClientRect();
        let popoverTop = 0;
        let popoverLeft = 0;
        
        // Recalculate target position after layout has settled
        const freshRect = finalTargetEl.getBoundingClientRect();
        const highlightTop = freshRect.top - padding;
        const highlightLeft = freshRect.left - padding;
        const highlightWidth = freshRect.width + padding * 2;
        const highlightHeight = freshRect.height + padding * 2;
        
        highlight.style.top = `${highlightTop}px`;
        highlight.style.left = `${highlightLeft}px`;
        highlight.style.width = `${highlightWidth}px`;
        highlight.style.height = `${highlightHeight}px`;
        
        if (step.position === 'bottom') {
            popoverLeft = highlightLeft + (highlightWidth / 2) - (popoverRect.width / 2);
            popoverTop = highlightTop + highlightHeight + 12;
        } else if (step.position === 'top') {
            popoverLeft = highlightLeft + (highlightWidth / 2) - (popoverRect.width / 2);
            popoverTop = highlightTop - popoverRect.height - 12;
        } else if (step.position === 'right') {
            popoverLeft = highlightLeft + highlightWidth + 12;
            popoverTop = highlightTop + (highlightHeight / 2) - (popoverRect.height / 2);
        } else if (step.position === 'left') {
            popoverLeft = highlightLeft - popoverRect.width - 12;
            popoverTop = highlightTop + (highlightHeight / 2) - (popoverRect.height / 2);
        }
        
        // Edge boundaries collision prevention
        if (popoverLeft < 10) popoverLeft = 10;
        if (popoverLeft + popoverRect.width > window.innerWidth - 10) {
            popoverLeft = window.innerWidth - popoverRect.width - 10;
        }
        if (popoverTop < 10) popoverTop = 10;
        if (popoverTop + popoverRect.height > window.innerHeight - 10) {
            popoverTop = window.innerHeight - popoverRect.height - 10;
        }
        
        popover.style.left = `${popoverLeft}px`;
        popover.style.top = `${popoverTop}px`;
    }, 150); // slight delay so popover layout and tab transitions settle
}

async function finishTour() {
    const overlay = document.getElementById('tour-overlay');
    if (overlay) overlay.style.display = 'none';
    
    // Close Add URL modal if open
    const addUrlModal = document.getElementById('add-url-modal');
    if (addUrlModal) {
        addUrlModal.style.display = '';
        addUrlModal.classList.remove('active');
    }
    
    // Restore default downloads list view
    const tableContainer = document.querySelector('.table-container');
    const settingsContainer = document.getElementById('settings-container');
    if (tableContainer && settingsContainer) {
        tableContainer.style.display = 'block';
        settingsContainer.style.display = 'none';
    }
    
    // Reset active navigation item to 'all'
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const navAll = document.querySelector('.nav-item[data-filter="all"]');
    if (navAll) navAll.classList.add('active');
    
    if (appSettings && !appSettings.hasSeenTour) {
        appSettings.hasSeenTour = true;
        try {
            await window.api.saveSettings({ hasSeenTour: true });
        } catch(e) {
            console.error('Failed to save tour seen state:', e);
        }
    }
}

// Optimize memory and CPU when the app window is hidden/minimized
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (chartInterval) {
            clearInterval(chartInterval);
            chartInterval = null;
        }
    } else {
        if (!chartInterval) {
            initSpeedChart();
        }
    }
});

// Synthesize a futuristic electronic chime arpeggio (C5 -> E5 -> G5) using Web Audio API
function playChime() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        
        const ctx = new AudioContextClass();
        const now = ctx.currentTime;
        
        // C5 (523.25Hz), E5 (659.25Hz), G5 (783.99Hz)
        const notes = [523.25, 659.25, 783.99];
        
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.1);
            
            // Soft slide arpeggio fade
            gain.gain.setValueAtTime(0, now + idx * 0.1);
            gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.1 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
            
            osc.start(now + idx * 0.1);
            osc.stop(now + idx * 0.1 + 0.4);
        });
    } catch (e) {
        console.error('Failed to play completion chime:', e);
    }
}

// Bind play completion sound IPC event
if (window.api && window.api.onPlayCompletionSound) {
    window.api.onPlayCompletionSound(() => {
        playChime();
    });
}

// ==================== PROFILE / CUSTOMER PORTAL INTEGRATION ====================

async function loadProfilePortal() {
    if (!window.api || !window.api.getSubscriptionDetails) return;
    
    try {
        const res = await window.api.getSubscriptionDetails();
        if (res && res.success) {
            const profile = res.profile;
            
            // Fill navbar indicator and header email
            const topEmail = document.getElementById("top-profile-email");
            const mainEmail = document.getElementById("profile-user-email");
            if (topEmail) topEmail.innerText = profile.email;
            if (mainEmail) mainEmail.innerText = profile.email;
            
            const displayName = document.getElementById("profile-display-name");
            if (displayName) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                displayName.innerHTML = `<i class="fa-solid fa-circle-user"></i> ${fullName || 'Customer Profile'}`;
            }
            
            // Render license details
            const planType = document.getElementById("profile-plan-type");
            if (planType) {
                planType.innerText = profile.plan_type.toUpperCase();
                planType.className = `badge ${profile.plan_type === 'trial' ? 'warning' : 'success'}`;
            }
            
            const status = document.getElementById("profile-status");
            if (status) {
                status.innerText = profile.status.toUpperCase();
                status.className = `badge ${profile.status === 'active' ? 'success' : 'danger'}`;
                // Set inline CSS styles override to match badge colors exactly
                status.style.backgroundColor = profile.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                status.style.color = profile.status === 'active' ? 'var(--success-color)' : 'var(--danger-color)';
            }
            
            let devices = [];
            try { devices = JSON.parse(profile.active_devices || "[]"); } catch(e) {}
            
            const slotsCount = document.getElementById("profile-slots-count");
            if (slotsCount) {
                slotsCount.innerText = `${devices.length} / ${profile.pc_slots} Slots`;
            }
            
            const expiry = document.getElementById("profile-expiry");
            if (expiry) {
                if (profile.plan_type === 'trial' && profile.trial_end) {
                    const expiryDate = new Date(profile.trial_end);
                    expiry.innerText = expiryDate.toLocaleDateString();
                } else if (profile.plan_type !== 'trial') {
                    expiry.innerText = "Lifetime Plan / Active";
                } else {
                    expiry.innerText = "Not Activated (Free Trial Available)";
                }
            }

            const btnBuy = document.getElementById("btn-profile-buy");
            const btnActivate = document.getElementById("btn-profile-activate");
            if (profile.plan_type === 'trial' && !profile.trial_end) {
                if (btnBuy) btnBuy.style.display = "none";
                if (btnActivate) btnActivate.style.display = "flex";
            } else {
                if (btnBuy) btnBuy.style.display = "flex";
                if (btnActivate) btnActivate.style.display = "none";
            }

            // Fill current local device id
            const localDevice = document.getElementById("profile-current-device");
            if (localDevice) {
                localDevice.innerText = res.currentDeviceId || "-";
            }
            
            // Render devices table list
            const list = document.getElementById("profile-devices-list");
            if (list) {
                list.innerHTML = "";
                if (devices.length === 0) {
                    list.innerHTML = `<tr><td colspan="2" style="text-align: center; padding: 15px; color: var(--text-muted);">No active hardware IDs bound. Start downloading to bind your device.</td></tr>`;
                } else {
                    devices.forEach((devId, idx) => {
                        const isCurrent = devId === res.currentDeviceId;
                        const currentBadge = isCurrent ? ' <span style="color: var(--success-color); font-weight: bold; font-size: 10px; background: rgba(16,185,129,0.12); padding: 2px 6px; border-radius: 10px; margin-left: 5px; border: 1px solid rgba(16,185,129,0.2);">This PC</span>' : '';
                        const row = document.createElement("tr");
                        row.innerHTML = `
                            <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${idx + 1}</td>
                            <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-family: monospace; color: var(--accent-color);">${devId}${currentBadge}</td>
                        `;
                        list.appendChild(row);
                    });
                }
            }
        }
    } catch (e) {
        console.error("Failed to load profile details inside app:", e);
    }
}

function showProfilePage() {
    // Remove active styles from sidebar categories
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    const tableContainer = document.querySelector('.table-container');
    const settingsContainer = document.getElementById('settings-container');
    const analyticsContainer = document.getElementById('analytics-container');
    const profileContainer = document.getElementById('profile-container');
    
    if (tableContainer) tableContainer.style.display = 'none';
    if (settingsContainer) settingsContainer.style.display = 'none';
    if (analyticsContainer) analyticsContainer.style.display = 'none';
    if (profileContainer) {
        profileContainer.style.display = 'block';
    }
    
    loadProfilePortal();
}

// Bind click listener to toolbar profile widget
const topProfileWidget = document.getElementById("top-profile-widget");
if (topProfileWidget) {
    topProfileWidget.addEventListener('click', () => {
        showProfilePage();
    });
}

// Bind buy button inside profile container
const btnProfileBuy = document.getElementById("btn-profile-buy");
if (btnProfileBuy) {
    btnProfileBuy.addEventListener('click', () => {
        if (window.api && window.api.openExternal) {
            window.api.openExternal('https://apna-downloader.pages.dev/');
        }
    });
}

// Bind activate trial button inside profile container
const btnProfileActivate = document.getElementById("btn-profile-activate");
if (btnProfileActivate) {
    btnProfileActivate.addEventListener('click', async () => {
        btnProfileActivate.disabled = true;
        const res = await window.api.activateFreeTrial();
        btnProfileActivate.disabled = false;
        if (res && res.success) {
            alert("Your 15-day free trial has been activated successfully!");
            loadProfilePortal();
        } else {
            alert(res.error || "Failed to activate free trial.");
        }
    });
}

// Bind logout button inside profile container
const btnProfileLogout = document.getElementById("btn-profile-logout");
if (btnProfileLogout) {
    btnProfileLogout.addEventListener('click', async () => {
        if (confirm('Are you sure you want to log out of Apna Downloader?')) {
            await window.api.logoutUser();
        }
    });
}

// Pre-load navbar email at startup
window.addEventListener('DOMContentLoaded', () => {
    loadProfilePortal();
});




