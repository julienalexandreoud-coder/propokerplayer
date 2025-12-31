// content.js
console.log('Poker Assistant Pro: Strategy Studio Active');

const IS_TOP_FRAME = window === window.top;

let roi = { x: 500, y: 800, width: 300, height: 150 };
let buttonCoords = { fold: { x: 100, y: 100 }, call: { x: 200, y: 200 }, raise: { x: 300, y: 300 }, sitback: { x: 400, y: 400 } };
let monitorRegions = {}; // { id: { x, y, w, h, hash, type } } - type: 'player', 'board', 'button'
let buttonRefHash = ''; // Reference hash for what a 'Dealer Button' looks like
let isScanning = false;
let apiKey = '';
let currentStrategy = 'gemini';
let idleHash = ''; // Hash for "NOT my turn"
let activeHash = ''; // Hash for "IS my turn"
let confidenceFactor = 1.0; // Slider 0.5 - 2.0
let isTurnActive = false;
let lastTurnTime = Date.now();
let isLoopPaused = false;
let customPromptValue = '';
let presets = {}; // Site presets (Layouts)
let customStrategies = {}; // User-made strategy prompts
let currentPresetName = 'Default';
let matchThreshold = 20; // Replaced by confidenceFactor in v5.0 logic, but keeping for migration
let actionCooldown = 3000;
let sitBackTimeout = 45000;
let bigBlind = '100';
let activeTab = 'calibration'; // 'calibration' or 'strategy'
let showMarkers = true;

// Load initial config
chrome.storage.local.get(['roi', 'buttonCoords', 'apiKey', 'currentStrategy', 'idleHash', 'activeHash', 'confidenceFactor', 'customPrompt', 'presets', 'currentPresetName', 'customStrategies', 'matchThreshold', 'actionCooldown', 'sitBackTimeout', 'bigBlind', 'monitorRegions', 'buttonRefHash'], (data) => {
    if (data.roi) roi = data.roi;
    if (data.buttonCoords) buttonCoords = data.buttonCoords;
    if (data.apiKey) apiKey = data.apiKey;
    if (data.currentStrategy) currentStrategy = data.currentStrategy;
    if (data.idleHash) idleHash = data.idleHash;
    if (data.activeHash) activeHash = data.activeHash;
    if (data.confidenceFactor) confidenceFactor = data.confidenceFactor;
    if (data.customPrompt) customPromptValue = data.customPrompt;
    if (data.presets) presets = data.presets;
    if (data.currentPresetName) currentPresetName = data.currentPresetName;
    if (data.customStrategies) customStrategies = data.customStrategies;
    if (data.matchThreshold) matchThreshold = data.matchThreshold;
    if (data.actionCooldown) actionCooldown = data.actionCooldown;
    if (data.sitBackTimeout) sitBackTimeout = data.sitBackTimeout;
    if (data.bigBlind) bigBlind = data.bigBlind;
    if (data.monitorRegions) monitorRegions = data.monitorRegions;
    if (data.buttonRefHash) buttonRefHash = data.buttonRefHash;

    // --- MIGRATION: Sanitize old non-normalized hashes ---
    const isOldHash = (h) => h && parseFloat(h) > 800;
    if (isOldHash(idleHash)) { idleHash = ''; chrome.storage.local.remove('idleHash'); }
    if (isOldHash(activeHash)) { activeHash = ''; chrome.storage.local.remove('activeHash'); }
    if (isOldHash(buttonRefHash)) { buttonRefHash = ''; chrome.storage.local.remove('buttonRefHash'); }
    Object.keys(monitorRegions).forEach(k => {
        if (isOldHash(monitorRegions[k].hash)) monitorRegions[k].hash = '';
    });

    // Compatibility for turnRefHash users (idleHash = turnRefHash)
    if (!idleHash && data.turnRefHash && !isOldHash(data.turnRefHash)) {
        idleHash = data.turnRefHash;
        chrome.storage.local.set({ idleHash });
    }

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
        position: fixed; top: 10px; left: 10px; width: 400px; max-height: 98vh;
        background: #000; color: #eee; border: 2px solid #222;
        border-radius: 12px; padding: 12px; font-family: 'Inter', sans-serif;
        z-index: 2147483647; cursor: move; box-shadow: 0 10px 40px rgba(0,0,0,0.9);
        display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;
        overflow: auto;
    `;

    hub.innerHTML = `
        <div style="font-weight:bold; margin-bottom:4px; border-bottom:1px solid #111; padding-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span style="color:#a78bfa;">🛡️ COMMAND CENTER <span style="font-size:8px; opacity:0.5;">v5.0</span></span>
            <div style="display:flex; gap:10px; align-items:center;">
                <button id="open-manual-btn" style="background:#1e1b4b; color:#c4b5fd; border:1px solid #312e81; border-radius:4px; padding:2px 8px; font-size:9px; cursor:pointer;">📖 MANUAL</button>
                <span id="close-hub" style="cursor:pointer;opacity:0.5;font-size:18px;">×</span>
            </div>
        </div>

        <!-- TABS -->
        <div style="display:flex; gap:2px; background:#111; padding:2px; border-radius:6px;">
            <button id="tab-cal" style="flex:1; padding:6px; border:none; border-radius:4px; font-size:10px; cursor:pointer; background:${activeTab === 'calibration' ? '#222' : 'transparent'}; color:#fff;">🎯 VISION</button>
            <button id="tab-strat" style="flex:1; padding:6px; border:none; border-radius:4px; font-size:10px; cursor:pointer; background:${activeTab === 'strategy' ? '#222' : 'transparent'}; color:#fff;">🧠 STRATEGY</button>
        </div>
        
        <!-- CALIBRATION TAB -->
        <div id="section-calibration" style="display:${activeTab === 'calibration' ? 'block' : 'none'};">
            <div style="display:flex; flex-direction:column; gap:10px;">
                <!-- Vision Monitor & Status -->
                <div style="display:grid; grid-template-columns: 140px 1fr; gap:10px;">
                    <canvas id="roi-monitor" style="width:100%; height:80px; background:#050505; border:1px solid #222; border-radius:4px;"></canvas>
                    <div id="status" style="font-size:10px; padding:6px; background:#050505; border-radius:6px; border-left:4px solid #333; color:#888; display:flex; align-items:center; justify-content:center; text-align:center;">Standby...</div>
                </div>

                <!-- Sync & ROI Buttons -->
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                    <button id="set-roi-btn" style="${btnS('#4c1d95', 'white')} padding:6px;">Set Turn ROI</button>
                    <button id="set-btn-ref-btn" style="${btnS('#0ea5e9', 'white')} padding:6px;">Button Ref</button>
                    <button id="set-pot-btn" style="${btnS('#059669', 'white')} padding:6px;">Map Pot</button>
                    <button id="set-stack-btn" style="${btnS('#2563eb', 'white')} padding:6px;">Map Stack</button>
                    <button id="set-idle-btn" style="${btnS('#ffaa00', 'black')} padding:6px; font-size:9px;">Sync Idle</button>
                    <button id="set-active-btn" style="${btnS('#ef4444', 'white')} padding:6px; font-size:9px;">Sync Active</button>
                </div>

                <!-- Regions Mapping -->
                <div style="background:#050505; border:1px solid #111; padding:8px; border-radius:8px;">
                    <div style="font-size:8px; color:#444; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Player & Table Elements</div>
                    <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:4px; margin-bottom:10px;">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `
                            <div style="display:flex; flex-direction:column; gap:2px;">
                                <button class="region-btn" data-id="p${i}" style="font-size:6px; padding:2px;">P${i}A</button>
                                <button class="region-btn" data-id="p${i}n" style="font-size:6px; padding:2px; background:#1e1b4b; color:#c4b5fd;">P${i}N</button>
                                <button class="region-btn" data-id="p${i}b" style="font-size:6px; padding:2px; background:#444;">P${i}B</button>
                            </div>
                        `).join('')}
                        <button class="region-btn hero-btn" data-id="hero" style="font-size:7px; padding:3px; background:#4c1d95; color:white; grid-column: span 1;">HERO</button>
                    </div>

                    <div style="font-size:8px; color:#444; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Board (Street Detection)</div>
                    <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:4px;">
                        <button class="region-btn" data-id="c1" style="font-size:7px; padding:3px;">C1</button>
                        <button class="region-btn" data-id="c2" style="font-size:7px; padding:3px;">C2</button>
                        <button class="region-btn" data-id="c3" style="font-size:7px; padding:3px;">C3</button>
                        <button class="region-btn" data-id="c4" style="font-size:7px; padding:3px;">C4</button>
                        <button class="region-btn" data-id="c5" style="font-size:7px; padding:3px;">C5</button>
                    </div>
                </div>

                <!-- Confidence Slider -->
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:#444; margin-bottom:4px; text-transform:uppercase;">
                        <span>Confidence Tolerance</span>
                        <span id="confidence-val">${confidenceFactor.toFixed(1)}x</span>
                    </div>
                    <input type="range" id="confidence-slider" min="0.5" max="2.0" step="0.1" value="${confidenceFactor}" style="width:100%; accent-color:#f59e0b; cursor:pointer;">
                </div>

                <!-- Site Presets (Multi-Site Vision) -->
                <div style="background:#050505; border:1px solid #222; padding:8px; border-radius:8px;">
                    <div style="font-size:8px; color:#444; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px;">Multi-Site Vision Layouts</div>
                    <div style="display:flex; gap:4px;">
                        <select id="preset-select-cal" style="flex:1; background:#111; color:#0f0; border:1px solid #333; font-size:10px; padding:4px; border-radius:4px;"><option value="Default">Default</option></select>
                        <button id="save-preset-btn-cal" style="background:#22c55e; color:black; border:none; padding:4px 8px; border-radius:4px; font-size:9px; font-weight:bold; cursor:pointer;">SAVE VISION</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- STRATEGY TAB -->
        <div id="section-strategy" style="display:${activeTab === 'strategy' ? 'block' : 'none'};">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                <div>
                    <div style="font-size:9px; color:#444; margin-bottom:4px; text-transform:uppercase;">API & PRESETS</div>
                    <input type="password" id="api-key-input" placeholder="Gemini API Key" style="width:100%; background:#050505; color:#0f0; border:1px solid #222; margin-bottom:8px; font-size:11px; padding:6px; border-radius:4px;">
                    <div style="display:flex; gap:4px; margin-bottom:8px;">
                        <input type="number" id="bb-input" placeholder="BB" value="${bigBlind}" style="width:40px; background:#050505; color:#0f0; border:1px solid #222; font-size:10px; padding:4px; border-radius:4px;">
                        <select id="preset-select" style="flex:1; background:#050505; color:#0f0; border:1px solid #222; font-size:10px; padding:4px; border-radius:4px;"><option value="Default">Default</option></select>
                        <button id="save-preset-btn" style="background:#22c55e; color:black; border:none; padding:4px 8px; border-radius:4px; font-size:9px; font-weight:bold; cursor:pointer;">SAVE</button>
                    </div>
                    <button id="reset-markers-btn" style="${btnS('#ef4444', 'white')} padding:4px; font-size:9px;">RESET VISION</button>
                </div>
                <div>
                    <div style="font-size:9px; color:#444; margin-bottom:4px; text-transform:uppercase;">DECISION ENGINE</div>
                    <select id="strategy-select" style="width:100%; background:#050505; color:#0f0; border:1px solid #222; font-size:11px; padding:4px; border-radius:4px; margin-bottom:8px;">
                        <option value="gemini">Gemini's Strategy</option>
                    </select>
                    <textarea id="custom-prompt-input" placeholder="Strategy prompts..." style="width:100%; height:60px; background:#050505; color:#a78bfa; border:1px solid #222; font-size:10px; padding:6px; border-radius:4px; resize:none;"></textarea>
                </div>
            </div>
            
            <!-- SLIDERS ROW -->
            <div style="margin-top:10px; border-top:1px solid #111; padding-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:#444; margin-bottom:2px;">
                        <span>Action Cooldown</span>
                        <span id="cooldown-val">${(actionCooldown / 1000).toFixed(1)}s</span>
                    </div>
                    <input type="range" id="cooldown-slider" min="500" max="10000" step="100" value="${actionCooldown}" style="width:100%; accent-color:#10b981; cursor:pointer;">
                </div>
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:9px; color:#444; margin-bottom:2px;">
                        <span>Auto-Sitback</span>
                        <span id="sitback-val">${(sitBackTimeout / 1000).toFixed(0)}s</span>
                    </div>
                    <input type="range" id="sitback-slider" min="10000" max="300000" step="5000" value="${sitBackTimeout}" style="width:100%; accent-color:#6b7280; cursor:pointer;">
                </div>
            </div>
        </div>

        <!-- SHARED: ANALYSIS & ACTIONS -->
        <div style="border-top:1px solid #111; padding-top:10px; display:flex; flex-direction:column; gap:10px;">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div id="metadata-monitor" style="font-size:9px; background:#050505; color:#a78bfa; border:1px solid #222; border-radius:4px; padding:8px; min-height:60px; max-height:100px; overflow:auto; white-space:pre-wrap; font-family:monospace;">Waiting for turn...</div>
                <div id="hud-monitor" style="font-size:9px; background:#050505; color:#f59e0b; border:1px solid #222; border-radius:4px; padding:8px; min-height:60px; max-height:100px; overflow:auto; white-space:pre-wrap; font-family:monospace;">No HUD Data</div>
            </div>
            <div id="reasoning" style="font-size:9px; color:#eee; display:none; max-height:100px; overflow:auto; background:rgba(20,20,20,0.8); padding:8px; border-radius:6px; border:1px solid #222; white-space:pre-wrap; line-height:1.4;"></div>
            
            <div style="display:flex; gap:10px;">
                <button id="toggle-markers-btn" style="${btnS('#333', '#888')} flex:0.5; padding:8px;">Markers</button>
                <button id="start-btn" style="${btnS('#10b981', 'black')} flex:1; height:40px; font-size:12px; text-transform:uppercase;">Start AI Operator</button>
            </div>
        </div>
    `;


    document.body.appendChild(hub);
    makeDraggable(hub);

    // Initial population
    updatePresetDropdown();
    updateStrategyDropdown();

    if (apiKey) document.getElementById('api-key-input').value = apiKey;
    if (currentStrategy) document.getElementById('strategy-select').value = currentStrategy;
    if (customPromptValue) document.getElementById('custom-prompt-input').value = customPromptValue;

    // Initial UI state
    document.getElementById('toggle-markers-btn').style.background = showMarkers ? '#10b981' : '#111';

    // Events
    document.getElementById('open-manual-btn').onclick = () => window.open(chrome.runtime.getURL('manual.html'), '_blank');
    document.getElementById('close-hub').onclick = () => { hub.style.display = 'none'; };
    document.getElementById('start-btn').onclick = toggleAgent;
    document.getElementById('set-roi-btn').onclick = startROICalibration;
    document.getElementById('set-pot-btn').onclick = () => startRegionCalibration('pot');
    document.getElementById('set-stack-btn').onclick = () => startRegionCalibration('hero_stack');
    document.getElementById('set-idle-btn').onclick = () => captureDualReference('IDLE');
    document.getElementById('set-active-btn').onclick = () => captureDualReference('ACTIVE');
    document.getElementById('set-btn-ref-btn').onclick = captureButtonReference;
    document.getElementById('toggle-markers-btn').onclick = () => {
        showMarkers = !showMarkers;
        const markers = ['fold', 'call', 'raise', 'sitback'];
        markers.forEach(id => {
            const m = document.getElementById('marker-' + id);
            if (m) m.style.display = showMarkers ? 'flex' : 'none';
        });
        if (showMarkers) refreshMarkers();
        document.getElementById('toggle-markers-btn').style.background = showMarkers ? '#10b981' : '#111';
    };

    // Tabs
    const tabCal = document.getElementById('tab-cal');
    const tabStrat = document.getElementById('tab-strat');
    const secCal = document.getElementById('section-calibration');
    const secStrat = document.getElementById('section-strategy');

    tabCal.onclick = () => {
        activeTab = 'calibration';
        tabCal.style.background = '#222'; tabCal.style.color = '#fff';
        tabStrat.style.background = 'transparent'; tabStrat.style.color = '#555';
        secCal.style.display = 'block'; secStrat.style.display = 'none';
    };
    tabStrat.onclick = () => {
        activeTab = 'strategy';
        tabStrat.style.background = '#222'; tabStrat.style.color = '#fff';
        tabCal.style.background = 'transparent'; tabCal.style.color = '#555';
        secStrat.style.display = 'block'; secCal.style.display = 'none';
    };

    // Region Buttons
    document.querySelectorAll('.region-btn').forEach(btn => {
        const id = btn.getAttribute('data-id');
        btn.onclick = () => startRegionCalibration(id);
        if (monitorRegions[id]) btn.style.borderColor = '#22c55e';
    });

    document.getElementById('confidence-slider').oninput = (e) => {
        confidenceFactor = parseFloat(e.target.value);
        document.getElementById('confidence-val').innerText = confidenceFactor.toFixed(1) + 'x';
        chrome.storage.local.set({ confidenceFactor });
    };

    document.getElementById('cooldown-slider').oninput = (e) => {
        actionCooldown = parseInt(e.target.value);
        document.getElementById('cooldown-val').innerText = (actionCooldown / 1000).toFixed(1) + 's';
        chrome.storage.local.set({ actionCooldown });
    };

    document.getElementById('sitback-slider').oninput = (e) => {
        sitBackTimeout = parseInt(e.target.value);
        document.getElementById('sitback-val').innerText = (sitBackTimeout / 1000).toFixed(0) + 's';
        chrome.storage.local.set({ sitBackTimeout });
    };

    document.getElementById('bb-input').onchange = (e) => {
        bigBlind = e.target.value;
        chrome.storage.local.set({ bigBlind });
    };

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
            document.getElementById('strategy-status').innerText = `Saved to: ${name} `;
        }
    };

    const savePreset = () => {
        const name = prompt("Site Name for Layout (e.g. Winamax, PokerStars):", currentPresetName);
        if (name) {
            presets[name] = {
                roi,
                buttonCoords,
                idleHash,
                activeHash,
                monitorRegions,
                buttonRefHash
            };
            currentPresetName = name;
            chrome.storage.local.set({ presets, currentPresetName });
            updatePresetDropdown();
            document.getElementById('status').innerText = `Saved Layout: ${name}`;
            document.getElementById('status').style.color = '#22c55e';
        }
    };

    const loadPreset = (e) => {
        const name = e.target.value;
        if (presets[name]) {
            currentPresetName = name;
            roi = presets[name].roi || roi;
            buttonCoords = presets[name].buttonCoords || buttonCoords;
            idleHash = presets[name].idleHash || presets[name].turnRefHash || '';
            activeHash = presets[name].activeHash || '';
            monitorRegions = presets[name].monitorRegions || {};
            buttonRefHash = presets[name].buttonRefHash || '';

            chrome.storage.local.set({
                currentPresetName,
                roi,
                buttonCoords,
                idleHash,
                activeHash,
                monitorRegions,
                buttonRefHash
            });

            refreshMarkers();
            document.querySelectorAll('.region-btn').forEach(btn => {
                const id = btn.getAttribute('data-id');
                btn.style.borderColor = monitorRegions[id] ? '#22c55e' : 'transparent';
            });

            updatePresetDropdown(); // Keep both in sync
            document.getElementById('status').innerText = `Switched to: ${name}`;
            document.getElementById('status').style.color = '#0ea5e9';
        }
    };

    document.getElementById('save-preset-btn').onclick = savePreset;
    document.getElementById('save-preset-btn-cal').onclick = savePreset;
    document.getElementById('preset-select').onchange = loadPreset;
    document.getElementById('preset-select-cal').onchange = loadPreset;

    document.getElementById('reset-markers-btn').onclick = () => {
        if (!confirm("Reset ALL Vision Settings?")) return;

        roi = { x: 500, y: 800, width: 300, height: 150 };
        buttonCoords = { fold: { x: 100, y: 150 }, call: { x: 200, y: 150 }, raise: { x: 300, y: 150 }, sitback: { x: 400, y: 150 } };
        idleHash = '';
        activeHash = '';
        monitorRegions = {};
        buttonRefHash = '';

        chrome.storage.local.set({ roi, buttonCoords, monitorRegions, buttonRefHash, idleHash, activeHash }, () => {
            refreshMarkers();
            document.querySelectorAll('.region-btn').forEach(btn => btn.style.borderColor = 'transparent');

            const monitor = document.getElementById('roi-monitor');
            if (monitor) monitor.getContext('2d').clearRect(0, 0, monitor.width, monitor.height);

            const metadata = document.getElementById('metadata-monitor');
            if (metadata) metadata.innerText = 'Waiting for turn...';

            const status = document.getElementById('status');
            status.innerText = 'Vision Reset Successful';
            status.style.color = '#ef4444';
        });
    };
}

function updateStrategyDropdown() {
    const sel = document.getElementById('strategy-select');
    if (!sel) return;
    const defaults = ['gemini', 'cash', 'tournament', 'spin', 'nl2', 'nit', 'tag', 'lag'];
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
    ['preset-select', 'preset-select-cal'].forEach(id => {
        const sel = document.getElementById(id);
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
    });
}

function btnS(back, text) {
    return `background:${back}; color:${text}; border:2px solid transparent; border-radius:6px; padding:10px; width:100%; cursor:pointer; font-weight:bold; font-size:10px; transition:all 0.2s; `;
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
    background: ${color} 22; border: 2px solid ${color};
    border - radius: 50 %; display: flex; align - items: center; justify - content: center;
    color: #fff; font - weight: bold; font - size: 10px;
    z - index: 2147483646; cursor: move; text - shadow: 0 1px 4px black;
    box - shadow: 0 0 15px ${color} 33; pointer - events: auto;
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
    m.style.display = showMarkers ? 'flex' : 'none';
}

function refreshMarkers() {
    if (!IS_TOP_FRAME) return;
    ['fold', 'call', 'raise', 'sitback'].forEach(id => {
        const labels = { fold: 'FOLD', call: 'CALL', raise: 'RAISE', sitback: 'SIT' };
        const colors = { fold: '#ef4444', call: '#f59e0b', raise: '#10b981', sitback: '#6b7280' };
        createMarker(id, labels[id], colors[id]);
    });
    drawRegionHighlights();
}

function drawRegionHighlights() {
    if (!IS_TOP_FRAME) return;
    // Remove old region overlays
    document.querySelectorAll('.region-overlay').forEach(el => el.remove());

    Object.entries(monitorRegions).forEach(([id, reg]) => {
        let color = 'rgba(167, 139, 250, 0.5)'; // Default purple-ish
        let bg = 'rgba(167, 139, 250, 0.05)';

        if (id.startsWith('c')) { // Community Cards
            color = 'rgba(14, 165, 233, 0.5)'; // Sky blue
            bg = 'rgba(14, 165, 233, 0.05)';
        } else if (id === 'hero') {
            color = 'rgba(139, 92, 246, 0.8)'; // Stronger purple
            bg = 'rgba(139, 92, 246, 0.1)';
        } else if (id === 'pot') {
            color = 'rgba(34, 197, 94, 0.8)'; // Green for Pot
            bg = 'rgba(34, 197, 94, 0.1)';
        } else if (id === 'hero_stack') {
            color = 'rgba(59, 130, 246, 0.8)'; // Blue for Stack
            bg = 'rgba(59, 130, 246, 0.1)';
        } else if (id.endsWith('n')) {
            color = 'rgba(196, 181, 253, 0.6)'; // Soft purple for Names
            bg = 'rgba(196, 181, 253, 0.05)';
        }

        const div = document.createElement('div');
        div.className = 'region-overlay';
        div.setAttribute('data-region-id', id);
        div.style.cssText = `
            position: fixed; left: ${reg.x - 1}px; top: ${reg.y - 1}px;
            width: ${reg.width + 2}px; height: ${reg.height + 2}px;
            border: 1px dashed ${color};
            background: ${bg};
            pointer-events: none; z-index: 2147483645;
            box-sizing: border-box;
            display: flex; align-items: start; justify-content: start;
            color: ${color}; font-size: 8px; font-weight: bold;
            padding: 2px;
        `;
        div.innerText = id.toUpperCase();
        document.body.appendChild(div);
    });

    // Also show main Turn ROI
    const roiDiv = document.createElement('div');
    roiDiv.className = 'region-overlay';
    roiDiv.setAttribute('data-region-id', 'TURN');
    roiDiv.style.cssText = `
    position: fixed; left: ${roi.x - 1} px; top: ${roi.y - 1} px;
    width: ${roi.width + 2} px; height: ${roi.height + 2} px;
    border: 1px solid rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.02);
    pointer - events: none; z - index: 2147483645;
    box - sizing: border - box;
    color: rgba(245, 158, 11, 0.5); font - size: 8px;
    `;
    roiDiv.innerText = 'TURN-ROI';
    document.body.appendChild(roiDiv);
}

function setUIVisibility(visible) {
    const hub = document.getElementById('poker-pro-hub');
    if (hub) hub.style.display = visible ? 'flex' : 'none';

    document.querySelectorAll('.region-overlay').forEach(el => {
        el.style.display = visible ? 'flex' : 'none';
    });

    const markers = ['fold', 'call', 'raise', 'sitback'];
    markers.forEach(id => {
        const m = document.getElementById('marker-' + id);
        if (m) m.style.display = (visible && showMarkers) ? 'flex' : 'none';
    });

    document.querySelectorAll('.calibration-overlay, .calibration-box').forEach(el => {
        el.style.opacity = visible ? '1' : '0';
    });
}

async function captureCleanScreenshot() {
    return new Promise((resolve) => {
        setUIVisibility(false);
        setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => {
                setUIVisibility(true);
                resolve(res ? res.dataUrl : null);
            });
        }, 150);
    });
}

async function captureDirtyScreenshot() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => {
            resolve(res ? res.dataUrl : null);
        });
    });
}

async function getHash(optionalRoi = null, dataUrl = null) {
    const targetRoi = optionalRoi || roi;
    return new Promise((resolve) => {
        const process = (src) => {
            if (!src) return resolve('0');
            const img = new Image();
            img.onload = () => {
                const ratio = window.devicePixelRatio || 1;
                const c = document.createElement('canvas');
                const x = c.getContext('2d');
                const sX = targetRoi.x * ratio, sY = targetRoi.y * ratio;
                const sW = targetRoi.width * ratio, sH = targetRoi.height * ratio;
                c.width = Math.max(1, sW); c.height = Math.max(1, sH);
                x.drawImage(img, sX, sY, sW, sH, 0, 0, c.width, c.height);

                if (!optionalRoi) {
                    const monitor = document.getElementById('roi-monitor');
                    if (monitor) {
                        const mx = monitor.getContext('2d');
                        monitor.width = c.width; monitor.height = c.height;
                        mx.drawImage(c, 0, 0);
                    }
                }

                const d = x.getImageData(0, 0, c.width, c.height).data;
                let sum = 0;
                let count = 0;
                // Sample every few pixels for performance, but normalize by count
                for (let i = 0; i < d.length; i += 20) {
                    sum += d[i] + d[i + 1] + d[i + 2]; // RGB sum
                    count++;
                }
                const average = count > 0 ? (sum / count) : 0;
                resolve(average.toFixed(2)); // Value from 0.00 to 765.00
            };
            img.src = src;
        };

        if (dataUrl) {
            process(dataUrl);
        } else {
            chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => {
                process(res ? res.dataUrl : null);
            });
        }
    });
}

async function captureDualReference(type) {
    if (!IS_TOP_FRAME) return;
    const status = document.getElementById('status');
    status.innerText = `Syncing ${type} state...`;
    status.style.color = '#ffaa00';
    const cleanUrl = await captureCleanScreenshot();
    const h = await getHash(null, cleanUrl);
    if (h && h !== '0') {
        if (type === 'IDLE') {
            idleHash = h;
            chrome.storage.local.set({ idleHash });
        } else {
            activeHash = h;
            chrome.storage.local.set({ activeHash });
        }
        status.innerText = `${type} State Synced!`;
        status.style.color = '#22c55e';
    }
}

async function captureButtonReference() {
    startCalibration('BUTTON_REF');
}

function startROICalibration() {
    startCalibration('TURN');
}

function startRegionCalibration(id) {
    startCalibration(id);
}

function startCalibration(id) {
    if (!IS_TOP_FRAME) return;
    const o = document.createElement('div');
    o.className = 'calibration-overlay';
    o.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; cursor:crosshair; z-index:2147483647; background:rgba(167,139,250,0.1); transition: opacity 0.1s;';
    document.body.appendChild(o);
    let sx, sy;
    const b = document.createElement('div');
    b.className = 'calibration-box';
    b.style.cssText = 'position:fixed; border:2px dashed #a78bfa; background:rgba(167,139,250,0.2); pointer-events:none; z-index:2147483647; transition: opacity 0.1s;';
    o.onmousedown = (e) => { sx = e.clientX; sy = e.clientY; document.body.appendChild(b); };
    o.onmousemove = (e) => {
        if (!sx) return;
        b.style.left = Math.min(sx, e.clientX) + 'px'; b.style.top = Math.min(sy, e.clientY) + 'px';
        b.style.width = Math.abs(sx - e.clientX) + 'px'; b.style.height = Math.abs(sy - e.clientY) + 'px';
    };
    o.onmouseup = async () => {
        const w = parseInt(b.style.width) || 0;
        const h = parseInt(b.style.height) || 0;
        if (w < 5 || h < 5) {
            o.remove(); b.remove();
            return;
        }

        const newRoi = { x: parseInt(b.style.left), y: parseInt(b.style.top), width: w, height: h };
        const statusEl = document.getElementById('status');

        if (id === 'TURN') {
            roi = newRoi;
            chrome.storage.local.set({ roi });
            drawRegionHighlights();
            statusEl.innerText = "Turn ROI Set! Now sync Idle and Active states.";
            statusEl.style.color = '#ffaa00';
            setTimeout(() => { statusEl.innerText = "Ready to Sync States"; }, 3000);
        } else if (id === 'BUTTON_REF') {
            const cleanUrl = await captureCleanScreenshot();
            const hashValue = await getHash(newRoi, cleanUrl);
            buttonRefHash = hashValue;
            chrome.storage.local.set({ buttonRefHash });
            statusEl.innerText = `Button Reference Hash Updated!`;
            statusEl.style.color = '#0ea5e9';
        } else {
            const cleanUrl = await captureCleanScreenshot();
            const hashValue = await getHash(newRoi, cleanUrl);
            monitorRegions[id] = { ...newRoi, hash: hashValue };
            chrome.storage.local.set({ monitorRegions });

            const btn = document.querySelector(`.region-btn[data-id="${id}"]`);
            if (btn) btn.style.borderColor = '#22c55e';
            drawRegionHighlights();
            statusEl.innerText = `${id.toUpperCase()} Target Defined!`;
            statusEl.style.color = '#22c55e';
        }
        o.remove(); b.remove();
    };
}
async function getMultiRegionReport(cleanUrl = null) {
    let report = "--- LOCAL TABLE ANALYSIS ---\n";
    let activePlayerCount = 0;
    let buttonPos = "Unknown";
    let cardsDetected = 0;

    // Dealer Button finding vars
    let bestButtonId = null;
    let bestButtonDiff = 999;

    const dataUrl = cleanUrl || await captureCleanScreenshot();

    // Map of regions to their friendly names
    const regions = Object.entries(monitorRegions);

    for (const [id, reg] of regions) {
        const h = await getHash(reg, dataUrl);
        const current = parseFloat(h) || 0;
        const target = parseFloat(reg.hash) || 0;
        const diff = Math.abs(current - target);

        // Threshold for change (diff > 15 means it's likely a change in luminosity)
        // Adjust based on observation if needed
        const isChanged = diff > 15;

        // Analysis regions (Skip for dirty scanning if not turn)
        if (id === 'pot') {
            report += `POT_LOCATION: [${reg.x}, ${reg.y}, ${reg.width}, ${reg.height}]\n`;
        }
        if (id === 'hero_stack') {
            report += `HERO_STACK_LOCATION: [${reg.x}, ${reg.y}, ${reg.width}, ${reg.height}]\n`;
        }
        if (id.endsWith('n')) {
            const pNum = id.replace('p', '').replace('n', '');
            report += `PLAYER_${pNum}_NAME_LOCATION: [${reg.x}, ${reg.y}, ${reg.width}, ${reg.height}]\n`;
        }

        // Player detection (P1-P9)
        if (id.startsWith('p') && !id.includes('b') && !id.includes('n')) {
            if (isChanged) activePlayerCount++;
        }

        // Hero detection
        if (id === 'hero') {
            report += `Hero Active: ${isChanged ? 'YES' : 'NO'}\n`;
        }

        // Dealer Button detection (Collect candidates)
        if (id.endsWith('b') && buttonRefHash) {
            const bRef = parseFloat(buttonRefHash) || 0;
            const bDiff = Math.abs(current - bRef);
            if (bDiff < bestButtonDiff) {
                bestButtonDiff = bDiff;
                bestButtonId = id;
            }
        }

        // Community Card detection (C1-C5)
        if (id.startsWith('c')) {
            if (isChanged) {
                cardsDetected++;
                report += `BOARD_CARD_LOCATION: ${id.toUpperCase()} at [${reg.x}, ${reg.y}, ${reg.width}, ${reg.height}]\n`;
            }
        }
    }

    // Determine best button match (Threshold 50)
    if (bestButtonId && bestButtonDiff < 50) {
        buttonPos = bestButtonId.replace('b', '').toUpperCase();
    }

    // Street detection logic
    let street = "Preflop";
    if (cardsDetected === 3) street = "Flop";
    else if (cardsDetected === 4) street = "Turn";
    else if (cardsDetected === 5) street = "River";

    report += `STREET: ${street.toUpperCase()}\n`;
    report += `ACTIVE_OPPONENTS: ${activePlayerCount}\n`;
    report += `DEALER_BUTTON: ${buttonPos}\n`;
    report += `CARDS_ON_BOARD: ${cardsDetected}\n`;
    report += "--- END METADATA ---\n";
    return { report, dataUrl, street };
}


function toggleAgent() {
    if (!IS_TOP_FRAME) return;
    isScanning = !isScanning;
    const btn = document.getElementById('start-btn');
    const status = document.getElementById('status');
    if (isScanning) {
        if (!apiKey || !idleHash || !activeHash) { alert('Calibration Missing! Please sync Idle and Active states.'); isScanning = false; return; }
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
    const current = parseFloat(h) || 0;
    const idle = parseFloat(idleHash) || 0;
    const active = parseFloat(activeHash) || 0;

    // Distance (Difference) from states
    const distIdle = Math.abs(current - idle);
    const distActive = Math.abs(current - active);

    // Match % for UI feedback (Relative to Idle)
    const changeP = (distIdle / 765) * 100;
    const matchP = Math.max(0, Math.min(100, Math.floor(100 - (changeP * 4))));

    // DUAL-STATE TRIGGER LOGIC
    // Trigger if we are significantly CLOSER to the Active state than the Idle state
    // confidenceFactor default 1.0 (means must be closer than distIdle)
    const isTriggered = activeHash !== '' && idleHash !== '' && (distActive < distIdle * confidenceFactor);

    if (h !== '0' && isTriggered) {
        lastTurnTime = Date.now();
        if (isTurnActive) return; // Prevent double trigger
        isTurnActive = true;
        document.getElementById('status').innerText = `🔥 ACTIVE`;
        document.getElementById('status').style.color = '#ffaa00';

        getMultiRegionReport().then(({ report, dataUrl }) => {
            const monitor = document.getElementById('metadata-monitor');
            if (monitor) monitor.innerText = report;
            chrome.runtime.sendMessage({
                type: 'PERFORM_ANALYSIS',
                localMetadata: report,
                cleanDataUrl: dataUrl
            });
        });

        isLoopPaused = true;
        document.getElementById('status').innerText = `🤖 THINKING...`;
        setTimeout(() => {
            isLoopPaused = false;
            isTurnActive = false;
        }, actionCooldown);
    } else {
        isTurnActive = false;

        // Flicker-free status update every 5 seconds
        if (Date.now() % 5000 < 600) {
            captureDirtyScreenshot().then(dirtyUrl => {
                if (!dirtyUrl) return;
                getMultiRegionReport(dirtyUrl).then(({ street }) => {
                    const statusText = (idleHash && activeHash) ?
                        `👁️ ${street.toUpperCase()}... [Match: ${matchP}%]` :
                        `👁️ Sync Required`;
                    document.getElementById('status').innerText = statusText;
                    document.getElementById('status').style.color = '#888';
                });
            });
        }
    }

    // Check for inactivity
    if (isScanning && (Date.now() - lastTurnTime > sitBackTimeout)) {
        console.log(`Inactivity detected(${sitBackTimeout / 1000}s). Clicking Sit Back.`);
        if (buttonCoords.sitback) {
            performNativeClick(buttonCoords.sitback.x, buttonCoords.sitback.y);
            lastTurnTime = Date.now(); // Reset after clicking
            document.getElementById('status').innerText = 'AUTO-SITBACK';
        }
    }
    setTimeout(loop, 500);
}

function performNativeClick(x, y) {
    const hub = document.getElementById('poker-pro-hub');
    const markers = ['fold', 'call', 'raise', 'sitback'].map(id => document.getElementById('marker-' + id));

    // Temporarily disable pointer events so we can "see through" the UI to the site
    if (hub) hub.style.pointerEvents = 'none';
    markers.forEach(m => { if (m) m.style.pointerEvents = 'none'; });

    const el = document.elementFromPoint(x, y);

    // Re-enable pointer events immediately so user can still interact with the UI
    if (hub) hub.style.pointerEvents = 'auto';
    markers.forEach(m => { if (m) m.style.pointerEvents = 'auto'; });

    if (el) {
        console.log('Dispatching Click:', el.tagName);
        const props = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(t => el.dispatchEvent(new MouseEvent(t, props)));
        if (typeof el.click === 'function') el.click();

        const dot = document.createElement('div');
        dot.style.cssText = `position: fixed; left:${x - 3} px; top:${y - 3} px; width: 6px; height: 6px; background: #ef4444; border - radius: 50 %; z - index: 2147483647; pointer - events: none; box - shadow: 0 0 10px #ef4444; `;
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 1000);
    }
}

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_DECISION') {
        const state = msg.state || {};
        const rec = msg.recommendation.toLowerCase();

        // 1. HUD Display
        if (msg.hud && state.opponents) {
            const hudDiv = document.getElementById('hud-monitor');
            if (hudDiv) {
                let hudText = '--- SESSION HUD ---\n';
                state.opponents.forEach(opp => {
                    if (opp.name && msg.hud[opp.name]) {
                        const s = msg.hud[opp.name];
                        const hands = s.hands || 1;
                        const vpipVal = ((s.vpip / hands) * 100).toFixed(0);
                        const pfrVal = ((s.pfr / hands) * 100).toFixed(0);
                        hudText += `${opp.name}: ${vpipVal}%V / ${pfrVal}%P (${hands}h)\n`;
                    }
                });
                hudDiv.innerText = hudText;
            }
        }

        // 2. Local Math Engine: Pot Odds Check
        if (state.pot && state.cost_to_call) {
            const pot = parseFloat(state.pot.toString().replace(/[^0-9.]/g, ''));
            const call = parseFloat(state.cost_to_call.toString().replace(/[^0-9.]/g, ''));
            if (!isNaN(pot) && !isNaN(call) && call > 0) {
                const odds = (call / (pot + call)) * 100;
                const equity = parseFloat(state.equity_estimate || 0);

                if (equity < odds && rec.includes('call')) {
                    const status = document.getElementById('status');
                    if (status) {
                        status.innerText = `⚠️ MATH WARNING: Equity ${equity}% < Odds ${odds.toFixed(1)}%`;
                        status.style.color = '#ef4444';
                    }
                }
            }
        }

        // 3. UI Update (Status & Reasoning)
        if (IS_TOP_FRAME) {
            const street = state.street || '??';
            const eq = state.equity_estimate || '??';
            const status = document.getElementById('status');
            const reasoning = document.getElementById('reasoning');

            if (status) {
                status.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:2px; align-items:center;">
                        <span style="color:#22c55e; font-weight:bold; font-size:12px;">${msg.recommendation.toUpperCase()}</span>
                        <span style="font-size:9px; color:#888;">Equity: ${eq}% | ${street.toUpperCase()}</span>
                    </div>
                `;
                status.style.color = '#ffffff';
            }

            if (reasoning) {
                reasoning.innerText = `Street: ${street.toUpperCase()}\n${msg.reasoning}`;
                reasoning.style.display = 'block';
            }
        }

        // 4. Execution
        const actionKey = rec.includes('fold') ? 'fold' :
            (rec.includes('call') || rec.includes('check')) ? 'call' :
                rec.includes('raise') ? 'raise' : null;

        if (actionKey && buttonCoords[actionKey]) {
            performNativeClick(buttonCoords[actionKey].x, buttonCoords[actionKey].y);

            if (actionKey === 'fold') {
                setTimeout(async () => {
                    if (!isScanning) return;
                    const h = await getHash();
                    const current = parseFloat(h) || 0;
                    const target = parseFloat(idleHash) || 0;
                    if (Math.abs(current - target) < 50) {
                        if (buttonCoords.call) performNativeClick(buttonCoords.call.x, buttonCoords.call.y);
                    }
                }, 3000);
            }
        }
    }
});

function startRegionCalibration(id) {
    if (activeOverlay) return;
    activeOverlay = true;

    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);z-index:2147483647;cursor:crosshair;display:flex;align-items:center;justify-content:center;`;
    overlay.innerHTML = `<div style="color:white; font-size:24px; font-weight:bold; text-shadow:0 0 10px black;">DRAG BOX OVER: ${id.toUpperCase()}</div>`;
    document.body.appendChild(overlay);

    let startX, startY, rect;

    overlay.onmousedown = (e) => {
        startX = e.clientX;
        startY = e.clientY;
        rect = document.createElement('div');
        rect.style.cssText = `position:fixed; border:2px solid #22c55e; background:rgba(34,197,94,0.2); pointer-events:none;`;
        document.body.appendChild(rect);

        overlay.onmousemove = (me) => {
            const x = Math.min(startX, me.clientX);
            const y = Math.min(startY, me.clientY);
            const w = Math.abs(startX - me.clientX);
            const h = Math.abs(startY - me.clientY);
            rect.style.left = x + 'px';
            rect.style.top = y + 'px';
            rect.style.width = w + 'px';
            rect.style.height = h + 'px';
        };

        overlay.onmouseup = () => {
            const finalRect = rect.getBoundingClientRect();
            monitorRegions[id] = {
                x: Math.round(finalRect.left),
                y: Math.round(finalRect.top),
                width: Math.round(finalRect.width),
                height: Math.round(finalRect.height)
            };
            chrome.storage.local.set({ monitorRegions }, () => {
                refreshMarkers();
                drawRegionHighlights();
                document.querySelectorAll('.region-btn').forEach(btn => {
                    if (btn.getAttribute('data-id') === id) btn.style.borderColor = '#22c55e';
                });
            });

            overlay.remove();
            rect.remove();
            activeOverlay = false;
        };
    };
}
