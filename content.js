// content.js
console.log('Poker Assistant Pro: Simple Click Mode Active');

const IS_TOP_FRAME = window === window.top;

let roi = { x: 500, y: 800, width: 300, height: 150 };
let buttonCoords = { fold: { x: 100, y: 100 }, call: { x: 200, y: 200 }, raise: { x: 300, y: 300 }, sitback: { x: 400, y: 400 } };
let isScanning = false;
let apiKey = '';
let currentStrategy = 'gto';
let turnRefHash = '';
let isTurnActive = false;

// Load config
chrome.storage.local.get(['roi', 'buttonCoords', 'apiKey', 'currentStrategy', 'turnRefHash'], (data) => {
    if (data.roi) roi = data.roi;
    if (data.buttonCoords) buttonCoords = data.buttonCoords;
    if (data.apiKey) apiKey = data.apiKey;
    if (data.currentStrategy) currentStrategy = data.currentStrategy;
    if (data.turnRefHash) turnRefHash = data.turnRefHash;
    if (IS_TOP_FRAME) refreshMarkers();
});

function createCalibrationHub() {
    if (!IS_TOP_FRAME) return;

    const hub = document.createElement('div');
    hub.id = 'poker-pro-hub';
    hub.style.cssText = `
        position: fixed; top: 50px; left: 10px; width: 240px;
        background: #111; color: #0f0; border: 2px solid #333;
        border-radius: 12px; padding: 15px; font-family: 'Inter', sans-serif;
        z-index: 2147483647; cursor: move; box-shadow: 0 8px 32px rgba(0,0,0,0.8);
    `;

    hub.innerHTML = `
        <div style="font-weight:bold; margin-bottom:12px; border-bottom:1px solid #222; padding-bottom:8px; display:flex; justify-content:space-between;">
            <span>🛡️ POKER MASTER PRO</span>
            <span id="close-hub" style="cursor:pointer;opacity:0.5;">×</span>
        </div>
        
        <input type="password" id="api-key-input" placeholder="Gemini API Key" style="width:100%; background:#000; color:#0f0; border:1px solid #333; margin-bottom:12px; font-size:11px; padding:6px; border-radius:4px;">
        
        <div style="font-size:10px; color:#666; margin-bottom:4px;">STRATEGY</div>
        <select id="strategy-select" style="width:100%; background:#000; color:#0f0; border:1px solid #333; margin-bottom:15px; font-size:12px; padding:4px; border-radius:4px;">
            <option value="gto">GTO Solver</option>
            <option value="nl2">Micro Stakes (NL2)</option>
            <option value="nit">Nit (Ultra Tight)</option>
            <option value="tag">TAG (Aggressive)</option>
            <option value="lag">LAG (Loose)</option>
            <option value="tournament">Tournament</option>
        </select>

        <button id="set-roi-btn" style="${btnS('#0088ff')}">1. Setup Turn Area (ROI)</button>
        <button id="set-ref-btn" style="${btnS('#ffaa00')}">2. Capture My Turn</button>
        
        <div style="margin:15px 0 8px 0; font-size:10px; color:#888; text-transform:uppercase; letter-spacing:1px;">Click Alignment</div>
        <div style="font-size:9px; color:#555; margin-bottom:8px;">Drag circles to table buttons.</div>

        <button id="start-btn" style="${btnS('#0f0')} margin-top:10px; height:40px; font-size:14px;">START AI BOT</button>
        
        <div id="status" style="font-size:11px; margin-top:15px; padding:8px; background:#000; border-radius:6px; border-left:3px solid #666;">Status: Stopped</div>
        <div id="reasoning" style="font-size:10px; margin-top:10px; color:#eee; display:none; max-height:150px; overflow:auto; background:rgba(0,0,0,0.5); padding:10px; border-radius:6px; border:1px solid #222; white-space:pre-wrap;"></div>
    `;

    document.body.appendChild(hub);
    makeDraggable(hub);

    document.getElementById('start-btn').onclick = toggleAgent;
    document.getElementById('set-roi-btn').onclick = startROICalibration;
    document.getElementById('set-ref-btn').onclick = captureReference;
    document.getElementById('close-hub').onclick = () => hub.style.display = 'none';

    document.getElementById('api-key-input').onchange = (e) => {
        apiKey = e.target.value;
        chrome.storage.local.set({ apiKey });
    };
    document.getElementById('strategy-select').onchange = (e) => {
        currentStrategy = e.target.value;
        chrome.storage.local.set({ currentStrategy });
    };

    // Set initial values
    if (apiKey) document.getElementById('api-key-input').value = apiKey;
    if (currentStrategy) document.getElementById('strategy-select').value = currentStrategy;

    refreshMarkers();
}

function btnS(c) {
    return `background:${c}; color:#000; border:none; border-radius:6px; padding:10px; width:100%; cursor:pointer; font-weight:bold; font-size:11px; margin-bottom:5px; transition: opacity 0.2s;`;
}

function makeDraggable(el, onStop) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    el.onmousedown = (e) => {
        if (['BUTTON', 'INPUT', 'SELECT'].includes(e.target.tagName)) return;
        p3 = e.clientX; p4 = e.clientY;
        document.onmouseup = () => {
            document.onmouseup = null; document.onmousemove = null;
            if (onStop) onStop(parseInt(el.style.left), parseInt(el.style.top));
        };
        document.onmousemove = (e) => {
            p1 = p3 - e.clientX; p2 = p4 - e.clientY; p3 = e.clientX; p4 = e.clientY;
            el.style.top = (el.offsetTop - p2) + "px"; el.style.left = (el.offsetLeft - p1) + "px";
        };
    };
}

function createMarker(id, label, color) {
    if (!IS_TOP_FRAME) return;
    if (document.getElementById('marker-' + id)) return;

    const m = document.createElement('div');
    m.id = 'marker-' + id;
    m.style.cssText = `
        position: fixed; width: 60px; height: 60px;
        background: ${color}44; border: 2px dashed ${color};
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        color: white; font-weight: bold; font-size: 10px;
        z-index: 2147483646; cursor: move; text-shadow: 0 0 3px black;
        box-shadow: inset 0 0 10px ${color}88; pointer-events: auto;
    `;
    m.innerText = label;

    const pos = buttonCoords[id] || { x: 100, y: 100 };
    m.style.left = pos.x - 30 + 'px';
    m.style.top = pos.y - 30 + 'px';

    document.body.appendChild(m);
    makeDraggable(m, (x, y) => {
        buttonCoords[id] = { x: x + 30, y: y + 30 };
        chrome.storage.local.set({ buttonCoords });
    });
}

function refreshMarkers() {
    if (!IS_TOP_FRAME) return;
    ['fold', 'call', 'raise', 'sitback'].forEach(id => {
        const labels = { fold: 'FOLD', call: 'CALL', raise: 'RAISE', sitback: 'SIT' };
        const colors = { fold: '#f44', call: '#fa0', raise: '#0f0', sitback: '#888' };
        createMarker(id, labels[id], colors[id]);
    });
}

async function getHash() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => {
            if (!res || !res.dataUrl) return resolve('0');
            const img = new Image();
            img.onload = () => {
                const ratio = window.devicePixelRatio || 1;
                const c = document.createElement('canvas');
                const x = c.getContext('2d');
                const sX = roi.x * ratio, sY = roi.y * ratio;
                const sW = roi.width * ratio, sH = roi.height * ratio;
                c.width = Math.max(1, sW); c.height = Math.max(1, sH);
                x.drawImage(img, sX, sY, sW, sH, 0, 0, c.width, c.height);
                const d = x.getImageData(0, 0, c.width, c.height).data;
                let sum = 0;
                for (let i = 0; i < d.length; i += 100) sum += d[i] + d[i + 1] + d[i + 2];
                resolve(sum.toString());
            };
            img.src = res.dataUrl;
        });
    });
}

async function captureReference() {
    if (!IS_TOP_FRAME) return;
    const status = document.getElementById('status');
    status.innerText = 'Capturing...';
    const h = await getHash();
    if (h && h !== '0') {
        turnRefHash = h;
        chrome.storage.local.set({ turnRefHash });
        status.innerText = 'Turn Calibrated!';
    } else {
        status.innerText = 'Capture Failed!';
    }
}

function startROICalibration() {
    if (!IS_TOP_FRAME) return;
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; cursor:crosshair; z-index:2147483647; background:rgba(0,136,255,0.1);';
    document.body.appendChild(o);
    let sx, sy;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed; border:2px solid #0088ff; background:rgba(0,136,255,0.2); pointer-events:none; z-index:2147483647;';
    o.onmousedown = (e) => { sx = e.clientX; sy = e.clientY; document.body.appendChild(b); };
    o.onmousemove = (e) => {
        if (!sx) return;
        b.style.left = Math.min(sx, e.clientX) + 'px'; b.style.top = Math.min(sy, e.clientY) + 'px';
        b.style.width = Math.abs(sx - e.clientX) + 'px'; b.style.height = Math.abs(sy - e.clientY) + 'px';
    };
    o.onmouseup = () => {
        roi = { x: parseInt(b.style.left), y: parseInt(b.style.top), width: parseInt(b.style.width), height: parseInt(b.style.height) };
        chrome.storage.local.set({ roi });
        o.remove(); b.remove();
        document.getElementById('status').innerText = 'ROI Set!';
    };
}

function toggleAgent() {
    if (!IS_TOP_FRAME) return;
    isScanning = !isScanning;
    const btn = document.getElementById('start-btn');
    if (isScanning) {
        if (!apiKey || !turnRefHash) { alert('Calibration Missing!'); isScanning = false; return; }
        btn.innerText = 'STOP AI BOT'; btn.style.background = '#f44';
        document.getElementById('status').innerText = 'BOT: Watching...';
        loop();
    } else {
        btn.innerText = 'START AI BOT'; btn.style.background = '#0f0';
        document.getElementById('status').innerText = 'Status: Stopped';
        isTurnActive = false;
    }
}

async function loop() {
    if (!isScanning || !IS_TOP_FRAME) return;
    const h = await getHash();
    const diff = Math.abs(parseInt(h) - parseInt(turnRefHash));
    if (h !== '0' && diff < 8000) {
        if (!isTurnActive) {
            isTurnActive = true;
            document.getElementById('status').innerText = 'MY TURN: Analyzing...';
            chrome.runtime.sendMessage({ type: 'PERFORM_ANALYSIS' });
        }
    } else {
        isTurnActive = false;
        document.getElementById('status').innerText = 'Waiting...';
    }
    setTimeout(loop, 2000);
}

function performNativeClick(x, y) {
    const hub = document.getElementById('poker-pro-hub');
    const markers = ['fold', 'call', 'raise', 'sitback'].map(id => document.getElementById('marker-' + id));

    // 1. Hide everything
    if (hub) hub.style.display = 'none';
    markers.forEach(m => { if (m) m.style.display = 'none'; });

    // 2. Immediate Click Sequence (Reference Project Style)
    const el = document.elementFromPoint(x, y);
    if (el) {
        console.log('Clicking:', el.tagName);
        const props = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, props)));
        if (typeof el.click === 'function') el.click();

        // Visual feedback
        const dot = document.createElement('div');
        dot.style.cssText = `position:fixed; left:${x - 2}px; top:${y - 2}px; width:4px; height:4px; background:red; border-radius:50%; z-index:2147483647; pointer-events:none;`;
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 1000);
    }

    // 3. Restore
    if (hub) hub.style.display = 'block';
    markers.forEach(m => { if (m) m.style.display = 'flex'; });
}

chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'SHOW_DECISION') {
        const actionKey = m.recommendation.toLowerCase().includes('fold') ? 'fold' :
            (m.recommendation.toLowerCase().includes('call') || m.recommendation.toLowerCase().includes('check')) ? 'call' :
                m.recommendation.toLowerCase().includes('raise') ? 'raise' : null;

        if (IS_TOP_FRAME) {
            document.getElementById('status').innerText = 'AI: ' + m.recommendation;
            document.getElementById('reasoning').innerText = m.reasoning;
            document.getElementById('reasoning').style.display = 'block';
        }

        if (actionKey && buttonCoords[actionKey]) {
            performNativeClick(buttonCoords[actionKey].x, buttonCoords[actionKey].y);
        }
    }
});

if (IS_TOP_FRAME) createCalibrationHub();
