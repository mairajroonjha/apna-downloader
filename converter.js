const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class MediaConverter extends EventEmitter {
    constructor() {
        super();
        this.process = null;
        this.isKilled = false;
    }

    getFfmpegPath() {
        const { app } = require('electron');
        const isWin = process.platform === 'win32';
        const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

        // 1. Check local application installation directory
        let localDir = path.join(__dirname, 'bin');
        if (localDir.includes('app.asar')) {
            localDir = localDir.replace('app.asar', 'app.asar.unpacked');
        }
        const localFfmpeg = path.join(localDir, ffmpegName);
        if (fs.existsSync(localFfmpeg)) {
            return localFfmpeg;
        }

        // 2. Check userData folder bin directory
        const userDir = path.join(app.getPath('userData'), 'bin');
        const userFfmpeg = path.join(userDir, ffmpegName);
        if (fs.existsSync(userFfmpeg)) {
            return userFfmpeg;
        }

        // Fallback to global command
        return ffmpegName;
    }

    convert(inputPath, outputPath, format = 'mp3') {
        const ffmpegPath = this.getFfmpegPath();
        const args = ['-y', '-i', inputPath];

        if (format === 'mp3') {
            // Audio extraction parameters
            args.push('-vn', '-acodec', 'libmp3lame', '-q:a', '2');
        } else if (format === 'mp4') {
            // Video conversion to MP4 (AAC + H.264 wrapper)
            args.push('-vcodec', 'libx264', '-acodec', 'aac', '-strict', 'experimental', '-pix_fmt', 'yuv420p');
        }

        args.push(outputPath);

        console.log('[Converter] Running ffmpeg:', ffmpegPath, args.join(' '));

        this.process = spawn(ffmpegPath, args);

        let duration = 0;
        const durationRegex = /Duration:\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;
        const timeRegex = /time=\s*(\d{2}:\d{2}:\d{2}\.\d{2})/;

        const parseTimeStr = (timeStr) => {
            const parts = timeStr.split(':');
            if (parts.length < 3) return 0;
            const hrs = parseFloat(parts[0]);
            const mins = parseFloat(parts[1]);
            const secs = parseFloat(parts[2]);
            return (hrs * 3600) + (mins * 60) + secs;
        };

        const handleData = (data) => {
            const text = data.toString();
            
            // Check for duration at startup
            if (!duration) {
                const durMatch = text.match(durationRegex);
                if (durMatch) {
                    duration = parseTimeStr(durMatch[1]);
                    console.log(`[Converter] Target video duration resolved: ${duration} seconds`);
                }
            }

            // Check for current rendering time progress
            const timeMatch = text.match(timeRegex);
            if (timeMatch && duration > 0) {
                const currentTime = parseTimeStr(timeMatch[1]);
                const progress = Math.min(100, Math.max(0, (currentTime / duration) * 100));
                this.emit('progress', progress);
            }
        };

        // ffmpeg writes stats/progress to stderr
        this.process.stderr.on('data', handleData);
        this.process.stdout.on('data', handleData);

        this.process.on('close', (code) => {
            if (this.isKilled) return;

            if (code === 0) {
                console.log('[Converter] Conversion finished successfully');
                this.emit('completed');
            } else {
                console.error(`[Converter] ffmpeg failed with exit code ${code}`);
                this.emit('error', new Error(`ffmpeg exited with code ${code}`));
            }
        });

        this.process.on('error', (err) => {
            if (this.isKilled) return;
            console.error('[Converter] Spawn error:', err);
            this.emit('error', err);
        });
    }

    cancel() {
        this.isKilled = true;
        if (this.process) {
            try {
                this.process.kill('SIGKILL');
            } catch (e) {
                console.error('[Converter] Failed to kill process', e);
            }
        }
    }
}

module.exports = MediaConverter;
