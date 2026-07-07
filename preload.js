const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Actions sent to main process
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getDefaultDownloadDirs: () => ipcRenderer.invoke('get-default-download-dirs'),
    getDownloads: () => ipcRenderer.invoke('get-downloads'),
    addDownload: (url, savePath, numConnections, quality, downloadLater, referer, userAgent, engine, silent, downloadSubtitles) => ipcRenderer.invoke('add-download', { url, savePath, numConnections, quality, downloadLater, referer, userAgent, engine, silent, downloadSubtitles }),
    pauseDownload: (id) => ipcRenderer.invoke('pause-download', id),
    resumeDownload: (id) => ipcRenderer.invoke('resume-download', id),
    cancelDownload: (id, deleteFile) => ipcRenderer.invoke('cancel-download', { id, deleteFile }),
    openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
    openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
    resizeProgressWindow: (id, width, height) => ipcRenderer.invoke('resize-progress-window', { id, width, height }),
    minimizeProgressWindow: (id) => ipcRenderer.invoke('minimize-progress-window', id),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    startQueue: () => ipcRenderer.invoke('start-queue'),
    stopQueue: () => ipcRenderer.invoke('stop-queue'),
    checkEngines: () => ipcRenderer.invoke('check-engines'),
    convertMedia: (id, format) => ipcRenderer.invoke('convert-media', { id, format }),
    cancelConversion: (id) => ipcRenderer.invoke('cancel-conversion', id),
    fetchPlaylistMetadata: (url) => ipcRenderer.invoke('fetch-playlist-metadata', url),
    fetchMediaSize: (url, quality) => ipcRenderer.invoke('fetch-media-size', { url, quality }),
    openInfoWindow: (data) => ipcRenderer.invoke('open-info-window', data),
    resetSettings: () => ipcRenderer.invoke('reset-settings'),
    saveAuthToken: (data) => ipcRenderer.invoke('save-auth-token', data),
    logoutUser: () => ipcRenderer.invoke('logout-user'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    getSubscriptionDetails: () => ipcRenderer.invoke('get-subscription-details'),
    unbindDeviceSlot: (deviceId) => ipcRenderer.invoke('unbind-device-slot', deviceId),
    activateFreeTrial: () => ipcRenderer.invoke('activate-free-trial'),
    startGoogleAuth: () => ipcRenderer.invoke('start-google-auth'),

    onLicenseStatusLocked: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('license-status-locked', subscription);
        return () => ipcRenderer.removeListener('license-status-locked', subscription);
    },

    // Subscriptions from main process
    onSettingsUpdated: (callback) => {
        const subscription = (event, settings) => callback(settings);
        ipcRenderer.on('settings-updated', subscription);
        return () => ipcRenderer.removeListener('settings-updated', subscription);
    },
    onDownloadListUpdated: (callback) => {
        const subscription = (event, downloads) => callback(downloads);
        ipcRenderer.on('download-list-updated', subscription);
        return () => ipcRenderer.removeListener('download-list-updated', subscription);
    },
    onEngineProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('engine-progress', subscription);
        return () => ipcRenderer.removeListener('engine-progress', subscription);
    },
    onDownloadProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('download-progress', subscription);
        return () => ipcRenderer.removeListener('download-progress', subscription);
    },
    onDownloadStatus: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('download-status', subscription);
        return () => ipcRenderer.removeListener('download-status', subscription);
    },
    onSegmentProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('segment-progress', subscription);
        return () => ipcRenderer.removeListener('segment-progress', subscription);
    },
    onGrabbedUrl: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('grabbed-url', subscription);
        return () => ipcRenderer.removeListener('grabbed-url', subscription);
    },
    onPlayCompletionSound: (callback) => {
        const subscription = (event) => callback();
        ipcRenderer.on('play-completion-sound', subscription);
        return () => ipcRenderer.removeListener('play-completion-sound', subscription);
    },
    onDownloadFilePathChanged: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('download-file-path-changed', subscription);
        return () => ipcRenderer.removeListener('download-file-path-changed', subscription);
    },
    onClipboardUrlDetected: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('clipboard-url-detected', subscription);
        return () => ipcRenderer.removeListener('clipboard-url-detected', subscription);
    },
    onConversionProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('conversion-progress', subscription);
        return () => ipcRenderer.removeListener('conversion-progress', subscription);
    },
    onConversionCompleted: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('conversion-completed', subscription);
        return () => ipcRenderer.removeListener('conversion-completed', subscription);
    },
    onConversionError: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('conversion-error', subscription);
        return () => ipcRenderer.removeListener('conversion-error', subscription);
    }
});
