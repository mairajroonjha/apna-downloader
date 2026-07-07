(async () => {
    const params = new URLSearchParams(window.location.search);
    const grabUrl = params.get('url') || '';
    const grabFilename = params.get('filename') || '';
    const grabQuality = params.get('quality') || '';
    const grabReferer = params.get('referer') || '';
    const grabUserAgent = params.get('userAgent') || '';
    const grabEngine = params.get('engine') || '';

    // Elements
    const inputUrl = document.getElementById('input-url');
    const selectCategory = document.getElementById('select-category');
    const inputSavePath = document.getElementById('input-save-path');
    const btnBrowseFolder = document.getElementById('btn-browse-folder');
    const chkRememberPath = document.getElementById('chk-remember-path');
    const lblCategoryName = document.getElementById('lbl-category-name');
    const inputCategoryPath = document.getElementById('input-category-path');
    const inputDescription = document.getElementById('input-description');
    const connectionsCount = document.getElementById('connections-count');
    const ytSubtitlesGroup = document.getElementById('yt-subtitles-group');
    const chkDownloadSubtitles = document.getElementById('chk-download-subtitles');
    const sideFileIcon = document.getElementById('side-file-icon');
    const sideFileSize = document.getElementById('side-file-size');
    const btnAddLater = document.getElementById('btn-add-later');
    const btnAddStart = document.getElementById('btn-add-start');
    const btnAddCancel = document.getElementById('btn-add-cancel');

    // State Variables
    let appSettings = {};
    let defaultCategoryPaths = {};
    let currentSizeText = 'Unknown';
    let cleanFilename = '';
    let isStream = false;

    // Load configurations
    try {
        appSettings = await window.api.getSettings();
        defaultCategoryPaths = await window.api.getDefaultDownloadDirs();
        
        // Apply theme/accent
        document.body.className = `theme-${appSettings.theme || 'light'}`;
        document.body.setAttribute('data-accent', appSettings.accentColor || 'blue');
        
        // Load custom categories into dropdown
        if (appSettings.customCategories && appSettings.customCategories.length > 0) {
            appSettings.customCategories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.innerText = cat.name;
                selectCategory.appendChild(opt);
            });
        }
        
        // Set default connections
        if (appSettings.defaultConnections) {
            connectionsCount.value = appSettings.defaultConnections.toString();
        }
    } catch (e) {
        console.error('Failed to load info configuration:', e);
    }

    // Populate URL
    inputUrl.value = grabUrl;

    // Stream state
    isStream = isStreamUrl(grabUrl);
    if (isStream) {
        ytSubtitlesGroup.style.display = 'block';
    }

    // Parse Filename and Extension
    let filename = grabFilename || 'download';
    let ext = getFileExtension(filename);
    if (grabUrl.startsWith('data:')) {
        const matches = grabUrl.match(/^data:([^;]+);/);
        if (matches && !ext) {
            ext = getExtensionFromMimeType(matches[1]);
        }
        if (filename === 'download' && ext) {
            filename = 'download.' + ext;
        }
    } else {
        if (!ext) ext = getFileExtension(grabUrl);
    }
    
    if (isStream && !ext) {
        ext = grabQuality === 'audio' ? 'mp3' : 'mp4';
    }

    cleanFilename = sanitizeFilename(filename);
    if (ext && !cleanFilename.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
        cleanFilename += `.${ext}`;
    }

    // Detect Initial Category
    const initialCategory = detectCategory(cleanFilename);
    selectCategory.value = initialCategory;

    // Update path displays
    updateCategoryUI(initialCategory);

    // Initial Path Calculation
    const targetDir = defaultCategoryPaths[initialCategory] || defaultCategoryPaths.other || '';
    inputSavePath.value = targetDir ? `${targetDir}\\${cleanFilename}` : cleanFilename;

    // Duplicate Check
    try {
        const downloads = await window.api.getDownloads();
        const duplicateByUrl = downloads.find(d => d.url === grabUrl);
        if (duplicateByUrl) {
            const proceed = confirm(`Duplicate Download Warning:\n\n"${duplicateByUrl.filename}" is already in your download list (Status: ${duplicateByUrl.status}).\n\nDo you want to download it again?`);
            if (!proceed) {
                window.close();
                return;
            }
        } else {
            const duplicateByName = downloads.find(d => d.filename === cleanFilename && d.category === initialCategory);
            if (duplicateByName) {
                const proceed = confirm(`File Name Conflict:\n\nA file named "${cleanFilename}" is already in your download list.\n\nDo you want to add it anyway?`);
                if (!proceed) {
                    window.close();
                    return;
                }
            }
        }
    } catch(e) {
        console.error('Failed to run duplicate check:', e);
    }

    validateForm();
    checkAndFetchMediaSize(grabUrl);

    // Event Handlers
    selectCategory.addEventListener('change', () => {
        const cat = selectCategory.value;
        updateCategoryUI(cat);
        
        // Re-calculate target save path
        const dir = defaultCategoryPaths[cat] || defaultCategoryPaths.other || '';
        inputSavePath.value = dir ? `${dir}\\${cleanFilename}` : cleanFilename;
        updateSidePanel(cat, currentSizeText);
        validateForm();
    });

    btnBrowseFolder.addEventListener('click', async () => {
        try {
            const dir = await window.api.selectFolder();
            if (dir) {
                inputSavePath.value = `${dir}\\${cleanFilename}`;
                validateForm();
            }
        } catch (e) {
            console.error('Failed to browse folder:', e);
        }
    });

    btnAddCancel.addEventListener('click', () => {
        window.close();
    });

    btnAddLater.addEventListener('click', () => submitDownload(true));
    btnAddStart.addEventListener('click', () => submitDownload(false));

    // Form submission helper
    async function submitDownload(downloadLater) {
        const savePath = inputSavePath.value.trim();
        if (!savePath) return;

        // Remember Category path if checked
        if (chkRememberPath.checked) {
            const cat = selectCategory.value;
            const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
            const dir = lastSlash > -1 ? savePath.substring(0, lastSlash) : '';
            if (dir && defaultCategoryPaths[cat] !== dir) {
                try {
                    // Update main settings
                    const currentSettings = await window.api.getSettings();
                    const updatedCategories = currentSettings.customCategories || [];
                    
                    // Save dynamically
                    defaultCategoryPaths[cat] = dir;
                    await window.api.saveSettings({
                        customCategoryPaths: defaultCategoryPaths
                    });
                } catch(e) {
                    console.error('Failed to save category path settings:', e);
                }
            }
        }

        const threads = parseInt(connectionsCount.value, 10) || 8;
        const sub = chkDownloadSubtitles.checked;

        try {
            btnAddStart.disabled = true;
            btnAddLater.disabled = true;
            
            await window.api.addDownload(
                grabUrl,
                savePath,
                threads,
                grabQuality,
                downloadLater,
                grabReferer,
                grabUserAgent,
                grabEngine,
                false, // silent
                sub
            );
            
            window.close();
        } catch (e) {
            alert(`Failed to add download: ${e.message}`);
            btnAddStart.disabled = false;
            btnAddLater.disabled = false;
        }
    }

    // Helper Functions
    function validateForm() {
        const valid = !!inputSavePath.value.trim();
        btnAddStart.disabled = !valid;
        btnAddLater.disabled = !valid;
    }

    function updateCategoryUI(category) {
        lblCategoryName.innerText = category;
        const dir = defaultCategoryPaths[category] || defaultCategoryPaths.other || 'Not Set';
        inputCategoryPath.value = dir;
        updateSidePanel(category, currentSizeText);
    }

    function updateSidePanel(category, sizeText) {
        sideFileSize.innerText = sizeText;
        
        // Remove existing icon classes
        sideFileIcon.className = 'fa-solid';
        
        // Match icon based on category
        switch(category) {
            case 'videos': sideFileIcon.classList.add('fa-file-video'); break;
            case 'music': sideFileIcon.classList.add('fa-file-audio'); break;
            case 'compressed': sideFileIcon.classList.add('fa-file-zipper'); break;
            case 'documents': sideFileIcon.classList.add('fa-file-pdf'); break;
            case 'programs': sideFileIcon.classList.add('fa-file-code'); break;
            case 'webpages': sideFileIcon.classList.add('fa-file-lines'); break;
            default: sideFileIcon.classList.add('fa-file');
        }
    }

    async function checkAndFetchMediaSize(url) {
        currentSizeText = "Loading...";
        updateSidePanel(selectCategory.value, currentSizeText);
        
        try {
            const res = await window.api.fetchMediaSize(url, grabQuality);
            if (res && res.success && res.size > 0) {
                currentSizeText = formatBytes(res.size);
                updateSidePanel(selectCategory.value, currentSizeText);
                
                // If title was fetched, update save path filename
                if (res.title) {
                    const ext = grabQuality === 'audio' ? 'mp3' : 'mp4';
                    const newCleanName = sanitizeFilename(res.title) + '.' + ext;
                    
                    const savePathVal = inputSavePath.value;
                    const lastSlash = Math.max(savePathVal.lastIndexOf('\\'), savePathVal.lastIndexOf('/'));
                    const dir = lastSlash > -1 ? savePathVal.substring(0, lastSlash) : '';
                    
                    cleanFilename = newCleanName;
                    inputSavePath.value = dir ? `${dir}\\${newCleanName}` : newCleanName;
                }
            } else {
                currentSizeText = isStream ? "Streaming" : "Unknown";
                updateSidePanel(selectCategory.value, currentSizeText);
            }
        } catch (e) {
            currentSizeText = isStream ? "Streaming" : "Unknown";
            updateSidePanel(selectCategory.value, currentSizeText);
        }
    }

    // Common Utilities
    function isStreamUrl(url) {
        if (!url) return false;
        return url.includes('youtube.com/') || url.includes('youtu.be/') || url.includes('vimeo.com/') || url.includes('soundcloud.com/');
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
            const ext = parts.pop().toLowerCase();
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

    function detectCategory(filename) {
        if (!filename) return 'other';
        const ext = filename.split('.').pop().toLowerCase();
        
        // Check custom categories
        if (appSettings && appSettings.customCategories) {
            for (const cat of appSettings.customCategories) {
                if (cat.extensions && cat.extensions.includes(ext)) {
                    return cat.id;
                }
            }
        }
        
        if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'ts'].includes(ext)) return 'videos';
        if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext)) return 'music';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'compressed';
        if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'].includes(ext)) return 'documents';
        if (['exe', 'msi', 'apk', 'bat', 'sh'].includes(ext)) return 'programs';
        if (['html', 'htm', 'php', 'asp'].includes(ext)) return 'webpages';
        return 'other';
    }

    function formatBytes(bytes, decimals = 2) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function getExtensionFromMimeType(mimeType) {
        const mapping = {
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/x-matroska': 'mkv',
            'audio/mpeg': 'mp3',
            'audio/mp3': 'mp3',
            'audio/ogg': 'ogg',
            'audio/wav': 'wav',
            'application/zip': 'zip',
            'application/x-rar-compressed': 'rar',
            'application/pdf': 'pdf',
            'text/html': 'html',
            'application/octet-stream': 'bin'
        };
        return mapping[mimeType] || '';
    }
})();
