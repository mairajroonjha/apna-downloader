const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
    queueEnabled: false,
    maxConcurrentDownloads: 2,
    speedLimitEnabled: false,
    maxSpeedLimit: 1024, // in KB/s
    schedulerEnabled: false,
    schedulerStart: "23:00",
    schedulerStop: "07:00",
    schedulerAction: "pause",
    theme: "light",
    accentColor: "blue",
    clipboardMonitorEnabled: false,
    excludedDomains: [],
    hasSeenTour: false,
    customCategories: [],
    postOpenCompletedFile: false,
    postShowNotification: true,
    postPlayCompleteSound: true
};

let settings = { ...defaultSettings };

function load() {
    if (fs.existsSync(settingsPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            settings = { ...defaultSettings, ...data };
        } catch (e) {
            console.error('Failed to load settings:', e);
            settings = { ...defaultSettings };
        }
    } else {
        settings = { ...defaultSettings };
        save();
    }
    return settings;
}

function save(newSettings = {}) {
    settings = { ...settings, ...newSettings };
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
    return settings;
}

function reset() {
    settings = { ...defaultSettings };
    save();
    return settings;
}

module.exports = {
    load,
    save,
    reset,
    get: () => settings,
    getPath: () => settingsPath
};
