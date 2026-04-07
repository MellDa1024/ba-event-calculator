/**
 * 이벤트 재화 계산기 - script.js
 */

const state = {
    data: {
        items: [{id:'event_point', name:'이벤트 포인트'}, {id:'item_A', name:'재화 A'}, {id:'item_B', name:'재화 B'}],
        stages: [],
        bonuses: {},
        inventory: {},
        targets: {},
        updatedAt: ""
    },
    ui: {
        saveTimer: null,
        statusTimer: null
    }
};

// --- 유틸리티 ---
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function getCurrentTimestamp() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
}

// --- 초기화 ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadSavedData();
    setupGlobalEvents();
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeUI(savedTheme);
}

function loadSavedData() {
    const savedData = localStorage.getItem('calc_data');
    if (savedData) {
        try { applyLoadedData(JSON.parse(savedData)); } 
        catch(e) { resetToDefault(); }
    } else {
        resetToDefault();
    }
}

function resetToDefault() {
    state.data.updatedAt = getCurrentTimestamp();
    state.data.inventory = {};
    state.data.bonuses = {};
    state.data.targets = {};
    initStages();
    renderAll(true);
}

function initStages() {
    state.data.stages = Array.from({length:12}, (_,i) => {
        const idx = i+1;
        const ap = idx<=4?10:idx<=8?15:20;
        const enabled = true;
        const drops = {};
        state.data.items.forEach(c => { drops[c.id] = 0; });
        return {id:`stage_${idx}`, index:`${idx}`, ap:ap, enabled, drops};
    });
}

function setupGlobalEvents() {
    document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('addItemBtn').addEventListener('click', addItem);
    document.querySelector('.btn-load').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', (e) => importJson(e.target));
    document.querySelector('.btn-cp').addEventListener('click', copyJson);
    document.getElementById('runOptBtn').addEventListener('click', runOptimization);
    document.getElementById('downloadBtn').addEventListener('click', downloadJson);
}

// --- UI 렌더링 ---
function renderAll(shouldClearResults = false) {
    renderItems();
    renderStages();
    renderInventory();
    renderBonuses();
    renderTargets();
    updateJsonPreview();
    
    if (shouldClearResults) {
        const area = document.getElementById('resultArea');
        if (area) area.style.display = 'none';
    }
}

function renderItems() {
    const el = document.getElementById('itemList');
    const template = document.getElementById('item-card-template');
    el.innerHTML = '';

    state.data.items.forEach((c, i) => {
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.item-card');
        const title = clone.querySelector('.item-title');
        const rmBtn = clone.querySelector('.btn-rm');
        const idInput = clone.querySelector('.item-id-input');
        const nameInput = clone.querySelector('.item-name-input');

        title.textContent = `재화 #${i + 1}`;
        
        if (state.data.items.length <= 1) {
            rmBtn.remove();
        } else {
            rmBtn.dataset.idx = i;
            rmBtn.addEventListener('click', (e) => removeItem(parseInt(e.target.dataset.idx)));
        }

        idInput.value = c.id;
        idInput.dataset.idx = i;
        idInput.dataset.oldId = c.id;
        idInput.addEventListener('focus', (e) => { e.target.dataset.oldId = e.target.value; });
        idInput.addEventListener('change', (e) => {
            const idx = e.target.dataset.idx;
            const oldId = e.target.dataset.oldId;
            const newId = e.target.value.replace(/\s/g, '');

            if (newId === "") { e.target.value = oldId; return; }
            if (state.data.items.some((item, i) => i != idx && item.id === newId)) {
                showStatus("이미 존재하는 ID입니다!", "error", "calcStatus");
                e.target.value = oldId;
                return;
            }

            if (oldId !== newId) {
                renameItemId(oldId, newId);
                state.data.items[idx].id = newId;
                renderAll();
                debouncedSave();
            }
        });

        nameInput.value = c.name;
        nameInput.dataset.idx = i;
        nameInput.addEventListener('input', (e) => {
            state.data.items[e.target.dataset.idx].name = e.target.value;
            document.querySelectorAll(`.lbl-name-${state.data.items[e.target.dataset.idx].id}`).forEach(lbl => {
                lbl.textContent = e.target.value;
            });
            debouncedSave();
        });

        el.appendChild(clone);
    });
}

function renameItemId(oldId, newId) {
    state.data.stages.forEach(s => { 
        if (s.drops[oldId] !== undefined) { s.drops[newId] = s.drops[oldId]; delete s.drops[oldId]; } 
    });
    if (state.data.inventory[oldId] !== undefined) { state.data.inventory[newId] = state.data.inventory[oldId]; delete state.data.inventory[oldId]; }
    if (state.data.bonuses[oldId] !== undefined) { state.data.bonuses[newId] = state.data.bonuses[oldId]; delete state.data.bonuses[oldId]; }
    if (state.data.targets[oldId] !== undefined) { state.data.targets[newId] = state.data.targets[oldId]; delete state.data.targets[oldId]; }
}

function renderStages() {
    const el = document.getElementById('stageList');
    const stageTemplate = document.getElementById('stage-card-template');
    const inputTemplate = document.getElementById('input-row-template');
    el.innerHTML = '';

    state.data.stages.forEach((s, i) => {
        const clone = stageTemplate.content.cloneNode(true);
        const card = clone.querySelector('.item-card');
        const title = clone.querySelector('.item-title');
        const toggle = clone.querySelector('.stage-toggle');
        const apInput = clone.querySelector('.stage-ap-input');
        const dropGrid = clone.querySelector('.stage-item-grid');

        const idx = parseInt(s.index);
        const groupNum = idx <= 4 ? 1 : idx <= 8 ? 2 : 3;
        card.id = `card-stage-${s.id}`;
        card.className = `item-card stage-group-${groupNum} ${s.enabled ? 'active' : 'inactive'}`;
        
        title.textContent = `스테이지 ${s.index}`;
        
        toggle.checked = s.enabled;
        toggle.dataset.idx = i;
        toggle.addEventListener('change', (e) => toggleStage(parseInt(e.target.dataset.idx), e.target.checked));

        apInput.value = s.ap;
        apInput.dataset.idx = i;
        apInput.addEventListener('input', (e) => { 
            state.data.stages[e.target.dataset.idx].ap = Math.max(0, +e.target.value || 0); 
            debouncedSave(); 
        });

        state.data.items.forEach(c => {
            const inputClone = inputTemplate.content.cloneNode(true);
            const label = inputClone.querySelector('label');
            const input = inputClone.querySelector('input');

            label.className = `lbl-name-${c.id}`;
            label.textContent = c.name;
            
            input.className = 'stage-drop-input';
            input.dataset.stageIdx = i;
            input.dataset.itemId = c.id;
            input.value = s.drops[c.id] || 0;
            input.addEventListener('input', (e) => { 
                state.data.stages[e.target.dataset.stageIdx].drops[e.target.dataset.itemId] = Math.max(0, +e.target.value || 0); 
                debouncedSave(); 
            });

            dropGrid.appendChild(inputClone);
        });

        el.appendChild(clone);
    });
}

function renderInventory() {
    const el = document.getElementById('existingList');
    const template = document.getElementById('input-row-template');
    el.innerHTML = '';

    state.data.items.forEach(c => {
        const clone = template.content.cloneNode(true);
        const label = clone.querySelector('label');
        const input = clone.querySelector('input');

        label.className = `lbl-name-${c.id}`;
        label.textContent = c.name;

        input.className = 'inventory-input';
        input.dataset.uid = c.id;
        input.value = state.data.inventory[c.id] || 0;
        input.addEventListener('input', (e) => { 
            state.data.inventory[e.target.dataset.uid] = Math.max(0, +e.target.value || 0); 
            debouncedSave(); 
        });

        el.appendChild(clone);
    });
}

function renderBonuses() {
    const el = document.getElementById('bonusList');
    const template = document.getElementById('input-row-template');
    el.innerHTML = '';

    state.data.items.forEach(c => {
        const clone = template.content.cloneNode(true);
        const label = clone.querySelector('label');
        const input = clone.querySelector('input');

        label.className = `lbl-name-${c.id}`;
        label.textContent = `${c.name} (%)`;

        input.className = 'bonus-input';
        input.dataset.uid = c.id;
        input.value = state.data.bonuses[c.id] || 0;
        input.addEventListener('input', (e) => { 
            state.data.bonuses[e.target.dataset.uid] = Math.max(0, +e.target.value || 0); 
            debouncedSave(); 
        });

        el.appendChild(clone);
    });
}

function renderTargets() {
    const el = document.getElementById('reqList');
    const template = document.getElementById('input-row-template');
    el.innerHTML = '';

    state.data.items.forEach(c => {
        const clone = template.content.cloneNode(true);
        const label = clone.querySelector('label');
        const input = clone.querySelector('input');

        label.className = `lbl-name-${c.id}`;
        label.textContent = c.name;

        input.className = 'target-input';
        input.dataset.uid = c.id;
        input.value = state.data.targets[c.id] || 0;
        input.addEventListener('input', (e) => { 
            state.data.targets[e.target.dataset.uid] = Math.max(0, +e.target.value || 0); 
            debouncedSave(); 
        });

        el.appendChild(clone);
    });
}

// --- 기능 함수 ---
function addItem() {
    const id = `item_${Date.now()}`;
    state.data.items.push({id, name:`새로운 재화 ${state.data.items.length + 1}`});
    state.data.stages.forEach(s => { s.drops[id]=0; });
    renderAll();
    debouncedSave();
}

function removeItem(idx) {
    const id = state.data.items[idx].id;
    state.data.items.splice(idx,1);
    state.data.stages.forEach(s => { delete s.drops[id]; });
    delete state.data.bonuses[id]; delete state.data.inventory[id]; delete state.data.targets[id];
    renderAll();
    debouncedSave();
}

function toggleStage(idx, enabled) {
    state.data.stages[idx].enabled = enabled;
    const card = document.getElementById(`card-stage-${state.data.stages[idx].id}`);
    if(card) {
        const groupNum = parseInt(state.data.stages[idx].index) <= 4 ? 1 : parseInt(state.data.stages[idx].index) <= 8 ? 2 : 3;
        card.className = `item-card stage-group-${groupNum} ${enabled ? 'active' : 'inactive'}`;
    }
    debouncedSave();
}

// --- 데이터 관리 ---
function buildJson() {
    const cleanObj = (obj) => {
        const res = {};
        Object.entries(obj).forEach(([k, v]) => { if(v > 0) res[k] = v; });
        return res;
    };
    return { 
        updated_at: state.data.updatedAt,
        items: state.data.items,
        stages: state.data.stages.map(s => ({
            id: s.id, index: s.index, ap: s.ap,
            rewards: Object.fromEntries(Object.entries(s.drops).filter(([,v])=>v>0))
        })),
        active_stages: Object.fromEntries(state.data.stages.map(s => [s.id, s.enabled])),
        bonuses: cleanObj(state.data.bonuses),
        inventory: cleanObj(state.data.inventory),
        targets: cleanObj(state.data.targets)
    };
}

function updateJsonPreview() {
    const data = buildJson();
    document.getElementById('preview').textContent = JSON.stringify(data, null, 2);
    document.getElementById('lastUpdateLabel').textContent = `마지막 업데이트 : ${data.updated_at}`;
}

function downloadJson() {
    state.data.updatedAt = getCurrentTimestamp();
    const data = buildJson();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'input.json';
    a.click();
    updateJsonPreview();
}

function importJson(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            applyLoadedData(JSON.parse(e.target.result));
            input.value = '';
            showStatus("데이터를 성공적으로 불러왔습니다!", "success", "dataStatus");
        } catch (err) {
            showStatus("올바르지 않은 JSON 파일입니다.", "error", "dataStatus");
        }
    };
    reader.readAsText(file);
}

function applyLoadedData(data) {
    if (!data) return;
    state.data.updatedAt = data.updated_at || data.updatedAt || getCurrentTimestamp();
    if (data.items) state.data.items = data.items;
    if (data.stages) {
        state.data.stages = data.stages.map(s => ({
            id: s.id || `stage_${s.index}_${Date.now()}`, 
            index: s.index, 
            ap: s.ap,
            enabled: data.active_stages ? data.active_stages[s.id] !== false : true,
            drops: s.rewards || {}
        }));
    }
    state.data.inventory = data.inventory || {};
    state.data.bonuses = data.bonuses || {};
    state.data.targets = data.targets || {};
    renderAll(true);
}

function debouncedSave(immediate = false) {
    if (state.ui.saveTimer) clearTimeout(state.ui.saveTimer);
    state.data.updatedAt = getCurrentTimestamp();
    updateJsonPreview();
    if (immediate) { performSave(); } 
    else { state.ui.saveTimer = setTimeout(performSave, 2000); }
}

function performSave() {
    localStorage.setItem('calc_data', JSON.stringify(buildJson()));
    console.log(`[%cAutoSave%c] %c${state.data.updatedAt}%c 저장 완료`, "color:#4a90e2;font-weight:bold", "", "color:#28a745;font-weight:bold", "");
}

// --- 최적화 엔진 ---
async function runOptimization() {
    const btn = document.getElementById('runOptBtn');
    if (!btn) return;

    const dataSnapshot = structuredClone(state.data);
    const originalText = btn.textContent;
    btn.disabled = true;
    
    const spinnerTemplate = document.getElementById('spinner-template');
    btn.innerHTML = '';
    btn.appendChild(spinnerTemplate.content.cloneNode(true));

    const minWait = new Promise(resolve => setTimeout(resolve, 200));

    try {
        if (typeof solver === 'undefined') {
            showStatus("라이브러리 로딩 중입니다.", "error", "calcStatus");
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 10));
        executeOptimization(dataSnapshot);
        await minWait;

    } catch (e) {
        console.error(e);
        showStatus("계산 중 오류가 발생했습니다.", "error", "calcStatus");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function executeOptimization(data) {
    const { items, stages, bonuses, inventory, targets } = data;
    debouncedSave(true);
    
    const needed = {};
    items.forEach(c => {
        const rem = Math.max(0, (targets[c.id] || 0) - (inventory[c.id] || 0));
        if (rem > 0) needed[c.id] = rem;
    });

    if (Object.keys(needed).length === 0) {
        showStatus("파밍이 필요한 재화가 없습니다!", "warn", "calcStatus");
        return;
    }

    const candStages = stages.filter(s => s.enabled).map(s => {
        const rewardPerRun = {};
        let totalRewardsPerRun = 0;
        items.forEach(c => {
            const bonus = (bonuses[c.id] || 0) / 100;
            const base = s.drops[c.id] || 0;
            const perRun = Math.ceil((base + base * bonus - Number.EPSILON));
            if (perRun > 0) {
                rewardPerRun[c.id] = perRun;
                totalRewardsPerRun += perRun;
            }
        });
        return { ...s, rewardPerRun, totalRewardsPerRun };
    }).filter(s => Object.keys(s.rewardPerRun).some(id => needed[id]));

    if (candStages.length === 0) {
        showStatus("해당 재화를 얻을 수 있는 스테이지가 없습니다.", "error", "calcStatus");
        return;
    }

    const model = { optimize: "cost", opType: "min", constraints: {}, variables: {} };
    Object.entries(needed).forEach(([id, qty]) => { model.constraints[id] = { min: qty }; });
    candStages.forEach(s => {
        model.variables[s.id] = { cost: s.ap };
        Object.entries(s.rewardPerRun).forEach(([id, amt]) => { model.variables[s.id][id] = amt; });
    });

    const lpRes = solver.Solve(model);
    if (!lpRes.feasible) {
        showStatus("조건을 만족하는 계획을 찾지 못했습니다.", "error", "calcStatus");
        return;
    }

    let stageRuns = {};
    candStages.forEach(s => { if (lpRes[s.id] > 0.0001) stageRuns[s.id] = Math.ceil(lpRes[s.id]); });

    const sortedStagesForReduction = candStages
        .filter(s => stageRuns[s.id])
        .sort((a,b) => (b.ap - a.ap) || (a.totalRewardsPerRun - b.totalRewardsPerRun));

    for (const s of sortedStagesForReduction) {
        while (stageRuns[s.id] > 0) {
            stageRuns[s.id]--;
            if (!checkSatisfied(stageRuns, candStages, needed)) {
                stageRuns[s.id]++;
                break;
            }
        }
        if (stageRuns[s.id] === 0) delete stageRuns[s.id];
    }

    let totalAp = Object.entries(stageRuns).reduce((acc, [id, cnt]) => acc + cnt * stages.find(x=>x.id===id).ap, 0);
    displayResults({ stageRuns, totalAp }, data);
    showStatus("최적 파밍 계획을 세웠습니다!", "success", "calcStatus");
}

function checkSatisfied(runs, candStages, needed) {
    const totalFarmed = {};
    Object.entries(runs).forEach(([sId, count]) => {
        const s = candStages.find(x => x.id === sId);
        Object.entries(s.rewardPerRun).forEach(([iId, amt]) => {
            totalFarmed[iId] = (totalFarmed[iId] || 0) + amt * count;
        });
    });
    return Object.entries(needed).every(([id, qty]) => (totalFarmed[id] || 0) >= qty);
}

function displayResults(result, data) {
    const { items, stages, bonuses, inventory, targets } = data;
    const area = document.getElementById('resultArea');
    const list = document.getElementById('resultStages');
    const totalEl = document.getElementById('resultTotal');
    const valArea = document.getElementById('resultValidation');

    const stageTemplate = document.getElementById('result-stage-template');
    const validationTemplate = document.getElementById('result-validation-template');

    list.innerHTML = '';
    Object.entries(result.stageRuns)
        .sort(([a],[b]) => {
            const sA = stages.find(s=>s.id===a);
            const sB = stages.find(s=>s.id===b);
            return (sA?.index||'').localeCompare(sB?.index||'', undefined, {numeric:true});
        })
        .forEach(([id, runs]) => {
            const s = stages.find(st => st.id === id);
            const clone = stageTemplate.content.cloneNode(true);
            const stageName = clone.querySelector('.stage-name');
            const stageRuns = clone.querySelector('.stage-runs');
            const resItem = clone.querySelector('.res-item');

            stageName.textContent = `스테이지 ${s.index}`;
            stageRuns.textContent = `${runs}회 (${(s.ap * runs).toLocaleString()} AP)`;

            const drops = items.map(c => {
                const bonus = (bonuses[c.id] || 0) / 100;
                const base = s.drops[c.id] || 0;
                const perRun = Math.ceil((base + base * bonus - Number.EPSILON));
                return perRun > 0 ? `${c.name} ×${(perRun * runs).toLocaleString()}` : null;
            }).filter(Boolean).join(', ');

            resItem.textContent = drops;
            list.appendChild(clone);
        });

    totalEl.textContent = `총 소요 AP: ${result.totalAp.toLocaleString()} AP`;

    valArea.innerHTML = '';
    const valTitle = document.createElement('div');
    valTitle.className = 'val-title';
    valTitle.textContent = '파밍 결과 재검증';
    valArea.appendChild(valTitle);

    items.forEach(c => {
        const goal = targets[c.id] || 0;
        const current = inventory[c.id] || 0;
        let farmed = 0;
        Object.entries(result.stageRuns).forEach(([sId, runs]) => {
            const s = stages.find(st => st.id === sId);
            const bonus = (bonuses[c.id] || 0) / 100;
            const base = s.drops[c.id] || 0;
            farmed += Math.ceil((base + base * bonus - Number.EPSILON)) * runs;
        });
        const total = current + farmed;
        const excess = total - goal;

        if (goal > 0 || farmed > 0) {
            const clone = validationTemplate.content.cloneNode(true);
            const valMain = clone.querySelector('.val-main');
            const valStatus = clone.querySelector('.val-status');
            const valDetail = clone.querySelector('.val-detail');
            const valExcess = clone.querySelector('.val-excess');

            valMain.textContent = c.name;
            valStatus.textContent = excess >= 0 ? '달성' : '부족';
            
            // 보유 수량 + 파밍 수량 = 총 수량 형식으로 텍스트 구성
            valDetail.textContent = `보유 ${current.toLocaleString()} + 파밍 ${farmed.toLocaleString()} = `;
            const strong = document.createElement('b');
            strong.textContent = total.toLocaleString();
            valDetail.appendChild(strong);
            
            valExcess.textContent = `(${excess >= 0 ? '+' : ''}${excess.toLocaleString()})`;

            valArea.appendChild(clone);
        }
    });

    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- 공통 유틸리티 ---
function showStatus(msg, type, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (state.ui.statusTimer) clearTimeout(state.ui.statusTimer);
    
    el.classList.remove('show');
    void el.offsetWidth;
    
    el.textContent = msg;
    el.className = `calc-status show ${type}`;
    state.ui.statusTimer = setTimeout(() => { 
        el.classList.remove('show'); 
        state.ui.statusTimer = null; 
    }, 3000);
}

function toggleTheme() {
    const target = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', target);
    localStorage.setItem('theme', target);
    updateThemeUI(target);
}

function updateThemeUI(theme) {
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
    if (text) text.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
}

function copyJson() {
    navigator.clipboard.writeText(document.getElementById('preview').textContent).then(() => {
        showStatus("JSON 데이터가 복사되었습니다!", "success", "dataStatus");
    });
}
