document.addEventListener('DOMContentLoaded', async () => {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');

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
});
