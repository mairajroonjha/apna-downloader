document.addEventListener('DOMContentLoaded', async () => {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    const listContainer = document.getElementById('media-list-container');
    const btnDownloadAll = document.getElementById('btn-download-all-items');

    const tabVids = document.getElementById('tab-vids');
    const tabAuds = document.getElementById('tab-auds');
    const tabImgs = document.getElementById('tab-imgs');
    const tabDocs = document.getElementById('tab-docs');

    const cntVids = document.getElementById('cnt-vids');
    const cntAuds = document.getElementById('cnt-auds');
    const cntImgs = document.getElementById('cnt-imgs');
    const cntDocs = document.getElementById('cnt-docs');

    let pageMedia = { videos: [], audios: [], images: [], documents: [] };
    let currentTab = 'videos';

    // 1. Check Native Desktop Integration Connection
    chrome.runtime.sendMessage({ action: 'get-settings' }, (settings) => {
        if (settings && !settings.error) {
            dot.className = 'status-dot connected';
            text.innerText = 'Connected';
            if (settings.theme) document.body.className = 'theme-' + settings.theme;
        } else {
            dot.className = 'status-dot disconnected';
            text.innerText = 'Disconnected';
        }
    });

    // 2. Query Active Tab for Scraped Media
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, { action: 'scrapeMedia' }, (response) => {
                if (response && response.media) {
                    pageMedia = response.media;
                    cntVids.innerText = pageMedia.videos.length;
                    cntAuds.innerText = pageMedia.audios.length;
                    cntImgs.innerText = pageMedia.images.length;
                    cntDocs.innerText = pageMedia.documents.length;
                    renderTab(currentTab);
                }
            });
        }
    } catch (e) {
        console.warn('Failed to query active tab:', e);
    }

    // Tab Listeners
    function switchTab(tabName, activeBtn) {
        currentTab = tabName;
        [tabVids, tabAuds, tabImgs, tabDocs].forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
        renderTab(tabName);
    }

    tabVids.addEventListener('click', () => switchTab('videos', tabVids));
    tabAuds.addEventListener('click', () => switchTab('audios', tabAuds));
    tabImgs.addEventListener('click', () => switchTab('images', tabImgs));
    tabDocs.addEventListener('click', () => switchTab('documents', tabDocs));

    function renderTab(tabName) {
        listContainer.innerHTML = '';
        const items = pageMedia[tabName] || [];

        if (items.length === 0) {
            listContainer.innerHTML = `<div class="empty-state">No ${tabName} detected on this page.</div>`;
            return;
        }

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'media-item';

            const info = document.createElement('div');
            info.className = 'media-info';
            
            const title = document.createElement('div');
            title.className = 'media-title';
            title.innerText = item.title || item.filename || item.url;

            const sub = document.createElement('div');
            sub.className = 'media-sub';
            sub.innerText = item.format || item.ext || 'Media';

            info.appendChild(title);
            info.appendChild(sub);

            const btn = document.createElement('button');
            btn.className = 'btn-download-item';
            btn.innerText = 'Download';
            btn.addEventListener('click', () => {
                chrome.runtime.sendMessage({
                    action: 'sendToApna',
                    url: item.url,
                    filename: item.filename || item.title || 'download'
                });
            });

            div.appendChild(info);
            div.appendChild(btn);
            listContainer.appendChild(div);
        });
    }

    btnDownloadAll.addEventListener('click', () => {
        const items = pageMedia[currentTab] || [];
        items.forEach(item => {
            chrome.runtime.sendMessage({
                action: 'sendToApna',
                url: item.url,
                filename: item.filename || item.title || 'download'
            });
        });
    });
});
