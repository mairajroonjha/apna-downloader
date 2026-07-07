(function() {
    let activeMedia = null;
    let activeFileUrl = null;
    let buttonHideTimeout = null;
    let grabButton = null;
    let grabDropdown = null;
    let grabberDisabledOnPage = false;
    let temporarilyIgnoredElement = null;

    // Create the floating grab button and its dropdown menu
    function createGrabberElements() {
        if (grabButton) return;

        // 1. Create split button layout
        grabButton = document.createElement('div');
        grabButton.id = 'apna-grabber-btn';
        grabButton.className = 'apna-grabber-hidden';
        grabButton.innerHTML = `
            <div class="apna-btn-main">
                <img src="${chrome.runtime.getURL('icon16.png')}" width="16" height="16" style="margin-right: 4px; vertical-align: middle; pointer-events: none;" />
                <span>Download this video</span>
            </div>
            <div class="apna-btn-arrow" title="Select Video Quality">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                    <path d="M7 10l5 5 5-5z"/>
                </svg>
            </div>
            <div class="apna-btn-help" title="Apna Downloader Help">
                <span>?</span>
            </div>
            <div class="apna-btn-close" title="Close Panel">
                <span>&times;</span>
            </div>
        `;
        document.body.appendChild(grabButton);

        // 2. Create dropdown menu container
        grabDropdown = document.createElement('div');
        grabDropdown.id = 'apna-grabber-dropdown';
        grabDropdown.className = 'apna-dropdown-hidden';
        document.body.appendChild(grabDropdown);

        // Hover management to prevent button from flickering/hiding
        const onEnter = () => {
            if (buttonHideTimeout) {
                clearTimeout(buttonHideTimeout);
                buttonHideTimeout = null;
            }
        };

        grabButton.addEventListener('mouseenter', onEnter);
        grabDropdown.addEventListener('mouseenter', onEnter);

        grabButton.addEventListener('mouseleave', () => startHideTimeout());
        grabDropdown.addEventListener('mouseleave', () => startHideTimeout());

        // Split click event handlers
        const btnMain = grabButton.querySelector('.apna-btn-main');
        const btnArrow = grabButton.querySelector('.apna-btn-arrow');

        btnMain.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerDefaultDownload();
        });

        btnArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        const btnHelp = grabButton.querySelector('.apna-btn-help');
        const btnClose = grabButton.querySelector('.apna-btn-close');

        btnHelp.addEventListener('click', (e) => {
            e.stopPropagation();
            alert("Apna Downloader Video Grabber\n\nClick the main button to download this video, or click the arrow button to select a specific quality (e.g. 4K, 1080p).\n\nMake sure the Apna Downloader desktop app is running.");
        });

        btnClose.addEventListener('click', (e) => {
            e.stopPropagation();
            temporarilyIgnoredElement = activeMedia || activeFileUrl || null;
            hideButton();
        });

        // Close dropdown when clicking anywhere else
        document.addEventListener('click', () => {
            hideDropdown();
        });
    }

    function triggerDefaultDownload() {
        const mediaUrl = activeMedia ? getMediaUrl(activeMedia) : null;
        const isBlobUrl = mediaUrl && mediaUrl.startsWith('blob:');
        const isStreaming = isStreamingDomain() || isBlobUrl;
        
        if (isStreaming) {
            triggerDownload('1080p');
        } else {
            triggerDownload('direct');
        }
    }

    function toggleDropdown() {
        if (!grabDropdown) return;
        
        if (grabDropdown.classList.contains('apna-dropdown-visible')) {
            hideDropdown();
        } else {
            populateDropdownOptions();
            
            // Position dropdown right below the button
            const btnRect = grabButton.getBoundingClientRect();
            const top = btnRect.bottom + window.scrollY + 4;
            const left = btnRect.left + window.scrollX;

            grabDropdown.style.top = `${top}px`;
            grabDropdown.style.left = `${left}px`;
            grabDropdown.className = 'apna-dropdown-visible';
        }
    }

    function hideDropdown() {
        if (grabDropdown) {
            grabDropdown.className = 'apna-dropdown-hidden';
        }
    }

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function populateDropdownOptions() {
        if (!grabDropdown) return;

        let optionsHtml = '';

        if (activeMedia) {
            const isImg = activeMedia.tagName === 'IMG';
            const isStreamingSite = !isImg && isStreamingDomain();
            const mediaUrl = getMediaUrl(activeMedia);

            if (isStreamingSite) {
                // Render loading indicator first
                grabDropdown.innerHTML = `
                    <div class="apna-dropdown-loading" style="padding: 10px 15px; text-align: center; color: #64748b; font-size: 11px; font-weight: 600; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: default;">
                        <span style="font-size: 14px;">⌛</span> Loading quality options...
                    </div>
                `;

                // Fetch available resolutions and sizes from desktop app
                chrome.runtime.sendMessage({ action: 'get-video-info', url: window.location.href }, (response) => {
                    // Check if dropdown is still open
                    if (!grabDropdown.classList.contains('apna-dropdown-visible')) return;

                    if (response && response.success && response.options && response.options.length > 0) {
                        let dynamicHtml = '';
                        response.options.forEach((opt, idx) => {
                            if (opt.quality === 'audio' && idx > 0 && response.options[idx - 1].quality !== 'audio') {
                                dynamicHtml += `<div class="apna-dropdown-divider"></div>`;
                            }
                            const sizeStr = opt.size ? ` (${formatBytes(opt.size)})` : '';
                            dynamicHtml += `
                                <div class="apna-dropdown-item" data-quality="${opt.quality}">
                                    <span class="option-icon">${opt.icon}</span> ${opt.label}${sizeStr}
                                </div>
                            `;
                        });
                        grabDropdown.innerHTML = dynamicHtml;
                    } else {
                        // Fallback to hardcoded list if native helper fails (e.g. desktop app not running)
                        console.warn('[Apna Downloader] Falling back to default list because video info fetch failed:', response ? response.error : 'No response');
                        grabDropdown.innerHTML = `
                            <div class="apna-dropdown-item" data-quality="2160p">
                                <span class="option-icon">💎</span> MKV Video - 2160p 4K
                            </div>
                            <div class="apna-dropdown-item" data-quality="1440p">
                                <span class="option-icon">🌟</span> MKV Video - 1440p 2K
                            </div>
                            <div class="apna-dropdown-item" data-quality="1080p">
                                <span class="option-icon">🎬</span> MP4 Video - 1080p HD
                            </div>
                            <div class="apna-dropdown-item" data-quality="720p">
                                <span class="option-icon">⚡</span> MP4 Video - 720p HD
                            </div>
                            <div class="apna-dropdown-item" data-quality="480p">
                                <span class="option-icon">📀</span> MP4 Video - 480p
                            </div>
                            <div class="apna-dropdown-item" data-quality="360p">
                                <span class="option-icon">📱</span> MP4 Video - 360p
                            </div>
                            <div class="apna-dropdown-item" data-quality="240p">
                                <span class="option-icon">🎞️</span> MP4 Video - 240p
                            </div>
                            <div class="apna-dropdown-item" data-quality="144p">
                                <span class="option-icon">🎦</span> MP4 Video - 144p
                            </div>
                            <div class="apna-dropdown-divider"></div>
                            <div class="apna-dropdown-item" data-quality="audio">
                                <span class="option-icon">🎵</span> MP3 Audio - High Quality
                            </div>
                            <div class="apna-dropdown-divider"></div>
                            <div class="apna-dropdown-item" data-quality="subtitles">
                                <span class="option-icon">📝</span> SRT Subtitles Only (English/Urdu/Hindi)
                            </div>
                        `;
                    }

                    // Attach click listeners to options
                    attachItemListeners();
                });
                return;
            } else {
                // Direct file download
                const label = isImg ? 'Download Image' : 'Download Video';
                optionsHtml = `
                    <div class="apna-dropdown-item" data-quality="direct" data-url="${mediaUrl}">
                        <span class="option-icon">📥</span> ${label} (Direct Link)
                    </div>
                `;
            }
        } else if (activeFileUrl) {
            optionsHtml = `
                <div class="apna-dropdown-item" data-quality="direct" data-url="${activeFileUrl}">
                    <span class="option-icon">📥</span> Download File (Direct Link)
                </div>
            `;
        }

        grabDropdown.innerHTML = optionsHtml;
        attachItemListeners();
    }

    function attachItemListeners() {
        if (!grabDropdown) return;
        grabDropdown.querySelectorAll('.apna-dropdown-item').forEach(item => {
            const newItem = item.cloneNode(true);
            item.parentNode.replaceChild(newItem, item);
            newItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const quality = newItem.getAttribute('data-quality');
                const customUrl = newItem.getAttribute('data-url');
                triggerDownload(quality, customUrl);
            });
        });
    }

    function triggerDownload(quality, customUrl) {
        const mediaUrl = activeMedia ? getMediaUrl(activeMedia) : null;
        const isImg = activeMedia && activeMedia.tagName === 'IMG';
        const isBlobUrl = mediaUrl && mediaUrl.startsWith('blob:');
        const isStreaming = !isImg && (isStreamingDomain() || isBlobUrl);
        
        const targetUrl = isStreaming ? window.location.href : (customUrl || mediaUrl || activeFileUrl);
        const engine = isStreaming ? 'ytdlp' : 'basic';
        
        if (!targetUrl) return;

        let pageTitle = document.title || 'download';
        if (customUrl || activeFileUrl) {
            pageTitle = getFilenameFromUrl(customUrl || activeFileUrl) || pageTitle;
        }
        
        // Clean title for safe Windows filename
        pageTitle = pageTitle.replace(/[\\/:*?"<>|]/g, '_').substring(0, 60).trim();

        const sendGrabPayload = (urlToSend) => {
            chrome.runtime.sendMessage({
                action: 'grab',
                payload: {
                    url: urlToSend,
                    filename: pageTitle,
                    quality: quality,
                    referer: window.location.href,
                    userAgent: navigator.userAgent,
                    engine: engine
                }
            }, (response) => {
                if (response && response.status === 'ok') {
                    console.log('Download triggered successfully:', response);
                    hideDropdown();
                    hideButton();
                } else {
                    const errDetail = response && response.error ? `\n(Error: ${response.error})` : '';
                    alert('Apna Downloader desktop app is not running! Please open it to start the download.' + errDetail);
                }
            });
        };

        if (targetUrl.startsWith('blob:')) {
            // Fetch blob and convert to data URL inside browser context
            fetch(targetUrl)
                .then(r => r.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        sendGrabPayload(reader.result);
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(err => {
                    console.error('Failed to resolve blob URL:', err);
                    sendGrabPayload(targetUrl); // fallback
                });
        } else {
            sendGrabPayload(targetUrl);
        }
    }

    function isStreamingDomain() {
        const host = window.location.hostname.toLowerCase();
        return (
            host.includes('youtube.com') ||
            host.includes('youtu.be') ||
            host.includes('vimeo.com') ||
            host.includes('facebook.com') ||
            host.includes('fb.watch') ||
            host.includes('twitter.com') ||
            host.includes('x.com') ||
            host.includes('instagram.com') ||
            host.includes('tiktok.com')
        );
    }

    function getMediaUrl(element) {
        if (element.src) return element.src;
        const sources = element.getElementsByTagName('source');
        if (sources.length > 0) return sources[0].src;
        return null;
    }

    function applyThemeToGrabber() {
        chrome.runtime.sendMessage({ action: 'get-settings' }, (settings) => {
            if (settings && !settings.error && grabButton && grabDropdown) {
                const themeClass = 'theme-' + (settings.theme || 'dark');
                const accent = settings.accentColor || 'blue';
                
                // Clear old theme classes
                grabButton.classList.remove('theme-dark', 'theme-light', 'theme-glass');
                grabDropdown.classList.remove('theme-dark', 'theme-light', 'theme-glass');
                
                grabButton.classList.add(themeClass);
                grabDropdown.classList.add(themeClass);
                
                const accentColors = {
                    blue: '#3b82f6',
                    purple: '#a855f7',
                    green: '#10b981',
                    red: '#ef4444',
                    gold: '#f59e0b',
                    pink: '#ec4899'
                };
                const hex = accentColors[accent];
                if (hex) {
                    grabButton.style.setProperty('--accent-color', hex);
                    grabDropdown.style.setProperty('--accent-color', hex);
                }
            }
        });
    }

    function positionButton(element) {
        if (!grabButton) return;
        const rect = element.getBoundingClientRect();
        
        const top = rect.top + window.scrollY + 12;
        const left = rect.right + window.scrollX - grabButton.offsetWidth - 12;

        grabButton.style.top = `${top}px`;
        grabButton.style.left = `${left}px`;
        
        grabButton.classList.remove('apna-grabber-hidden');
        grabButton.classList.add('apna-grabber-visible');
        
        applyThemeToGrabber();
    }

    function hideButton() {
        if (grabButton) {
            grabButton.className = 'apna-grabber-hidden';
            hideDropdown();
        }
    }

    function startHideTimeout() {
        if (buttonHideTimeout) clearTimeout(buttonHideTimeout);
        buttonHideTimeout = setTimeout(() => {
            // Only hide button if dropdown is not currently open
            if (grabDropdown && !grabDropdown.classList.contains('apna-dropdown-visible')) {
                hideButton();
            }
        }, 800);
    }

    function isDownloadableLink(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            const pathname = parsed.pathname;
            const ext = pathname.substring(pathname.lastIndexOf('.') + 1).toLowerCase();
            const commonFileExtensions = [
                'zip', 'rar', '7z', 'tar', 'gz', 
                'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma',
                'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv',
                'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub',
                'exe', 'msi', 'apk', 'dmg', 'bat',
                'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',
                'html', 'htm'
            ];
            return commonFileExtensions.includes(ext);
        } catch (e) {
            return false;
        }
    }

    function getFilenameFromUrl(urlText) {
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

    function observeMediaElements() {
        const observer = new MutationObserver(() => {
            scanAndBindMedia();
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        scanAndBindMedia();
    }

    function scanAndBindMedia() {
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
            if (!media.dataset.apnaObserved) {
                media.dataset.apnaObserved = 'true';
                
                // Direct hover on the media element itself
                setupMediaHover(media);
                
                // Bubble hover check up to 3 parent layers (capturing custom controllers / transparent overlays)
                let parent = media.parentElement;
                let level = 0;
                while (parent && level < 3) {
                    if (!parent.dataset.apnaObservedParent) {
                        parent.dataset.apnaObservedParent = 'true';
                        setupParentHover(parent, media);
                    }
                    parent = parent.parentElement;
                    level++;
                }
            }
        });
    }

    function setupMediaHover(media) {
        media.addEventListener('mouseenter', () => triggerGrabberFor(media));
        media.addEventListener('mouseleave', () => startHideTimeout());
    }

    function setupParentHover(parent, media) {
        parent.addEventListener('mouseenter', () => triggerGrabberFor(media));
        parent.addEventListener('mouseleave', () => startHideTimeout());
    }

    function triggerGrabberFor(media) {
        if (grabberDisabledOnPage) return;
        if (buttonHideTimeout) {
            clearTimeout(buttonHideTimeout);
            buttonHideTimeout = null;
        }
        
        const hasSource = getMediaUrl(media);
        const isStream = isStreamingDomain();
        if (hasSource || isStream) {
            activeMedia = media;
            activeFileUrl = null;
            
            createGrabberElements();
            
            const textSpan = grabButton.querySelector('span');
            if (textSpan) {
                textSpan.innerText = 'Download this video';
            }
            
            positionButton(media);
        }
    }

    function attachListeners() {
        document.body.addEventListener('mousemove', (e) => {
            const x = e.clientX;
            const y = e.clientY;
            
            // If the mouse is over the button or dropdown, ignore and keep visible
            if (e.target === grabButton || grabButton?.contains(e.target) ||
                e.target === grabDropdown || grabDropdown?.contains(e.target)) {
                if (buttonHideTimeout) {
                    clearTimeout(buttonHideTimeout);
                    buttonHideTimeout = null;
                }
                return;
            }

            // Find elements under cursor (to traverse overlays and transparent layers)
            const elements = document.elementsFromPoint(x, y);
            const mediaElement = elements.find(el => el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
            const imgElement = elements.find(el => el.tagName === 'IMG');
            const linkElement = elements.find(el => el.tagName === 'A');

            let targetElement = null;
            let downloadType = null;
            let fileUrl = null;

            if (mediaElement) {
                const hasSource = getMediaUrl(mediaElement);
                const isStream = isStreamingDomain();
                if (hasSource || isStream) {
                    targetElement = mediaElement;
                    downloadType = 'media';
                }
            } else if (imgElement && imgElement.width > 120 && imgElement.height > 120) {
                targetElement = imgElement;
                downloadType = 'image';
                fileUrl = imgElement.src;
            } else if (linkElement && isDownloadableLink(linkElement.href)) {
                targetElement = linkElement;
                downloadType = 'file';
                fileUrl = linkElement.href;
            }

            if (targetElement) {
                if (temporarilyIgnoredElement === targetElement || temporarilyIgnoredElement === fileUrl) {
                    return; // Keep hidden while still hovering the same element
                }

                if (buttonHideTimeout) {
                    clearTimeout(buttonHideTimeout);
                    buttonHideTimeout = null;
                }
                activeMedia = (downloadType === 'media' || downloadType === 'image') ? targetElement : null;
                activeFileUrl = fileUrl;
                
                createGrabberElements();
                
                // Update button text dynamically
                const textSpan = grabButton.querySelector('span');
                if (textSpan) {
                    if (downloadType === 'media') {
                        textSpan.innerText = 'Download this video';
                    } else if (downloadType === 'image') {
                        textSpan.innerText = 'Download this image';
                    } else {
                        textSpan.innerText = 'Download this file';
                    }
                }
                
                positionButton(targetElement);
            } else {
                temporarilyIgnoredElement = null;
                startHideTimeout();
            }
        });

        // Start DOM observer for media elements
        observeMediaElements();
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

    function init() {
        chrome.runtime.sendMessage({ action: 'get-settings' }, (response) => {
            if (response && !response.error) {
                const settings = response;
                const excluded = settings.excludedDomains || [];
                if (isDomainExcluded(window.location.hostname, excluded)) {
                    console.log('[Apna Downloader] Domain is excluded. Grabber disabled.');
                    return;
                }
                attachListeners();
            } else {
                console.log('[Apna Downloader] Failed to fetch settings via background runtime message, running with default grabber');
                attachListeners();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.action === "resolveBlob" && message.url) {
            fetch(message.url)
                .then(r => r.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        sendResponse({ dataUrl: reader.result });
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(err => {
                    console.error('Failed to resolve blob URL:', err);
                    sendResponse({ error: err.message });
                });
            return true; // Keep message channel open for async response
        }
        
        if (message && message.action === "downloadAllLinks") {
            showDownloadAllLinksDialog();
        }
    });

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showDownloadAllLinksDialog() {
        const linkElements = Array.from(document.querySelectorAll('a'));
        const links = linkElements
            .map(a => {
                let href = '';
                try { href = new URL(a.href, window.location.href).toString(); } catch(e) { return null; }
                if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
                    return null;
                }
                const text = a.innerText.trim() || a.title.trim() || getFilenameFromUrl(href) || 'Unnamed Link';
                const ext = getFileExtension(href);
                return { url: href, text: text, ext: ext };
            })
            .filter((val, idx, self) => val && self.findIndex(t => t.url === val.url) === idx);
        
        if (links.length === 0) {
            alert('No downloadable links found on this page.');
            return;
        }
        
        // Remove existing dialog if any
        const existing = document.getElementById('apna-mass-grabber-dialog');
        if (existing) existing.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'apna-mass-grabber-dialog';
        
        dialog.innerHTML = `
            <div class="apna-mass-overlay"></div>
            <div class="apna-mass-modal">
                <div class="apna-mass-header">
                    <div class="apna-mass-title">
                        <img src="${chrome.runtime.getURL('icon48.png')}" width="20" height="20" style="vertical-align: middle;" />
                        <span>Download all links on this page</span>
                    </div>
                    <div class="apna-mass-close">&times;</div>
                </div>
                <div class="apna-mass-filters">
                    <span class="apna-filter-chip active" data-type="all">All (${links.length})</span>
                    <span class="apna-filter-chip" data-type="media">Videos & Audio</span>
                    <span class="apna-filter-chip" data-type="docs">Documents</span>
                    <span class="apna-filter-chip" data-type="archives">Archives</span>
                </div>
                <div class="apna-mass-list-header">
                    <label><input type="checkbox" id="apna-mass-select-all" checked /> <span>Select All</span></label>
                    <span id="apna-mass-selected-count">${links.length} links selected</span>
                </div>
                <div class="apna-mass-list">
                    ${links.map((link, idx) => {
                        return `
                            <div class="apna-mass-item" data-ext="${link.ext}" data-url="${link.url}">
                                <label style="display: flex; align-items: flex-start; gap: 12px; width: 100%; cursor: pointer;">
                                    <input type="checkbox" class="apna-mass-item-check" data-idx="${idx}" checked style="margin-top: 4px; cursor: pointer;" />
                                    <div class="apna-mass-item-details" style="min-width: 0; flex: 1;">
                                        <span class="apna-mass-item-text" style="display: block; font-size: 13px; font-weight: 500; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(link.text)}</span>
                                        <span class="apna-mass-item-url" style="display: block; font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${link.url}">${link.url}</span>
                                    </div>
                                </label>
                            </div>
                        `;
                    }).join('')}
                </div>
                <div class="apna-mass-footer">
                    <button class="apna-mass-btn-cancel">Cancel</button>
                    <button class="apna-mass-btn-download">Download Selected</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        const closeBtn = dialog.querySelector('.apna-mass-close');
        const cancelBtn = dialog.querySelector('.apna-mass-btn-cancel');
        const downloadBtn = dialog.querySelector('.apna-mass-btn-download');
        const selectAll = dialog.querySelector('#apna-mass-select-all');
        const itemChecks = dialog.querySelectorAll('.apna-mass-item-check');
        const countText = dialog.querySelector('#apna-mass-selected-count');
        const filterChips = dialog.querySelectorAll('.apna-filter-chip');
        const listItems = dialog.querySelectorAll('.apna-mass-item');
        
        const updateSelectedCount = () => {
            const checkedCount = dialog.querySelectorAll('.apna-mass-item-check:checked').length;
            countText.innerText = `${checkedCount} links selected`;
            downloadBtn.disabled = checkedCount === 0;
            if (checkedCount === 0) {
                downloadBtn.style.opacity = '0.5';
                downloadBtn.style.cursor = 'not-allowed';
            } else {
                downloadBtn.style.opacity = '1';
                downloadBtn.style.cursor = 'pointer';
            }
        };
        
        const closeDialog = () => {
            dialog.remove();
        };
        
        closeBtn.addEventListener('click', closeDialog);
        cancelBtn.addEventListener('click', closeDialog);
        
        selectAll.addEventListener('change', () => {
            const checked = selectAll.checked;
            dialog.querySelectorAll('.apna-mass-item-check').forEach(chk => {
                const item = chk.closest('.apna-mass-item');
                if (item && item.style.display !== 'none') {
                    chk.checked = checked;
                }
            });
            updateSelectedCount();
        });
        
        itemChecks.forEach(chk => {
            chk.addEventListener('change', updateSelectedCount);
        });
        
        filterChips.forEach(chip => {
            chip.addEventListener('click', () => {
                filterChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                
                const type = chip.getAttribute('data-type');
                
                listItems.forEach(item => {
                    const ext = item.getAttribute('data-ext') || '';
                    let visible = false;
                    
                    if (type === 'all') {
                        visible = true;
                    } else if (type === 'media') {
                        visible = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext);
                    } else if (type === 'docs') {
                        visible = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'].includes(ext);
                    } else if (type === 'archives') {
                        visible = ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
                    }
                    
                    item.style.display = visible ? 'flex' : 'none';
                });
                
                const visibleChecks = dialog.querySelectorAll('.apna-mass-item:not([style*="display: none"]) .apna-mass-item-check');
                const visibleChecked = dialog.querySelectorAll('.apna-mass-item:not([style*="display: none"]) .apna-mass-item-check:checked');
                selectAll.checked = visibleChecks.length > 0 && visibleChecks.length === visibleChecked.length;
            });
        });
        
        downloadBtn.addEventListener('click', () => {
            const checkedIndices = Array.from(dialog.querySelectorAll('.apna-mass-item-check:checked'))
                .map(chk => parseInt(chk.getAttribute('data-idx'), 10));
            
            const selectedLinks = checkedIndices.map(idx => links[idx]);
            
            closeDialog();
            
            selectedLinks.forEach((link, seqIdx) => {
                setTimeout(() => {
                    chrome.runtime.sendMessage({
                        action: 'grab',
                        payload: {
                            url: link.url,
                            filename: link.text.substring(0, 60),
                            quality: 'direct',
                            referer: window.location.href,
                            userAgent: navigator.userAgent,
                            engine: 'basic'
                        }
                    }, (response) => {
                        console.log(`[Mass Grabber] Link queue status [${seqIdx + 1}/${selectedLinks.length}]:`, response);
                    });
                }, seqIdx * 250);
            });
        });
    }
})();
