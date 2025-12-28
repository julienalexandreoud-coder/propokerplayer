// content.js
console.log('Poker Assistant Pro: Strategy Studio Active');

const IS_TOP_FRAME = window === window.top;

let roi = { x: 500, y: 800, width: 300, height: 150 };
let buttonCoords = { fold: { x: 100, y: 100 }, call: { x: 200, y: 200 }, raise: { x: 300, y: 300 }, sitback: { x: 400, y: 400 } };
let isScanning = false;
let apiKey = '';
let currentStrategy = 'gto';
let turnRefHash = '';
let isTurnActive = false;
let lastTurnTime = Date.now();
let isLoopPaused = false;
let customPromptValue = '';
let presets = {}; // Site presets (Layouts)
let customStrategies = {}; // User-made strategy prompts
let currentPresetName = 'Default';

// Load initial config
chrome.storage.local.get(['roi', 'buttonCoords', 'apiKey', 'currentStrategy', 'turnRefHash', 'customPrompt', 'presets', 'currentPresetName', 'customStrategies'], (data) => {
    if (data.roi) roi = data.roi;
    if (data.buttonCoords) buttonCoords = data.buttonCoords;
    if (data.apiKey) apiKey = data.apiKey;
    if (data.currentStrategy) currentStrategy = data.currentStrategy;
    if (data.turnRefHash) turnRefHash = data.turnRefHash;
    if (data.customPrompt) customPromptValue = data.customPrompt;
    if (data.presets) presets = data.presets;
    if (data.currentPresetName) currentPresetName = data.currentPresetName;
    if (data.customStrategies) customStrategies = data.customStrategies;

    if (IS_TOP_FRAME) {
        createCalibrationHub();
        refreshMarkers();
    }
});

function createCalibrationHub() {
    if (!IS_TOP_FRAME || document.getElementById('poker-pro-hub')) return;

    const hub = document.createElement('div');
    hub.id = 'poker-pro-hub';
    hub.style.cssText = `
        position: fixed; top: 20px; left: 10px; width: 250px;
        background: #000; color: #0f0; border: 2px solid #222;
        border-radius: 12px; padding: 15px; font-family: 'Inter', sans-serif;
        z-index: 2147483647; cursor: move; box-shadow: 0 10px 40px rgba(0,0,0,0.9);
    `;

    hub.innerHTML = `
        <div style="font-weight:bold; margin-bottom:12px; border-bottom:1px solid #111; padding-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>🛡️ MASTER PRO STUDIO</span>
            <span id="close-hub" style="cursor:pointer;opacity:0.5;font-size:18px;">×</span>
        </div>
        
        <input type="password" id="api-key-input" placeholder="Gemini API Key" style="width:100%; background:#050505; color:#0f0; border:1px solid #222; margin-bottom:12px; font-size:11px; padding:8px; border-radius:4px;">
        
        <div style="font-size:9px; color:#444; margin-bottom:4px; text-transform:uppercase;">1. Site Layout</div>
        <div style="display:flex; gap:4px; margin-bottom:12px;">
            <select id="preset-select" style="flex:1; background:#050505; color:#0f0; border:1px solid #222; font-size:11px; padding:4px; border-radius:4px;">
                <option value="Default">Default</option>
            </select>
            <button id="save-preset-btn" style="background:#22c55e; color:black; border:none; padding:4px 8px; border-radius:4px; font-size:9px; font-weight:bold; cursor:pointer;">SAVE</button>
        </div>

        <div style="font-size:9px; color:#444; margin-bottom:4px; text-transform:uppercase;">2. Strategy & Prompts</div>
        <div style="display:flex; gap:4px; margin-bottom:4px;">
            <select id="strategy-select" style="flex:1; background:#050505; color:#0f0; border:1px solid #222; font-size:12px; padding:4px; border-radius:4px;">
                <option value="gto">GTO Solver</option>
                <option value="cash">Cash Game</option>
                <option value="tournament">Tournament</option>
                <option value="spin">Spin & Go</option>
                <option value="nl2">NL2 Specialist</option>
            </select>
            <button id="save-strategy-btn" style="background:#3b82f6; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:9px; font-weight:bold; cursor:pointer;">NEW</button>
        </div>
        
        <textarea id="custom-prompt-input" placeholder="Custom Rules: e.g. If pair, go all-in." style="width:100%; height:70px; background:#050505; color:#0f0; border:1px solid #222; margin-bottom:15px; font-size:10px; padding:8px; border-radius:4px; resize:none; line-height:1.4;"></textarea>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <div style="font-size:9px; color:#444; text-transform:uppercase;">3. Alignment & ROI</div>
            <span id="reset-markers-btn" style="cursor:pointer; color:#ef4444; font-weight:bold; font-size:9px; border:1px solid #ef4444; padding:1px 4px; border-radius:3px;">RESET MARKERS</span>
        </div>
        <div style="display:flex; gap:5px; margin-bottom:5px;">
            <button id="set-roi-btn" style="${btnS('#0088ff', 'white')} flex:1;">Set ROI</button>
            <button id="set-ref-btn" style="${btnS('#ffaa00', 'black')} flex:1;">My Turn</button>
        </div>
        
        <button id="start-btn" style="${btnS('#10b981', 'black')} margin-top:10px; height:45px; font-size:14px; text-transform:uppercase; letter-spacing:1px;">Start AI Operator</button>
        
        <div id="status" style="font-size:10px; margin-top:15px; padding:10px; background:#050505; border-radius:6px; border-left:4px solid #333; color:#888;">Standby...</div>
        <div id="reasoning" style="font-size:10px; margin-top:10px; color:#eee; display:none; max-height:150px; overflow:auto; background:rgba(20,20,20,0.8); padding:10px; border-radius:6px; border:1px solid #222; white-space:pre-wrap; line-height:1.4;"></div>
    `;

    document.body.appendChild(hub);
    makeDraggable(hub);

    // Initial population
    updatePresetDropdown();
    updateStrategyDropdown();

    if (apiKey) document.getElementById('api-key-input').value = apiKey;
    if (currentStrategy) document.getElementById('strategy-select').value = currentStrategy;
    if (customPromptValue) document.getElementById('custom-prompt-input').value = customPromptValue;

    // Events
    document.getElementById('start-btn').onclick = toggleAgent;
    document.getElementById('set-roi-btn').onclick = startROICalibration;
    document.getElementById('set-ref-btn').onclick = captureReference;
    document.getElementById('close-hub').onclick = () => hub.style.display = 'none';

    document.getElementById('api-key-input').onchange = (e) => {
        apiKey = e.target.value;
        chrome.storage.local.set({ apiKey });
    };

    document.getElementById('strategy-select').onchange = (e) => {
        const val = e.target.value;
        currentStrategy = val;
        // If it's a custom strategy, load its prompt
        if (customStrategies[val]) {
            customPromptValue = customStrategies[val];
            document.getElementById('custom-prompt-input').value = customPromptValue;
        } else {
            // If switching back to a default, we keep current prompt or clear it? 
            // Better to keep it unless user clears it.
        }
        chrome.storage.local.set({ currentStrategy, customPrompt: customPromptValue });
    };

    document.getElementById('custom-prompt-input').onchange = (e) => {
        customPromptValue = e.target.value;
        chrome.storage.local.set({ customPrompt: customPromptValue });
        // If we are on a custom strategy, update it automatically
        if (customStrategies[currentStrategy]) {
            customStrategies[currentStrategy] = customPromptValue;
            chrome.storage.local.set({ customStrategies });
        }
    };

    document.getElementById('save-strategy-btn').onclick = () => {
        const name = prompt("Name your NEW Strategy (e.g. Ultra Nit, Fish Exploit):");
        if (name) {
            customStrategies[name] = customPromptValue;
            currentStrategy = name;
            chrome.storage.local.set({ customStrategies, currentStrategy });
            updateStrategyDropdown();
        }
    };

    document.getElementById('save-preset-btn').onclick = () => {
        const name = prompt("Site Name for Layout (e.g. Winamax, PokerStars):", currentPresetName);
        if (name) {
            presets[name] = { roi, buttonCoords, turnRefHash };
            currentPresetName = name;
            chrome.storage.local.set({ presets, currentPresetName });
            updatePresetDropdown();
        }
    };

    document.getElementById('preset-select').onchange = (e) => {
        const name = e.target.value;
        if (presets[name]) {
            currentPresetName = name;
            roi = presets[name].roi;
            buttonCoords = presets[name].buttonCoords;
            turnRefHash = presets[name].turnRefHash;
            chrome.storage.local.set({ currentPresetName, roi, buttonCoords, turnRefHash });
            refreshMarkers();
            document.getElementById('status').innerText = `Layout: ${name}`;
        }
    };

    document.getElementById('reset-markers-btn').onclick = () => {
        if (confirm("Reset all markers to default positions?")) {
            buttonCoords = { fold: { x: 100, y: 150 }, call: { x: 200, y: 150 }, raise: { x: 300, y: 150 }, sitback: { x: 400, y: 150 } };
            chrome.storage.local.set({ buttonCoords });
            if (presets[currentPresetName]) {
                presets[currentPresetName].buttonCoords = buttonCoords;
                chrome.storage.local.set({ presets });
            }
            refreshMarkers();
        }
    };
}

function updateStrategyDropdown() {
    const sel = document.getElementById('strategy-select');
    if (!sel) return;
    const defaults = ['gto', 'cash', 'tournament', 'spin', 'nl2', 'nit', 'tag', 'lag'];
    sel.innerHTML = '';

    // Add defaults
    defaults.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d.charAt(0).toUpperCase() + d.slice(1);
        if (d === currentStrategy) opt.selected = true;
        sel.appendChild(opt);
    });

    // Add customs
    Object.keys(customStrategies).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = "⭐ " + name;
        if (name === currentStrategy) opt.selected = true;
        sel.appendChild(opt);
    });
}

function updatePresetDropdown() {
    const sel = document.getElementById('preset-select');
    if (!sel) return;
    sel.innerHTML = '';
    const names = Object.keys(presets).length > 0 ? Object.keys(presets) : ['Default'];
    if (!presets['Default']) names.unshift('Default');

    [...new Set(names)].forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === currentPresetName) opt.selected = true;
        sel.appendChild(opt);
    });
}

function btnS(back, text) {
    return `background:${back}; color:${text}; border:none; border-radius:6px; padding:10px; width:100%; cursor:pointer; font-weight:bold; font-size:10px; transition: filter 0.2s;`;
}

function makeDraggable(el, onStop) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    el.onmousedown = (e) => {
        if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
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
    let m = document.getElementById('marker-' + id);
    if (!m) {
        m = document.createElement('div');
        m.id = 'marker-' + id;
        m.style.cssText = `
            position: fixed; width: 60px; height: 60px;
            background: ${color}22; border: 2px solid ${color};
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            color: #fff; font-weight: bold; font-size: 10px;
            z-index: 2147483646; cursor: move; text-shadow: 0 1px 4px black;
            box-shadow: 0 0 15px ${color}33; pointer-events: auto;
        `;
        m.innerText = label;
        document.body.appendChild(m);
        makeDraggable(m, (x, y) => {
            buttonCoords[id] = { x: x + 30, y: y + 30 };
            chrome.storage.local.set({ buttonCoords });
            if (presets[currentPresetName]) {
                presets[currentPresetName].buttonCoords = buttonCoords;
                chrome.storage.local.set({ presets });
            }
        });
    }

    const pos = buttonCoords[id] || { x: 100, y: 100 };
    m.style.left = pos.x - 30 + 'px';
    m.style.top = pos.y - 30 + 'px';
    m.style.display = 'flex'; // Ensure it's visible
}

function refreshMarkers() {
    if (!IS_TOP_FRAME) return;
    ['fold', 'call', 'raise', 'sitback'].forEach(id => {
        const labels = { fold: 'FOLD/PASS', call: 'CALL/CHECK', raise: 'RAISE', sitback: 'SIT' };
        const colors = { fold: '#ef4444', call: '#f59e0b', raise: '#10b981', sitback: '#6b7280' };
        createMarker(id, labels[id], colors[id]);
    });
}

async function getHash() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => {
            if (!res || !res.dataUrl || res.error) return resolve('0');
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
    status.innerText = 'Synchronizing...';
    status.style.color = '#ffaa00';
    const h = await getHash();
    if (h && h !== '0') {
        turnRefHash = h;
        chrome.storage.local.set({ turnRefHash });
        if (presets[currentPresetName]) {
            presets[currentPresetName].turnRefHash = turnRefHash;
            presets[currentPresetName].roi = roi;
            chrome.storage.local.set({ presets });
        }
        status.innerText = 'Turn Synced!';
        status.style.color = '#22c55e';
    } else {
        status.innerText = 'Capture Failed!';
        status.style.color = '#ef4444';
    }
}

function startROICalibration() {
    if (!IS_TOP_FRAME) return;
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; cursor:crosshair; z-index:2147483647; background:rgba(0,136,255,0.05);';
    document.body.appendChild(o);
    let sx, sy;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed; border:1px dashed #0088ff; background:rgba(0,136,255,0.1); pointer-events:none; z-index:2147483647;';
    o.onmousedown = (e) => { sx = e.clientX; sy = e.clientY; document.body.appendChild(b); };
    o.onmousemove = (e) => {
        if (!sx) return;
        b.style.left = Math.min(sx, e.clientX) + 'px'; b.style.top = Math.min(sy, e.clientY) + 'px';
        b.style.width = Math.abs(sx - e.clientX) + 'px'; b.style.height = Math.abs(sy - e.clientY) + 'px';
    };
    o.onmouseup = () => {
        roi = { x: parseInt(b.style.left), y: parseInt(b.style.top), width: parseInt(b.style.width), height: parseInt(b.style.height) };
        chrome.storage.local.set({ roi });
        if (presets[currentPresetName]) {
            presets[currentPresetName].roi = roi;
            chrome.storage.local.set({ presets });
        }
        o.remove(); b.remove();
        document.getElementById('status').innerText = 'ROI Defined!';
        document.getElementById('status').style.color = '#0088ff';
    };
}

function toggleAgent() {
    if (!IS_TOP_FRAME) return;
    isScanning = !isScanning;
    const btn = document.getElementById('start-btn');
    const status = document.getElementById('status');
    if (isScanning) {
        if (!apiKey || !turnRefHash) { alert('Calibration Missing!'); isScanning = false; return; }
        btn.innerText = 'Stop Operator'; btn.style.background = '#ef4444'; btn.style.color = 'white';
        status.innerText = 'WATCHING: Online';
        status.style.color = '#22c55e';
        lastTurnTime = Date.now(); // Reset on start
        loop();
    } else {
        btn.innerText = 'Start AI Operator'; btn.style.background = '#10b981'; btn.style.color = 'black';
        status.innerText = 'OFFLINE: Ready';
        status.style.color = '#888';
        isTurnActive = false;
    }
}

async function loop() {
    if (!isScanning || !IS_TOP_FRAME) return;
    if (isLoopPaused) { setTimeout(loop, 500); return; }
    const h = await getHash();
    const current = parseInt(h) || 0;
    const target = parseInt(turnRefHash) || 0;
    const diff = Math.abs(current - target);

    const debug = ` (${current}/${target})`;

    if (h !== '0' && target !== 0 && diff < 25000) { // Much higher tolerance for easier detection
        lastTurnTime = Date.now();
        if (!isTurnActive) {
            isTurnActive = true;
            document.getElementById('status').innerText = '🔥 ACTIVE' + debug;
            document.getElementById('status').style.color = '#ffaa00';
            chrome.runtime.sendMessage({ type: 'PERFORM_ANALYSIS' });

            isLoopPaused = true;
            document.getElementById('status').innerText = '🤖 THINKING' + debug;
            setTimeout(() => {
                isLoopPaused = false;
                isTurnActive = false; // Force reset after pause to allow fresh detection
            }, 3000);
        }
    } else {
        const matchP = target > 0 ? Math.max(0, Math.floor((1 - diff / 50000) * 100)) : 0;
        isTurnActive = false;
        document.getElementById('status').innerText = `WATCHING: ${matchP}% match${debug}`;
        document.getElementById('status').style.color = '#888';

        // Check for 45-second inactivity
        if (isScanning && (Date.now() - lastTurnTime > 45000)) {
            console.log('Inactivity detected (45s). Clicking Sit Back.');
            if (buttonCoords.sitback) {
                performNativeClick(buttonCoords.sitback.x, buttonCoords.sitback.y);
                lastTurnTime = Date.now(); // Reset after clicking
                document.getElementById('status').innerText = 'AUTO-SITBACK';
            }
        }
    }
    setTimeout(loop, 500); // 500ms is the safe limit to avoid Chrome quota errors
}

function performNativeClick(x, y) {
    const hub = document.getElementById('poker-pro-hub');
    const markers = ['fold', 'call', 'raise', 'sitback'].map(id => document.getElementById('marker-' + id));

    if (hub) hub.style.display = 'none';
    markers.forEach(m => { if (m) m.style.display = 'none'; });

    const el = document.elementFromPoint(x, y);
    if (el) {
        console.log('Dispatching Click:', el.tagName);
        const props = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, props)));
        if (typeof el.click === 'function') el.click();

        const dot = document.createElement('div');
        dot.style.cssText = `position:fixed; left:${x - 3}px; top:${y - 3}px; width:6px; height:6px; background:#ef4444; border-radius:50%; z-index:2147483647; pointer-events:none; box-shadow:0 0 10px #ef4444;`;
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 1000);
    }

    // UI PERSISTENCE: Bring back the control panel after the click is done
    setTimeout(() => {
        if (hub) hub.style.display = 'block';
        markers.forEach(m => { if (m) m.style.display = 'flex'; });
    }, 3000);
}

chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'SHOW_DECISION') {
        const rec = m.recommendation.toLowerCase();
        const actionKey = rec.includes('fold') ? 'fold' :
            (rec.includes('call') || rec.includes('check')) ? 'call' :
                rec.includes('raise') ? 'raise' : null;

        if (IS_TOP_FRAME) {
            document.getElementById('status').innerText = 'RECOMMEND: ' + m.recommendation;
            document.getElementById('status').style.color = '#ffffff';
            document.getElementById('reasoning').innerText = m.reasoning;
            document.getElementById('reasoning').style.display = 'block';
        }

        if (actionKey && buttonCoords[actionKey]) {
            performNativeClick(buttonCoords[actionKey].x, buttonCoords[actionKey].y);

            // 3-Second Fallback: If AI wants to fold but we are still stuck on this turn, click Check.
            if (actionKey === 'fold') {
                setTimeout(async () => {
                    if (!isScanning) return;
                    const h = await getHash();
                    const current = parseInt(h) || 0;
                    const target = parseInt(turnRefHash) || 0;
                    const diff = Math.abs(current - target);
                    if (h !== '0' && diff < 25000) {
                        console.log('Fold failed/ignored. Triggering 3s Fallback: Clicking Check.');
                        if (buttonCoords.call) {
                            performNativeClick(buttonCoords.call.x, buttonCoords.call.y);
                        }
                    }
                }, 3000);
            }
        }
    }
});
