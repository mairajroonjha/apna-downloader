// Parse query parameter to get download ID
const urlParams = new URLSearchParams(window.location.search);
const downloadId = urlParams.get('id');

let downloadItem = null;
let threadElementsCreated = false;

// DOM Elements
const fileTitle = document.getElementById('file-title');
const statusText = document.getElementById('status-text');
const infoSize = document.getElementById('info-size');
const infoDownloaded = document.getElementById('info-downloaded');
const infoSpeed = document.getElementById('info-speed');
const infoTime = document.getElementById('info-time');
const infoResume = document.getElementById('info-resume');
const overallBar = document.getElementById('overall-bar');
const overallPercentage = document.getElementById('overall-percentage');
const threadsList = document.getElementById('threads-list');
const threadsHeader = document.getElementById('threads-header');
const threadsToggleIcon = document.getElementById('threads-toggle-icon');

const btnPause = document.getElementById('btn-action-pause');
const btnCancel = document.getElementById('btn-action-cancel');
const btnClose = document.getElementById('btn-action-close');

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

// Initialize
async function init() {
    let list = [];
    try {
        list = await window.api.getDownloads();
    } catch(e) {}
    
    downloadItem = list.find(d => d.id === downloadId);
    
    if (!downloadItem) {
        alert('Download not found!');
        window.close();
        return;
    }

    // Populate initial info
    fileTitle.innerText = downloadItem.filename;
    fileTitle.title = downloadItem.filename;
    updateUIFromItem(downloadItem);
    
    // Create connection thread visual slots
    createThreadElements(downloadItem.numConnections || 8);

    // Setup event listeners
    window.api.onDownloadProgress((data) => {
        if (data.id === downloadId) {
            infoDownloaded.innerText = `${formatBytes(data.downloaded)} / ${data.total ? formatBytes(data.total) : 'Unknown'}`;
            infoSpeed.innerText = formatSpeed(data.speed);
            infoTime.innerText = formatTimeRemaining(data.timeRemaining);
            overallBar.style.width = `${data.percentage.toFixed(1)}%`;
            overallPercentage.innerText = `${data.percentage.toFixed(1)}%`;
            
            // Circular progress SVG fill
            const circleFill = document.getElementById('overall-circle-fill');
            if (circleFill) {
                const offset = 263.89 - (263.89 * data.percentage) / 100;
                circleFill.style.strokeDashoffset = offset;
            }
            
            if (data.statusDetail) {
                statusText.innerText = data.statusDetail;
            } else if (downloadItem) {
                statusText.innerText = downloadItem.status;
            }
            
            if (data.total > 0) {
                infoSize.innerText = formatBytes(data.total);
            }
        }
    });

    window.api.onDownloadStatus((data) => {
        if (data.id === downloadId) {
            updateUIStatus(data.status);
            if (data.status === 'completed') {
                // If completed, set thread bars to 100%
                setAllThreadsCompleted();
            }
        }
    });

    window.api.onSegmentProgress((data) => {
        if (data.downloadId === downloadId) {
            updateSegmentUI(data.segmentId, data.percentage);
        }
    });

    window.api.onDownloadFilePathChanged((data) => {
        if (data.id === downloadId) {
            if (downloadItem) {
                downloadItem.savePath = data.savePath;
                downloadItem.filename = data.filename;
                downloadItem.category = data.category;
            }
            fileTitle.innerText = data.filename;
            fileTitle.title = data.filename;
        }
    });

    setupControlButtons();
    
    // Set initial window size
    adjustWindowSize();
}

function updateUIFromItem(item) {
    infoSize.innerText = item.totalSize ? formatBytes(item.totalSize) : 'Checking...';
    infoDownloaded.innerText = `${formatBytes(item.downloaded)} / ${item.totalSize ? formatBytes(item.totalSize) : 'Unknown'}`;
    updateUIStatus(item.status);
}

function updateUIStatus(status) {
    if (downloadItem) downloadItem.status = status;
    statusText.innerText = status;
    statusText.className = `status-badge ${status}`;
    
    // Resume capability - range requests work if server lets us segment
    // For simplicity, we state "Yes" if range supported, or if it is completed
    if (status === 'completed') {
        infoResume.innerText = 'Yes (Finished)';
        infoSpeed.innerText = '-';
        infoTime.innerText = 'Finished';
    } else {
        infoResume.innerText = downloadItem.numConnections > 1 ? 'Yes' : 'No (Single-thread)';
    }

    const infoResume2 = document.getElementById('info-resume-2');
    if (infoResume2) {
        infoResume2.innerText = infoResume.innerText;
    }

    if (status === 'downloading' || status === 'connecting') {
        btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        btnPause.setAttribute('data-action', 'pause');
        btnPause.disabled = false;
        btnCancel.style.display = 'inline-flex';
        btnClose.innerText = 'Hide Window';
    } else if (status === 'paused' || status === 'failed') {
        btnPause.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        btnPause.setAttribute('data-action', 'resume');
        btnPause.disabled = false;
        btnCancel.style.display = 'inline-flex';
        infoSpeed.innerText = '-';
        btnClose.innerText = 'Hide Window';
    } else if (status === 'completed') {
        btnPause.innerHTML = '<i class="fa-solid fa-check"></i> Open File';
        btnPause.setAttribute('data-action', 'open');
        btnPause.disabled = false;
        btnCancel.style.display = 'none';
        btnClose.innerText = 'Close Window';
    } else {
        btnPause.disabled = true;
        btnCancel.style.display = 'inline-flex';
        btnClose.innerText = 'Hide Window';
    }
}

let threadPercentages = [];

function createThreadElements(count) {
    threadsList.innerHTML = '';
    if (downloadItem && downloadItem.threadPercentages) {
        threadPercentages = [...downloadItem.threadPercentages];
    } else {
        threadPercentages = Array(count).fill(0);
    }
    for (let i = 0; i < count; i++) {
        const pctVal = threadPercentages[i] || 0;
        const row = document.createElement('div');
        row.className = 'thread-row';
        row.innerHTML = `
            <span class="thread-label">Thread ${i + 1}</span>
            <div class="thread-progress-container">
                <div class="thread-progress-fill" id="thread-fill-${i}" style="width: ${pctVal.toFixed(1)}%"></div>
            </div>
            <span class="thread-meta">
                <span id="thread-pct-${i}">${pctVal.toFixed(1)}%</span>
                <span class="thread-separator">•</span>
                <span id="thread-speed-${i}" class="thread-speed">0.0 KB/s</span>
            </span>
            <span class="thread-icons">
                <i class="fa-solid fa-circle status-icon" style="color: #cbd5e1; font-size: 8px;"></i>
                <i class="fa-solid fa-circle-info info-icon"></i>
                <i class="fa-solid fa-chevron-right arrow-icon"></i>
            </span>
        `;
        threadsList.appendChild(row);
    }
    threadElementsCreated = true;

    // Generate block elements inside the grid container
    const grid = document.getElementById('segment-grid');
    if (grid) {
        grid.innerHTML = '';
        for (let i = 0; i < 100; i++) {
            const block = document.createElement('div');
            block.className = 'grid-block';
            block.id = `grid-block-${i}`;
            grid.appendChild(block);
        }
    }

    updateBlockGrid();
}

function updateBlockGrid() {
    if (!downloadItem) return;
    const N = downloadItem.numConnections || 8;

    for (let i = 0; i < N; i++) {
        const percentage = threadPercentages[i] || 0;
        const startBlock = Math.round((i * 100) / N);
        const endBlock = Math.round(((i + 1) * 100) / N);
        const numBlocks = endBlock - startBlock;
        const completedBlocks = Math.round((percentage / 100) * numBlocks);

        for (let b = 0; b < numBlocks; b++) {
            const blockIdx = startBlock + b;
            const blockEl = document.getElementById(`grid-block-${blockIdx}`);
            if (blockEl) {
                blockEl.className = 'grid-block';
                if (downloadItem.status === 'completed') {
                    blockEl.classList.add('completed');
                } else if (b < completedBlocks) {
                    blockEl.classList.add(`active-${i % 8}`);
                }
            }
        }
    }
}

function updateSegmentUI(segmentId, percentage) {
    if (!threadElementsCreated) return;
    const fill = document.getElementById(`thread-fill-${segmentId}`);
    const pct = document.getElementById(`thread-pct-${segmentId}`);
    const speedEl = document.getElementById(`thread-speed-${segmentId}`);
    const row = fill ? fill.closest('.thread-row') : null;
    
    if (fill && pct) {
        fill.style.width = `${percentage.toFixed(1)}%`;
        pct.innerText = `${percentage.toFixed(1)}%`;
    }

    if (speedEl && downloadItem) {
        if (percentage >= 100) {
            speedEl.innerText = `${formatBytes(downloadItem.totalSize / (downloadItem.numConnections || 8))}`;
            if (row) {
                const icon = row.querySelector('.status-icon');
                if (icon) {
                    icon.className = 'fa-solid fa-circle-check status-icon';
                    icon.style.color = 'var(--success-color)';
                    icon.style.fontSize = '12px';
                }
            }
        } else if (percentage > 0) {
            const currentSpeed = downloadItem.speed || 0;
            const activeCount = threadPercentages.filter(p => p > 0 && p < 100).length || 1;
            speedEl.innerText = `${formatSpeed(currentSpeed / activeCount)}`;
            if (row) {
                const icon = row.querySelector('.status-icon');
                if (icon) {
                    icon.className = 'fa-solid fa-circle-notch fa-spin status-icon';
                    icon.style.color = 'var(--accent-color)';
                    icon.style.fontSize = '12px';
                }
            }
        } else {
            speedEl.innerText = '0.0 KB/s';
            if (row) {
                const icon = row.querySelector('.status-icon');
                if (icon) {
                    icon.className = 'fa-solid fa-circle status-icon';
                    icon.style.color = '#cbd5e1';
                    icon.style.fontSize = '8px';
                }
            }
        }
    }

    threadPercentages[segmentId] = percentage;
    updateBlockGrid();
}

function setAllThreadsCompleted() {
    if (!threadElementsCreated) return;
    const fills = document.querySelectorAll('.thread-progress-fill');
    const pcts = document.querySelectorAll('[id^="thread-pct-"]');
    const speeds = document.querySelectorAll('.thread-speed');
    const icons = document.querySelectorAll('.status-icon');
    
    fills.forEach(f => f.style.width = '100%');
    pcts.forEach(p => p.innerText = '100.0%');
    
    if (downloadItem) {
        const segSize = downloadItem.totalSize / (downloadItem.numConnections || 8);
        speeds.forEach(s => s.innerText = `${formatBytes(segSize)}`);
    }
    
    icons.forEach(icon => {
        icon.className = 'fa-solid fa-circle-check status-icon';
        icon.style.color = 'var(--success-color)';
        icon.style.fontSize = '12px';
    });

    threadPercentages.fill(100);
    updateBlockGrid();
}

function setupControlButtons() {
    btnPause.addEventListener('click', () => {
        const action = btnPause.getAttribute('data-action');
        if (action === 'pause') {
            window.api.pauseDownload(downloadId);
        } else if (action === 'resume') {
            window.api.resumeDownload(downloadId);
        } else if (action === 'open') {
            window.api.openFile(downloadItem.savePath).then(res => {
                if (res && !res.success) {
                    if (res.error === 'FileNotFound') {
                        alert(`File not found: "${downloadItem.filename}"\nIt may have been moved, renamed, or deleted.`);
                    } else {
                        alert(`Could not open file: "${downloadItem.filename}"\nTry opening it manually from its folder.`);
                    }
                }
            });
        }
    });

    btnCancel.addEventListener('click', () => {
        if (confirm('Cancel download? This will delete temporary download progress.')) {
            window.api.cancelDownload(downloadId);
            window.close();
        }
    });

    btnClose.addEventListener('click', () => {
        if (btnClose.innerText === 'Hide Window') {
            window.api.minimizeProgressWindow(downloadId);
        } else {
            window.close(); // Close completely if status is completed/failed
        }
    });

    // Toggle Collapsible Threads and Segments Map
    const segmentHeader = document.getElementById('segment-header');
    const segmentContainer = document.getElementById('segment-container');
    const segmentGrid = document.getElementById('segment-grid');
    const segmentBadge = document.getElementById('segment-badge');
    const segmentToggleIcon = document.getElementById('segment-toggle-icon');

    segmentHeader.addEventListener('click', () => {
        const isCollapsed = segmentContainer.classList.toggle('collapsed');
        segmentContainer.classList.toggle('expanded', !isCollapsed);
        if (isCollapsed) {
            segmentGrid.style.display = 'none';
            segmentBadge.innerText = '[100 segments] COLLAPSED';
            segmentToggleIcon.className = 'fa-solid fa-chevron-right toggle-icon';
        } else {
            segmentGrid.style.display = 'grid';
            segmentBadge.innerText = '[100 segments] EXPANDED';
            segmentToggleIcon.className = 'fa-solid fa-chevron-down toggle-icon';
        }
        adjustWindowSize();
    });

    const threadsHeader = document.getElementById('threads-header');
    const threadsContainer = document.getElementById('threads-container');
    const threadsBadge = document.getElementById('threads-badge');
    const threadsToggleIcon = document.getElementById('threads-toggle-icon');

    threadsHeader.addEventListener('click', () => {
        const isCollapsed = threadsContainer.classList.toggle('collapsed');
        threadsContainer.classList.toggle('expanded', !isCollapsed);
        if (isCollapsed) {
            threadsList.style.display = 'none';
            threadsBadge.innerText = `[${downloadItem ? downloadItem.numConnections : 8} Threads] COLLAPSED`;
            threadsToggleIcon.className = 'fa-solid fa-chevron-right toggle-icon';
        } else {
            threadsList.style.display = 'flex';
            threadsBadge.innerText = `[${downloadItem ? downloadItem.numConnections : 8} Active Threads] EXPANDED`;
            threadsToggleIcon.className = 'fa-solid fa-chevron-down toggle-icon';
        }
        adjustWindowSize();
    });

    // Hide/Show section buttons and logic
    const btnHideSegments = document.getElementById('btn-hide-segments');
    const btnHideThreads = document.getElementById('btn-hide-threads');
    const btnShowVisualizers = document.getElementById('btn-show-visualizers');

    // Load initial visibility states from localStorage (default to hidden if not explicitly false)
    if (localStorage.getItem('hide-segments') !== 'false') {
        segmentContainer.classList.add('permanently-hidden');
    }
    if (localStorage.getItem('hide-threads') !== 'false') {
        threadsContainer.classList.add('permanently-hidden');
    }
    
    function updateShowVisualizersBtn() {
        const segHidden = localStorage.getItem('hide-segments') !== 'false';
        const thrHidden = localStorage.getItem('hide-threads') !== 'false';
        if (segHidden || thrHidden) {
            btnShowVisualizers.style.display = 'inline-block';
        } else {
            btnShowVisualizers.style.display = 'none';
        }
    }
    updateShowVisualizersBtn();

    btnHideSegments.addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.setItem('hide-segments', 'true');
        segmentContainer.classList.add('permanently-hidden');
        updateShowVisualizersBtn();
        adjustWindowSize();
    });

    btnHideThreads.addEventListener('click', (e) => {
        e.stopPropagation();
        localStorage.setItem('hide-threads', 'true');
        threadsContainer.classList.add('permanently-hidden');
        updateShowVisualizersBtn();
        adjustWindowSize();
    });

    btnShowVisualizers.addEventListener('click', () => {
        localStorage.setItem('hide-segments', 'false');
        localStorage.setItem('hide-threads', 'false');
        segmentContainer.classList.remove('permanently-hidden');
        threadsContainer.classList.remove('permanently-hidden');
        updateShowVisualizersBtn();
        adjustWindowSize();
    });

    // Call initial adjustment
    adjustWindowSize();
}

function adjustWindowSize() {
    setTimeout(() => {
        const bodyHeight = document.body.scrollHeight || document.documentElement.scrollHeight;
        const targetHeight = Math.ceil(bodyHeight) + 12;
        window.api.resizeProgressWindow(downloadId, 600, targetHeight);
    }, 40);
}

// Local simulation removed. Driven by main process simulation.

document.addEventListener('DOMContentLoaded', init);
