const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.ogg'];
const TIME_NOTIFY_MS = 250;

const state = {
    audio: null,
    canvas: null,
    ctx: null,
    dotnet: null,
    fileInput: null,
    audioContext: null,
    sourceNode: null,
    analyser: null,
    freqData: null,
    timeData: null,
    objectUrl: null,
    currentTitle: 'Local track',
    pendingFile: null,
    loading: false,
    playWhenReady: false,
    seeking: false,
    lastTimeNotify: 0,
    rafId: 0,
    resizeObserver: null,
    audioListeners: [],
    fileHandler: null,
    bass: 0,
    mid: 0,
    treble: 0,
    idlePhase: 0
};

export async function initialize(audio, canvas, dotnet, volume) {
    if (state.audio && state.audio !== audio) {
        state.audio.pause();
        unbindAudio();
        state.audio.removeAttribute('src');
        state.audio.load();
        await teardownGraph();
        revokeObjectUrl();
        state.loading = false;
        state.playWhenReady = false;
    }

    state.audio = audio;
    state.canvas = canvas || null;
    state.dotnet = dotnet;
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.volume = clamp(volume ?? 0.6, 0, 1);

    bindAudio();
    setupCanvas();
    startLoop();

    if (state.pendingFile) {
        const file = state.pendingFile;
        state.pendingFile = null;
        void loadFile(file, false);
    }
}

export function attachFileInput(input) {
    if (state.fileInput === input) {
        return;
    }

    if (state.fileInput && state.fileHandler) {
        state.fileInput.removeEventListener('change', state.fileHandler);
    }

    state.fileInput = input;
    state.fileHandler = onFileInputChange;
    input.addEventListener('change', state.fileHandler);
}

export async function play() {
    if (!state.audio || !state.audio.src) {
        return;
    }

    state.playWhenReady = true;
    await tryEnsureGraph();
    try {
        await state.audio.play();
    } catch (error) {
        state.playWhenReady = false;
        await notify('OnError', userFacingError(error));
    }
}

export function pause() {
    state.playWhenReady = false;
    state.audio?.pause();
}

export function seek(seconds) {
    if (!state.audio || !Number.isFinite(seconds)) {
        return;
    }

    state.seeking = true;
    state.audio.currentTime = clamp(seconds, 0, finiteDuration());
    void notify('OnTimeUpdate', state.audio.currentTime, finiteDuration());
}

export function setVolume(volume) {
    if (!state.audio) {
        return;
    }

    state.audio.volume = clamp(volume, 0, 1);
}

export async function dispose() {
    stopLoop();
    unbindAudio();
    unbindFileInput();
    await teardownGraph();
    state.audio?.pause();
    state.audio?.removeAttribute('src');
    state.audio?.load();
    revokeObjectUrl();
    state.pendingFile = null;
    state.loading = false;
    state.playWhenReady = false;
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    state.audio = null;
    state.canvas = null;
    state.ctx = null;
    state.dotnet = null;
}

function bindAudio() {
    unbindAudio();
    const audio = state.audio;
    if (!audio) {
        return;
    }

    addAudioListener('loadedmetadata', onLoadedMetadata);
    addAudioListener('play', onPlay);
    addAudioListener('pause', onPause);
    addAudioListener('ended', onEnded);
    addAudioListener('timeupdate', onTimeUpdate);
    addAudioListener('seeked', onSeeked);
    addAudioListener('error', onAudioError);
}

function addAudioListener(eventName, handler) {
    state.audio.addEventListener(eventName, handler);
    state.audioListeners.push([eventName, handler]);
}

function unbindAudio() {
    if (!state.audio) {
        state.audioListeners = [];
        return;
    }

    for (const [eventName, handler] of state.audioListeners) {
        state.audio.removeEventListener(eventName, handler);
    }

    state.audioListeners = [];
}

function unbindFileInput() {
    if (state.fileInput && state.fileHandler) {
        state.fileInput.removeEventListener('change', state.fileHandler);
    }

    state.fileInput = null;
    state.fileHandler = null;
}

function onFileInputChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) {
        return;
    }

    void loadFile(file, false);
}

async function loadFile(file, playWhenReady) {
    if (!isSupportedFile(file)) {
        await notify('OnSelectionError', 'Please choose an MP3, WAV, or OGG audio file.');
        return;
    }

    if (!state.audio) {
        state.pendingFile = file;
        await notify('OnLoading', file.name);
        return;
    }

    state.playWhenReady = playWhenReady;
    state.loading = true;
    state.seeking = false;
    state.currentTitle = stripExtension(file.name);
    await notify('OnLoading', file.name);

    const nextUrl = URL.createObjectURL(file);
    const previousUrl = state.objectUrl;
    state.objectUrl = nextUrl;
    state.audio.src = nextUrl;
    state.audio.load();

    if (previousUrl && previousUrl !== nextUrl) {
        URL.revokeObjectURL(previousUrl);
    }
}

function isSupportedFile(file) {
    const name = (file.name || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        return true;
    }

    const mime = (file.type || '').toLowerCase();
    return mime.includes('mpeg')
        || mime.includes('mp3')
        || mime.includes('wav')
        || mime.includes('ogg')
        || mime.includes('vorbis');
}

async function ensureGraph() {
    if (!state.audio) {
        return;
    }

    if (!state.audioContext) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            throw new Error('Web Audio is not supported by this browser.');
        }
        state.audioContext = new AudioContextCtor();
    }

    if (state.audioContext.state === 'suspended') {
        await state.audioContext.resume();
    }

    if (!state.sourceNode) {
        state.sourceNode = state.audioContext.createMediaElementSource(state.audio);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 2048;
        state.analyser.smoothingTimeConstant = 0.82;
        state.sourceNode.connect(state.analyser);
        state.analyser.connect(state.audioContext.destination);
        state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
        state.timeData = new Uint8Array(state.analyser.fftSize);
    }
}

async function teardownGraph() {
    const audioContext = state.audioContext;

    state.sourceNode?.disconnect();
    state.analyser?.disconnect();

    state.audioContext = null;
    state.sourceNode = null;
    state.analyser = null;
    state.freqData = null;
    state.timeData = null;

    if (audioContext && audioContext.state !== 'closed') {
        try {
            await audioContext.close();
        } catch (error) {
            console.error('JamMusic audio context could not be closed.', error);
        }
    }
}

function revokeObjectUrl() {
    if (state.objectUrl) {
        URL.revokeObjectURL(state.objectUrl);
        state.objectUrl = null;
    }
}

async function onLoadedMetadata() {
    state.loading = false;
    await notify('OnReady', finiteDuration(), state.currentTitle);
    await notify('OnTimeUpdate', state.audio.currentTime || 0, finiteDuration());

    if (state.playWhenReady) {
        try {
            await tryEnsureGraph();
            await state.audio.play();
        } catch (error) {
            state.playWhenReady = false;
            await notify('OnError', userFacingError(error));
        }
    }
}

async function onPlay() {
    await tryEnsureGraph();
    await notify('OnPlay');
}

async function onPause() {
    if (state.audio?.ended || state.playWhenReady || state.loading) {
        return;
    }

    await notify('OnPause');
}

async function onEnded() {
    state.playWhenReady = false;
    await notify('OnEnded');
}

async function onTimeUpdate() {
    if (state.seeking || !state.audio) {
        return;
    }

    const now = performance.now();
    if (now - state.lastTimeNotify < TIME_NOTIFY_MS) {
        return;
    }

    state.lastTimeNotify = now;
    await notify('OnTimeUpdate', state.audio.currentTime || 0, finiteDuration());
}

async function onSeeked() {
    state.seeking = false;
    if (!state.audio) {
        return;
    }

    state.lastTimeNotify = performance.now();
    await notify('OnTimeUpdate', state.audio.currentTime || 0, finiteDuration());
}

async function onAudioError() {
    state.loading = false;
    const mediaError = state.audio?.error;
    let message = 'This audio file could not be played.';
    if (mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        message = 'This file format is not supported by your browser.';
    } else if (mediaError?.code === MediaError.MEDIA_ERR_DECODE) {
        message = 'This audio file could not be decoded.';
    } else if (mediaError?.code === MediaError.MEDIA_ERR_NETWORK) {
        message = 'The audio file could not be loaded.';
    }

    await notify('OnError', message);
}

function stripExtension(name) {
    const fileName = name.split(/[/\\]/).pop() || name;
    return fileName.replace(/\.[^/.]+$/, '') || 'Local track';
}

function finiteDuration() {
    const duration = state.audio?.duration;
    return Number.isFinite(duration) ? duration : 0;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

async function notify(method, ...args) {
    if (!state.dotnet) {
        return;
    }

    try {
        await state.dotnet.invokeMethodAsync(method, ...args);
    } catch (error) {
        const text = String(error);
        if (!text.includes('circuit') && !text.includes('disposed') && !text.includes('prerender')) {
            console.warn('JamMusic audio notify failed', method, error);
        }
    }
}

async function tryEnsureGraph() {
    try {
        await ensureGraph();
        return true;
    } catch (error) {
        console.error('JamMusic audio analysis could not be initialized.', error);
        return false;
    }
}

function setupCanvas() {
    if (!state.canvas) {
        return;
    }

    state.ctx = state.canvas.getContext('2d');
    state.resizeObserver?.disconnect();
    state.resizeObserver = new ResizeObserver(() => resizeCanvas());
    state.resizeObserver.observe(state.canvas);
    resizeCanvas();
}

function resizeCanvas() {
    if (!state.canvas || !state.ctx) {
        return;
    }

    const rect = state.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    state.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function startLoop() {
    if (state.rafId) {
        return;
    }

    const tick = () => {
        drawAura();
        state.rafId = requestAnimationFrame(tick);
    };

    state.rafId = requestAnimationFrame(tick);
}

function stopLoop() {
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
    }
}

function drawAura() {
    if (!state.ctx || !state.canvas) {
        return;
    }

    const width = state.canvas.clientWidth || state.canvas.width;
    const height = state.canvas.clientHeight || state.canvas.height;
    if (width === 0 || height === 0) {
        return;
    }

    const playing = Boolean(state.audio && !state.audio.paused && !state.audio.ended);
    readBands(playing);
    state.idlePhase += playing ? 0.018 : 0.008;

    const ctx = state.ctx;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const breath = 0.5 + 0.5 * Math.sin(state.idlePhase);
    const bass = state.bass;
    const mid = state.mid;
    const treble = state.treble;
    const energy = playing ? 0.55 + bass * 0.45 : 0.22 + breath * 0.08;

    const background = ctx.createRadialGradient(cx, cy, 12, cx, cy, Math.max(width, height) * 0.72);
    background.addColorStop(0, `rgba(${90 + mid * 80}, ${50 + bass * 40}, ${150 + treble * 70}, ${0.28 + energy * 0.25})`);
    background.addColorStop(0.42, 'rgba(9, 15, 45, 0.88)');
    background.addColorStop(1, '#05003a');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const radius = Math.min(width, height) * (0.14 + bass * 0.16 + (playing ? 0 : breath * 0.02));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius * (2.1 + bass * 1.4));
    glow.addColorStop(0, `rgba(141, 231, 210, ${0.28 + bass * 0.55})`);
    glow.addColorStop(0.32, `rgba(245, 191, 217, ${0.18 + mid * 0.4})`);
    glow.addColorStop(0.62, `rgba(185, 177, 255, ${0.12 + treble * 0.32})`);
    glow.addColorStop(1, 'rgba(5, 0, 58, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (2.6 + bass * 1.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawWave(ctx, cx, cy, radius, playing);
}

function drawWave(ctx, cx, cy, radius, playing) {
    const data = state.timeData;
    ctx.beginPath();
    const points = 160;
    for (let i = 0; i <= points; i += 1) {
        const t = i / points;
        const angle = t * Math.PI * 2 + state.idlePhase * 0.35;
        let sample = 0;
        if (data && data.length > 0) {
            const index = Math.floor(t * (data.length - 1));
            sample = (data[index] - 128) / 128;
        } else {
            sample = Math.sin(angle * 3 + state.idlePhase) * 0.12;
        }

        const deform = playing ? 0.24 + state.treble * 0.22 : 0.08;
        const r = radius * (1.12 + sample * deform + state.bass * 0.08);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.closePath();
    ctx.strokeStyle = `rgba(255, 220, 156, ${0.22 + state.treble * 0.5})`;
    ctx.lineWidth = playing ? 2.4 : 1.4;
    ctx.stroke();
}

function readBands(playing) {
    if (!state.analyser || !state.freqData || !state.timeData) {
        decayBands(playing ? 0.08 : 0.04);
        return;
    }

    state.analyser.getByteFrequencyData(state.freqData);
    state.analyser.getByteTimeDomainData(state.timeData);

    const sampleRate = state.audioContext?.sampleRate || 44100;
    const binHz = sampleRate / state.analyser.fftSize;
    const bass = averageRange(state.freqData, binHz, 20, 180);
    const mid = averageRange(state.freqData, binHz, 180, 2000);
    const treble = averageRange(state.freqData, binHz, 2000, 8000);
    const targetMix = playing ? 1 : 0.15;

    state.bass = lerp(state.bass, bass * targetMix, playing ? 0.22 : 0.08);
    state.mid = lerp(state.mid, mid * targetMix, playing ? 0.18 : 0.08);
    state.treble = lerp(state.treble, treble * targetMix, playing ? 0.2 : 0.08);
}

function decayBands(amount) {
    state.bass = Math.max(0, state.bass - amount);
    state.mid = Math.max(0, state.mid - amount);
    state.treble = Math.max(0, state.treble - amount);
}

function averageRange(data, binHz, minHz, maxHz) {
    const start = Math.max(0, Math.floor(minHz / binHz));
    const end = Math.min(data.length - 1, Math.ceil(maxHz / binHz));
    if (end <= start) {
        return 0;
    }

    let sum = 0;
    for (let i = start; i <= end; i += 1) {
        sum += data[i];
    }

    return (sum / (end - start + 1)) / 255;
}

function lerp(from, to, amount) {
    return from + (to - from) * amount;
}

function userFacingError(error) {
    const text = String(error?.message || error || '');
    if (text.toLowerCase().includes('play')) {
        return 'Your browser blocked autoplay. Press play to start the track.';
    }

    return 'This audio file could not be played.';
}
